import type { Game, User } from "@chessu/types";
import { createDomainEvent } from "@chessu/shared";
import { Chess } from "chess.js";
import { nanoid } from "nanoid";

import { publishDomainEvent } from "./publisher.js";
import { upsertGameState } from "./db.js";

const activeGames = new Map<string, Game>();
const actorChains = new Map<string, Promise<void>>();

const chooseStartingSide = (side: string, user: User) => {
    if (side === "white") {
        return { white: user };
    }
    if (side === "black") {
        return { black: user };
    }
    return Math.floor(Math.random() * 2) === 0 ? { white: user } : { black: user };
};

const enqueueGameActor = async <T>(gameCode: string, task: () => Promise<T>) => {
    const previous = actorChains.get(gameCode) || Promise.resolve();
    let current: Promise<void>;
    const result = previous.then(task, task);
    current = result.then(
        () => undefined,
        () => undefined
    );
    actorChains.set(gameCode, current);
    try {
        return await result;
    } finally {
        if (actorChains.get(gameCode) === current) {
            actorChains.delete(gameCode);
        }
    }
};

const persistAndBroadcastEvent = async (game: Game, type: string, payload: unknown, active = true) => {
    await upsertGameState(game, active);
    await publishDomainEvent(createDomainEvent("game-service", type, payload));
};

export const listPublicGames = () =>
    Array.from(activeGames.values()).filter((game) => !game.unlisted && !game.winner);

export const getActiveGame = (code: string) => activeGames.get(code);

export const createGame = async (user: User, side: string, unlisted: boolean) => {
    const host: User = {
        id: user.id,
        name: user.name,
        connected: false
    };
    const game: Game = {
        code: nanoid(6),
        host,
        pgn: "",
        unlisted,
        ...chooseStartingSide(side, host)
    };

    activeGames.set(game.code as string, game);
    await persistAndBroadcastEvent(
        game,
        "GameCreated",
        {
            code: game.code,
            host: game.host,
            white: game.white,
            black: game.black,
            unlisted: game.unlisted
        }
    );

    return game;
};

export const withGameActor = <T>(gameCode: string, task: (game: Game) => Promise<T>) =>
    enqueueGameActor(gameCode, async () => {
        const game = activeGames.get(gameCode);
        if (!game) {
            throw new Error("Game not found");
        }
        return task(game);
    });

export const markUserJoined = async (gameCode: string, user: User) =>
    withGameActor(gameCode, async (game) => {
        const host = game.host;
        const white = game.white;
        const black = game.black;

        if (host && host.id === user.id) {
            host.connected = true;
            host.name = user.name;
        }

        if (white && white.id === user.id) {
            white.connected = true;
            white.disconnectedOn = undefined;
            white.name = user.name;
        } else if (black && black.id === user.id) {
            black.connected = true;
            black.disconnectedOn = undefined;
            black.name = user.name;
        } else {
            if (!game.observers) {
                game.observers = [];
            }
            const existingObserver = game.observers.find((observer) => observer.id === user.id);
            if (!existingObserver) {
                game.observers.push({ id: user.id, name: user.name });
            }
        }

        if (game.timeout) {
            clearTimeout(game.timeout);
            game.timeout = undefined;
        }

        await upsertGameState(game);
        return game;
    });

export const markUserLeft = async (gameCode: string, user: User) =>
    withGameActor(gameCode, async (game) => {
        const observer = game.observers?.find((entry) => entry.id === user.id);
        const white = game.white;
        const black = game.black;
        if (observer) {
            game.observers?.splice(game.observers.indexOf(observer), 1);
        }

        if (white && white.id === user.id) {
            white.connected = false;
            white.disconnectedOn = Date.now();
        } else if (black && black.id === user.id) {
            black.connected = false;
            black.disconnectedOn = Date.now();
        }

        await upsertGameState(game);
        return game;
    });

export const joinAsPlayer = async (gameCode: string, user: User) =>
    withGameActor(gameCode, async (game) => {
        const observer = game.observers?.find((entry) => entry.id === user.id);
        const sessionUser: User = {
            id: user.id,
            name: user.name,
            connected: true
        };

        let side: "white" | "black" | null = null;

        if (!game.white) {
            game.white = sessionUser;
            side = "white";
        } else if (!game.black) {
            game.black = sessionUser;
            side = "black";
        }

        if (observer) {
            game.observers?.splice(game.observers.indexOf(observer), 1);
        }

        if (side && !game.startedAt) {
            game.startedAt = Date.now();
        }

        await persistAndBroadcastEvent(
            game,
            "PlayerJoinedGame",
            {
                code: game.code,
                player: sessionUser,
                side
            }
        );

        return { game, side };
    });

export const sendMove = async (
    gameCode: string,
    user: User,
    move: { from: string; to: string; promotion?: string }
) =>
    withGameActor(gameCode, async (game) => {
        if (game.endReason || game.winner) {
            throw new Error("Game already finished");
        }

        const chess = new Chess();
        if (game.pgn) {
            chess.loadPgn(game.pgn);
        }

        const previousTurn = chess.turn();
        if (
            (previousTurn === "w" && user.id !== game.white?.id) ||
            (previousTurn === "b" && user.id !== game.black?.id)
        ) {
            throw new Error("Not your turn");
        }

        const appliedMove = chess.move(move);
        if (!appliedMove) {
            throw new Error("Invalid move");
        }

        game.pgn = chess.pgn();

        await persistAndBroadcastEvent(
            game,
            "MovePlayed",
            {
                code: game.code,
                move,
                pgn: game.pgn,
                player: {
                    id: user.id,
                    name: user.name
                }
            }
        );

        if (!chess.isGameOver()) {
            return {
                game,
                move,
                gameOver: null
            };
        }

        let reason: Game["endReason"] = "draw";
        if (chess.isCheckmate()) reason = "checkmate";
        else if (chess.isStalemate()) reason = "stalemate";
        else if (chess.isThreefoldRepetition()) reason = "repetition";
        else if (chess.isInsufficientMaterial()) reason = "insufficient";

        const winnerSide =
            reason === "checkmate" ? (previousTurn === "w" ? "white" : "black") : "draw";
        const winnerName =
            winnerSide === "white"
                ? game.white?.name
                : winnerSide === "black"
                  ? game.black?.name
                  : undefined;

        game.endReason = reason;
        game.winner = winnerSide === "draw" ? "draw" : winnerSide;
        game.endedAt = Date.now();

        await persistAndBroadcastEvent(
            game,
            "GameFinished",
            {
                code: game.code,
                white: game.white,
                black: game.black,
                winner: game.winner,
                winnerName,
                endReason: game.endReason,
                pgn: game.pgn,
                startedAt: game.startedAt,
                endedAt: game.endedAt
            },
            false
        );

        activeGames.delete(gameCode);

        return {
            game,
            move,
            gameOver: {
                reason,
                winnerName,
                winnerSide: winnerSide === "draw" ? undefined : winnerSide
            }
        };
    });

export const claimAbandoned = async (gameCode: string, user: User, type: "win" | "draw") =>
    withGameActor(gameCode, async (game) => {
        if (
            !game.pgn ||
            !game.white ||
            !game.black ||
            (game.white.id !== user.id && game.black.id !== user.id)
        ) {
            throw new Error("Invalid abandoned claim");
        }

        const isWhitePlayer = game.white.id === user.id;
        const opponent = isWhitePlayer ? game.black : game.white;
        if (opponent.connected || Date.now() - (opponent.disconnectedOn as number) < 50000) {
            throw new Error("Opponent is still connected");
        }

        game.endReason = "abandoned";
        game.winner = type === "draw" ? "draw" : isWhitePlayer ? "white" : "black";
        game.endedAt = Date.now();

        await persistAndBroadcastEvent(
            game,
            "GameFinished",
            {
                code: game.code,
                white: game.white,
                black: game.black,
                winner: game.winner,
                winnerName: user.name,
                endReason: game.endReason,
                pgn: game.pgn,
                startedAt: game.startedAt,
                endedAt: game.endedAt
            },
            false
        );

        activeGames.delete(gameCode);

        return {
            reason: game.endReason,
            winnerName: user.name,
            winnerSide: game.winner === "draw" ? undefined : game.winner
        };
    });
