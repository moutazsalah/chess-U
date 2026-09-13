// Unit tests for the GameSupervisor ("let it crash" + supervision). The database is an
// in-memory fake that can be told to fail, to simulate e.g. a lost database connection.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GameSupervisor } from "../dist/supervisor.js";

const white = { id: 1, name: "Alice" };
const black = { id: 2, name: "Bob" };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createStore = () => {
    const rows = new Map(); // code -> { state (JSON copy), active }
    const store = {
        failPersist: 0, // number of upcoming persist calls that fail
        persist: async (game, active) => {
            if (store.failPersist > 0) {
                store.failPersist--;
                throw new Error("database connection lost");
            }
            rows.set(game.code, { state: structuredClone(game), active });
        },
        publish: async () => {},
        load: async (code) => structuredClone(rows.get(code)?.state),
        loadActive: async () =>
            [...rows.values()].filter((row) => row.active).map((row) => structuredClone(row.state)),
        rows
    };
    return store;
};

const startGame = async (supervisor, store, code = "sup001") => {
    const game = { code, host: white, white, pgn: "" };
    await store.persist(game, true);
    supervisor.spawn(game);
    await supervisor.get(code).send({ type: "JoinAsPlayer", user: black });
    return code;
};

const waitForActor = async (supervisor, code) => {
    for (let i = 0; i < 100 && !supervisor.get(code); i++) {
        await sleep(5);
    }
    return supervisor.get(code);
};

describe("GameSupervisor", () => {
    it("restarts a crashed actor from its last persisted state (one-for-one)", async () => {
        const store = createStore();
        const supervisor = new GameSupervisor(store, { restartDelayMs: 1 });
        const code = await startGame(supervisor, store);
        const other = await startGame(supervisor, store, "sup002");
        const otherActor = supervisor.get(other);

        await supervisor
            .get(code)
            .send({ type: "SendMove", user: white, move: { from: "e2", to: "e4" } });

        // the next database write fails: the actor crashes instead of handling the error itself
        store.failPersist = 1;
        await assert.rejects(
            supervisor
                .get(code)
                .send({ type: "SendMove", user: black, move: { from: "e7", to: "e5" } }),
            /database connection lost/
        );

        const restarted = await waitForActor(supervisor, code);
        assert.ok(restarted, "actor was not restarted");
        // the half-applied move was discarded, the state is the last persisted one
        assert.match(restarted.snapshot.pgn, /1\. e4$/);
        // the other game was not affected
        assert.equal(supervisor.get(other), otherActor);

        // the restarted actor works normally
        await restarted.send({ type: "SendMove", user: black, move: { from: "e7", to: "e5" } });
        assert.match(supervisor.get(code).snapshot.pgn, /1\. e4 e5$/);
    });

    it("does not restart an actor for rule violations", async () => {
        const store = createStore();
        const supervisor = new GameSupervisor(store, { restartDelayMs: 1 });
        const code = await startGame(supervisor, store);
        const actor = supervisor.get(code);

        await assert.rejects(
            actor.send({ type: "SendMove", user: black, move: { from: "e7", to: "e5" } }),
            /Not your turn/
        );
        assert.equal(supervisor.get(code), actor, "the actor was replaced");
    });

    it("gives up on an actor that keeps crashing", async () => {
        const store = createStore();
        const supervisor = new GameSupervisor(store, { restartDelayMs: 1, maxRestarts: 2 });
        const code = await startGame(supervisor, store);

        store.failPersist = Infinity;
        for (let crash = 1; crash <= 3; crash++) {
            const actor = await waitForActor(supervisor, code);
            if (!actor) {
                break;
            }
            await assert.rejects(
                actor.send({ type: "SendMove", user: white, move: { from: "e2", to: "e4" } })
            );
            await sleep(20);
        }

        assert.equal(supervisor.get(code), undefined);
        assert.equal(supervisor.isRestarting(code), false);
    });

    it("recovers active games after a service restart, with players marked disconnected", async () => {
        const store = createStore();
        const before = new GameSupervisor(store);
        const code = await startGame(before, store);
        await before
            .get(code)
            .send({ type: "SendMove", user: white, move: { from: "d2", to: "d4" } });

        // a new supervisor = game-service started again with an empty memory
        const after = new GameSupervisor(store);
        assert.equal(await after.recoverActiveGames(), 1);

        const game = after.get(code).snapshot;
        assert.match(game.pgn, /1\. d4$/);
        assert.equal(game.white.connected, false);
        assert.equal(game.black.connected, false);
    });
});
