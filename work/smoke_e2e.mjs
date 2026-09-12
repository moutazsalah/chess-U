import { io } from "../client/node_modules/socket.io-client/build/esm/index.js";

const identityUrl = "http://127.0.0.1:4001";
const gameUrl = "http://127.0.0.1:4002";
const statsUrl = "http://127.0.0.1:4003";

const expectOk = async (response, label) => {
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`${label} failed: ${response.status} ${body}`);
    }
    return response;
};

const createGuest = async (name) => {
    const response = await expectOk(
        await fetch(`${identityUrl}/v1/auth/guest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name })
        }),
        `create guest ${name}`
    );
    const setCookie = response.headers.get("set-cookie");
    const cookie = setCookie.split(";")[0];
    const user = await response.json();
    return { cookie, user };
};

const createGame = async (cookie) => {
    const response = await expectOk(
        await fetch(`${gameUrl}/v1/games`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Cookie: cookie
            },
            body: JSON.stringify({ side: "white", unlisted: false })
        }),
        "create game"
    );
    return response.json();
};

const onceEvent = (socket, event, timeoutMs = 10000) =>
    new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`Timed out waiting for ${event}`));
        }, timeoutMs);

        const handler = (payload) => {
            clearTimeout(timeout);
            resolve(payload);
        };

        socket.once(event, handler);
    });

const connectPlayer = async (cookie) => {
    const socket = io(gameUrl, {
        transports: ["websocket"],
        extraHeaders: {
            Cookie: cookie
        }
    });

    await onceEvent(socket, "connect");
    return socket;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const main = async () => {
    const white = await createGuest("SmokeWhite");
    const black = await createGuest("SmokeBlack");

    const { code } = await createGame(white.cookie);

    const whiteSocket = await connectPlayer(white.cookie);
    const blackSocket = await connectPlayer(black.cookie);

    whiteSocket.emit("joinLobby", code);
    blackSocket.emit("joinLobby", code);

    await Promise.all([
        onceEvent(whiteSocket, "receivedLatestGame"),
        onceEvent(blackSocket, "receivedLatestGame")
    ]);

    blackSocket.emit("joinAsPlayer");
    await onceEvent(whiteSocket, "userJoinedAsPlayer");
    await onceEvent(whiteSocket, "receivedLatestGame");

    const moves = [
        { socket: whiteSocket, move: { from: "f2", to: "f3", promotion: "q" } },
        { socket: blackSocket, move: { from: "e7", to: "e5", promotion: "q" } },
        { socket: whiteSocket, move: { from: "g2", to: "g4", promotion: "q" } },
        { socket: blackSocket, move: { from: "d8", to: "h4", promotion: "q" } }
    ];

    let gameOverPayload;
    for (const [index, step] of moves.entries()) {
        const gameOverPromise =
            index === moves.length - 1 ? onceEvent(whiteSocket, "gameOver", 15000) : null;
        step.socket.emit("sendMove", step.move);
        await wait(300);
        if (gameOverPromise) {
            gameOverPayload = await gameOverPromise;
        }
    }

    await wait(1500);

    const historyResponse = await expectOk(
        await fetch(`${statsUrl}/v1/games?userid=${white.user.id}`),
        "fetch history"
    );
    const history = await historyResponse.json();

    const leaderboardResponse = await expectOk(
        await fetch(`${statsUrl}/v1/leaderboard`),
        "fetch leaderboard"
    );
    const leaderboard = await leaderboardResponse.json();

    whiteSocket.disconnect();
    blackSocket.disconnect();

    console.log(
        JSON.stringify(
            {
                white: white.user,
                black: black.user,
                code,
                gameOverPayload,
                historyCount: history.length,
                latestHistory: history[0],
                leaderboardTop: leaderboard.slice(0, 5)
            },
            null,
            2
        )
    );
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
