import type { Game, User } from "@chessu/types";
import { nanoid } from "nanoid";

import { GameActor, type GameMessage, type GameReplies } from "./actor.js";
import { upsertGameState } from "./db.js";
import { publishEvent } from "./publisher.js";

// Actor registry: one GameActor per active game, addressed by game code.
const actors = new Map<string, GameActor>();

const actorDeps = {
    persist: upsertGameState,
    publish: publishEvent,
    onStopped: (code: string) => actors.delete(code)
};

const chooseStartingSide = (side: string, user: User) => {
    if (side === "white") {
        return { white: user };
    }
    if (side === "black") {
        return { black: user };
    }
    return Math.floor(Math.random() * 2) === 0 ? { white: user } : { black: user };
};

export const listPublicGames = () =>
    Array.from(actors.values())
        .map((actor) => actor.snapshot)
        .filter((game) => !game.unlisted && !game.winner);

export const getActiveGame = (code: string) => actors.get(code)?.snapshot;

export const createGame = async (user: User, side: string, unlisted: boolean) => {
    const host: User = { id: user.id, name: user.name, connected: false };
    const game: Game = {
        code: nanoid(6),
        host,
        pgn: "",
        unlisted,
        ...chooseStartingSide(side, host)
    };

    actors.set(game.code as string, new GameActor(game, actorDeps));
    await upsertGameState(game, true);
    await publishEvent("GameCreated", {
        code: game.code,
        host: game.host,
        white: game.white,
        black: game.black,
        unlisted: game.unlisted
    });

    return game;
};

// deliver a message to the game's actor; rejects if the game no longer exists
export const sendToGame = <M extends GameMessage>(code: string, message: M) => {
    const actor = actors.get(code);
    if (!actor) {
        return Promise.reject(new Error("Game not found"));
    }
    return actor.send(message) as Promise<GameReplies[M["type"]]>;
};
