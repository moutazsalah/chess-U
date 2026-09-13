import type { Game, User } from "@chessu/types";
import { nanoid } from "nanoid";

import type { GameMessage, GameReplies } from "./actor.js";
import { listActiveGameStates, loadGameState, upsertGameState } from "./db.js";
import { publishEvent } from "./publisher.js";
import { GameSupervisor } from "./supervisor.js";

// the supervisor owns all game actors, wired to the real database and RabbitMQ
const supervisor = new GameSupervisor({
    persist: upsertGameState,
    publish: publishEvent,
    load: loadGameState,
    loadActive: listActiveGameStates
});

const chooseStartingSide = (side: string, user: User) => {
    if (side === "white") {
        return { white: user };
    }
    if (side === "black") {
        return { black: user };
    }
    return Math.floor(Math.random() * 2) === 0 ? { white: user } : { black: user };
};

export const recoverActiveGames = () => supervisor.recoverActiveGames();

export const listPublicGames = () =>
    supervisor
        .list()
        .map((actor) => actor.snapshot)
        .filter((game) => !game.unlisted && !game.winner);

export const getActiveGame = (code: string) => supervisor.get(code)?.snapshot;

export const createGame = async (user: User, side: string, unlisted: boolean) => {
    const host: User = { id: user.id, name: user.name, connected: false };
    const game: Game = {
        code: nanoid(6),
        host,
        pgn: "",
        unlisted,
        ...chooseStartingSide(side, host)
    };

    await upsertGameState(game, true);
    supervisor.spawn(game);
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
    const actor = supervisor.get(code);
    if (!actor) {
        const reason = supervisor.isRestarting(code)
            ? "Game is restarting, try again"
            : "Game not found";
        return Promise.reject(new Error(reason));
    }
    return actor.send(message) as Promise<GameReplies[M["type"]]>;
};
