// Shared helpers for the end-to-end tests. They talk to the running Docker Compose stack:
// the services over HTTP/Socket.IO, and each service's own database directly, so the
// tests can check what data every microservice actually wrote.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import amqplib from "amqplib";
import pg from "pg";
import { io } from "socket.io-client";

export const identityUrl = process.env.IDENTITY_URL || "http://127.0.0.1:4001";
export const gameUrl = process.env.GAME_URL || "http://127.0.0.1:4002";
export const statsUrl = process.env.STATS_URL || "http://127.0.0.1:4003";
export const amqpUrl = process.env.AMQP_URL || "amqp://guest:guest@127.0.0.1:5672";

export const STATS_QUEUE = "stats-history-service.events";
export const DEAD_LETTER_QUEUE = "stats-history-service.dead-letter";

// one database per microservice - there is no shared database
export const identityDb = new pg.Pool({
    connectionString: "postgres://user:password@127.0.0.1:5433/chessu_identity"
});
export const gameDb = new pg.Pool({
    connectionString: "postgres://user:password@127.0.0.1:5434/chessu_game"
});
export const statsDb = new pg.Pool({
    connectionString: "postgres://user:password@127.0.0.1:5435/chessu_stats"
});

export const closeAll = async () => {
    await Promise.all([identityDb.end(), gameDb.end(), statsDb.end()]);
};

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export const dockerCompose = (...args) =>
    execFileSync("docker", ["compose", ...args], { cwd: repoRoot, stdio: "pipe" }).toString();

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// the read side is eventually consistent, so poll until the condition holds
export const waitFor = async (
    check,
    { timeoutMs = 15000, intervalMs = 250, label = "condition" } = {}
) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await check();
        if (value) {
            return value;
        }
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${label}`);
        }
        await sleep(intervalMs);
    }
};

export const uniqueName = (prefix) => `${prefix}${randomBytes(4).toString("hex")}`;

const expectOk = async (response, label) => {
    if (!response.ok) {
        throw new Error(`${label} failed: ${response.status} ${await response.text()}`);
    }
    return response;
};

const sessionCookie = (response) => response.headers.get("set-cookie").split(";")[0];

export const registerUser = async (name = uniqueName("user")) => {
    const response = await expectOk(
        await fetch(`${identityUrl}/v1/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, password: "secret123" })
        }),
        `register ${name}`
    );
    return { cookie: sessionCookie(response), user: await response.json() };
};

export const updateUserName = async (cookie, name) => {
    const response = await expectOk(
        await fetch(`${identityUrl}/v1/auth`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ name })
        }),
        "update user"
    );
    return response.json();
};

export const createGame = async (cookie) => {
    const response = await expectOk(
        await fetch(`${gameUrl}/v1/games`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: cookie },
            body: JSON.stringify({ side: "white", unlisted: true })
        }),
        "create game"
    );
    return (await response.json()).code;
};

const onceEvent = (socket, event, timeoutMs = 10000) =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`Timed out waiting for socket event ${event}`));
        }, timeoutMs);
        const handler = (payload) => {
            clearTimeout(timer);
            resolve(payload);
        };
        socket.once(event, handler);
    });

const connectSocket = async (cookie) => {
    const socket = io(gameUrl, { transports: ["websocket"], extraHeaders: { Cookie: cookie } });
    await onceEvent(socket, "connect");
    return socket;
};

// Plays "fool's mate" over Socket.IO: black checkmates white in 2 moves.
// Returns the game code and the gameOver payload.
export const playFoolsMate = async (whitePlayer, blackPlayer) => {
    const code = await createGame(whitePlayer.cookie);
    const whiteSocket = await connectSocket(whitePlayer.cookie);
    const blackSocket = await connectSocket(blackPlayer.cookie);

    try {
        const whiteSynced = onceEvent(whiteSocket, "receivedLatestGame");
        whiteSocket.emit("joinLobby", code);
        await whiteSynced;

        const blackSynced = onceEvent(blackSocket, "receivedLatestGame");
        blackSocket.emit("joinLobby", code);
        await blackSynced;

        const joined = onceEvent(whiteSocket, "userJoinedAsPlayer");
        blackSocket.emit("joinAsPlayer");
        await joined;

        const moves = [
            [whiteSocket, blackSocket, { from: "f2", to: "f3" }],
            [blackSocket, whiteSocket, { from: "e7", to: "e5" }],
            [whiteSocket, blackSocket, { from: "g2", to: "g4" }]
        ];
        for (const [mover, opponent, move] of moves) {
            const received = onceEvent(opponent, "receivedMove");
            mover.emit("sendMove", move);
            await received;
        }

        const gameOver = onceEvent(whiteSocket, "gameOver");
        blackSocket.emit("sendMove", { from: "d8", to: "h4" });
        return { code, gameOver: await gameOver };
    } finally {
        whiteSocket.disconnect();
        blackSocket.disconnect();
    }
};

export const getPlayerStats = async (userId) => {
    const result = await statsDb.query(`SELECT * FROM "player_stats" WHERE user_id = $1`, [
        String(userId)
    ]);
    return result.rows[0];
};

export const withRabbitChannel = async (fn) => {
    const connection = await amqplib.connect(amqpUrl);
    try {
        const channel = await connection.createChannel();
        return await fn(channel);
    } finally {
        await connection.close();
    }
};

export const queueDepth = (queue) =>
    withRabbitChannel(async (channel) => (await channel.checkQueue(queue)).messageCount);
