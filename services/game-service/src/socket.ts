import type { User } from "@chessu/types";
import type { Server, Socket } from "socket.io";

import { resolveUserFromCookie } from "./auth.js";
import {
    claimAbandoned,
    getActiveGame,
    joinAsPlayer,
    markUserJoined,
    markUserLeft,
    sendMove
} from "./runtime.js";

type GameSocket = Socket & {
    data: {
        user?: User;
    };
};

const findSocketGameCode = (socket: Socket) => Array.from(socket.rooms).find((room) => room !== socket.id);

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
        socket.on("disconnect", async () => {
            const gameCode = findSocketGameCode(socket);
            if (!gameCode || !socket.data.user) {
                return;
            }
            const game = await markUserLeft(gameCode, socket.data.user);
            socket.to(gameCode).emit("receivedLatestGame", game);
        });

        socket.on("joinLobby", async (gameCode: string) => {
            if (!socket.data.user) {
                return;
            }

            const game = getActiveGame(gameCode);
            if (!game) {
                return;
            }

            const existingRoom = findSocketGameCode(socket);
            if (existingRoom && existingRoom !== gameCode) {
                await socket.leave(existingRoom);
            }

            const latestGame = await markUserJoined(gameCode, socket.data.user);
            await socket.join(gameCode);
            io.to(gameCode).emit("receivedLatestGame", latestGame);
        });

        socket.on("leaveLobby", async () => {
            const gameCode = findSocketGameCode(socket);
            if (!gameCode || !socket.data.user) {
                return;
            }

            const latestGame = await markUserLeft(gameCode, socket.data.user);
            await socket.leave(gameCode);
            socket.to(gameCode).emit("receivedLatestGame", latestGame);
        });

        socket.on("getLatestGame", () => {
            const gameCode = findSocketGameCode(socket);
            if (!gameCode) {
                return;
            }
            const game = getActiveGame(gameCode);
            if (game) {
                socket.emit("receivedLatestGame", game);
            }
        });

        socket.on("sendMove", async (move: { from: string; to: string; promotion?: string }) => {
            const gameCode = findSocketGameCode(socket);
            if (!gameCode || !socket.data.user) {
                return;
            }

            try {
                const result = await sendMove(gameCode, socket.data.user, move);
                socket.to(gameCode).emit("receivedMove", move);

                if (result.gameOver) {
                    io.to(gameCode).emit("gameOver", {
                        ...result.gameOver
                    });
                }
            } catch (error) {
                const game = getActiveGame(gameCode);
                if (game) {
                    socket.emit("receivedLatestGame", game);
                }
            }
        });

        socket.on("joinAsPlayer", async () => {
            const gameCode = findSocketGameCode(socket);
            if (!gameCode || !socket.data.user) {
                return;
            }

            const result = await joinAsPlayer(gameCode, socket.data.user);
            if (result.side) {
                io.to(gameCode).emit("userJoinedAsPlayer", {
                    name: socket.data.user.name,
                    side: result.side
                });
            }
            io.to(gameCode).emit("receivedLatestGame", result.game);
        });

        socket.on("chat", (message: string) => {
            const gameCode = findSocketGameCode(socket);
            if (!gameCode || !socket.data.user) {
                return;
            }

            socket.to(gameCode).emit("chat", {
                author: socket.data.user,
                message
            });
        });

        socket.on("claimAbandoned", async (type: "win" | "draw") => {
            const gameCode = findSocketGameCode(socket);
            if (!gameCode || !socket.data.user) {
                return;
            }

            try {
                const result = await claimAbandoned(gameCode, socket.data.user, type);
                io.to(gameCode).emit("gameOver", result);
            } catch (error) {
                const game = getActiveGame(gameCode);
                if (game) {
                    socket.emit("receivedLatestGame", game);
                }
            }
        });
    });
};
