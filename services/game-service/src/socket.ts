import type { User } from "@chessu/types";
import type { Server, Socket } from "socket.io";

import type { Move } from "./actor.js";
import { resolveUserFromCookie } from "./auth.js";
import { getActiveGame, sendToGame } from "./runtime.js";

type GameSocket = Socket & {
    data: {
        user?: User;
    };
};

const findSocketGameCode = (socket: Socket) =>
    Array.from(socket.rooms).find((room) => room !== socket.id);

export const initSocketServer = (io: Server) => {
    io.use(async (socket: GameSocket, next) => {
        try {
            const cookieHeader = socket.handshake.headers.cookie;
            const user = await resolveUserFromCookie(cookieHeader);
            if (!user?.id) {
                next(new Error("Unauthorized"));
                return;
            }
            socket.data.user = user;
            next();
        } catch (error) {
            next(error as Error);
        }
    });

    io.on("connection", (socket: GameSocket) => {
        // Registers a handler for events that target the socket's current game.
        // A rejected actor message (game finished, not your turn, illegal move...) must not
        // become an unhandled rejection, which would crash the process; instead the client
        // is re-synced with the latest state if the game still exists.
        const onGameEvent = <A extends unknown[]>(
            event: string,
            handler: (gameCode: string, user: User, ...args: A) => Promise<void>
        ) => {
            socket.on(event, async (...args: A) => {
                const gameCode = findSocketGameCode(socket);
                const user = socket.data.user;
                if (!gameCode || !user) {
                    return;
                }
                try {
                    await handler(gameCode, user, ...args);
                } catch {
                    const game = getActiveGame(gameCode);
                    if (game && socket.connected) {
                        socket.emit("receivedLatestGame", game);
                    }
                }
            });
        };

        socket.on("disconnecting", async () => {
            const gameCode = findSocketGameCode(socket);
            const user = socket.data.user;
            if (!gameCode || !user) {
                return;
            }
            try {
                const game = await sendToGame(gameCode, { type: "UserLeft", user });
                socket.to(gameCode).emit("receivedLatestGame", game);
            } catch {
                // game already finished and its actor stopped
            }
        });

        socket.on("joinLobby", async (gameCode: string) => {
            const user = socket.data.user;
            if (!user || !getActiveGame(gameCode)) {
                return;
            }

            try {
                const existingRoom = findSocketGameCode(socket);
                if (existingRoom && existingRoom !== gameCode) {
                    await socket.leave(existingRoom);
                }

                const latestGame = await sendToGame(gameCode, { type: "UserJoined", user });
                await socket.join(gameCode);
                io.to(gameCode).emit("receivedLatestGame", latestGame);
            } catch {
                // game finished between the lookup and the join
            }
        });

        onGameEvent("leaveLobby", async (gameCode, user) => {
            await socket.leave(gameCode);
            const latestGame = await sendToGame(gameCode, { type: "UserLeft", user });
            socket.to(gameCode).emit("receivedLatestGame", latestGame);
        });

        onGameEvent("getLatestGame", async (gameCode) => {
            const game = getActiveGame(gameCode);
            if (game) {
                socket.emit("receivedLatestGame", game);
            }
        });

        onGameEvent("sendMove", async (gameCode, user, move: Move) => {
            const result = await sendToGame(gameCode, { type: "SendMove", user, move });
            socket.to(gameCode).emit("receivedMove", move);
            if (result.gameOver) {
                io.to(gameCode).emit("gameOver", result.gameOver);
            }
        });

        onGameEvent("joinAsPlayer", async (gameCode, user) => {
            const result = await sendToGame(gameCode, { type: "JoinAsPlayer", user });
            if (result.side) {
                io.to(gameCode).emit("userJoinedAsPlayer", { name: user.name, side: result.side });
            }
            io.to(gameCode).emit("receivedLatestGame", result.game);
        });

        onGameEvent("chat", async (gameCode, user, message: string) => {
            socket.to(gameCode).emit("chat", { author: user, message });
        });

        onGameEvent("claimAbandoned", async (gameCode, user, claim: "win" | "draw") => {
            const result = await sendToGame(gameCode, { type: "ClaimAbandoned", user, claim });
            io.to(gameCode).emit("gameOver", result);
        });
    });
};
