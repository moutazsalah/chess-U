// Unit tests for the GameActor (actor model). No database or RabbitMQ needed:
// the actor's side effects are replaced with in-memory fakes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GameActor } from "../dist/actor.js";

const white = { id: 1, name: "Alice" };
const black = { id: 2, name: "Bob" };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createActor = ({ persistDelayMs = 0 } = {}) => {
    const published = [];
    const stopped = [];
    let running = 0;
    let maxConcurrent = 0;

    const deps = {
        // slow, awaited I/O: exactly where interleaving would happen without a mailbox
        persist: async () => {
            running++;
            maxConcurrent = Math.max(maxConcurrent, running);
            await sleep(persistDelayMs);
            running--;
        },
        publish: async (type, payload) => {
            published.push({ type, payload });
        },
        onStopped: (code) => stopped.push(code),
        onCrashed: (code, error) => {
            throw error;
        }
    };

    const actor = new GameActor({ code: "test01", host: white, white, pgn: "" }, deps);
    return { actor, published, stopped, maxConcurrent: () => maxConcurrent };
};

describe("GameActor", () => {
    it("processes concurrently sent messages one at a time, in arrival order", async () => {
        const { actor, maxConcurrent } = createActor({ persistDelayMs: 20 });
        await actor.send({ type: "JoinAsPlayer", user: black });

        // fire all moves at once without awaiting in between
        const results = await Promise.allSettled([
            actor.send({ type: "SendMove", user: white, move: { from: "e2", to: "e4" } }),
            actor.send({ type: "SendMove", user: black, move: { from: "e7", to: "e5" } }),
            actor.send({ type: "SendMove", user: white, move: { from: "g1", to: "f3" } })
        ]);

        assert.deepEqual(
            results.map((result) => result.status),
            ["fulfilled", "fulfilled", "fulfilled"]
        );
        assert.equal(maxConcurrent(), 1, "a second message started before the first finished");
        assert.match(actor.snapshot.pgn, /1\. e4 e5 2\. Nf3/);
    });

    it("rejects a double move by the same player even when both arrive simultaneously", async () => {
        const { actor } = createActor({ persistDelayMs: 20 });
        await actor.send({ type: "JoinAsPlayer", user: black });

        const results = await Promise.allSettled([
            actor.send({ type: "SendMove", user: white, move: { from: "e2", to: "e4" } }),
            actor.send({ type: "SendMove", user: white, move: { from: "d2", to: "d4" } })
        ]);

        assert.equal(results[0].status, "fulfilled");
        assert.equal(results[1].status, "rejected");
        assert.match(results[1].reason.message, /Not your turn/);
        assert.match(actor.snapshot.pgn, /1\. e4$/);
    });

    it("gives the free seat to exactly one of several players joining at once", async () => {
        const { actor } = createActor({ persistDelayMs: 10 });
        const contenders = [3, 4, 5, 6].map((id) => ({ id, name: `P${id}` }));

        const results = await Promise.all(
            contenders.map((user) => actor.send({ type: "JoinAsPlayer", user }))
        );

        assert.deepEqual(
            results.map((result) => result.side),
            ["black", null, null, null]
        );
        assert.equal(actor.snapshot.black.id, 3);
    });

    it("publishes GameFinished on checkmate, then stops and rejects further messages", async () => {
        const { actor, published, stopped } = createActor();
        await actor.send({ type: "JoinAsPlayer", user: black });

        // fool's mate: black wins in 2 moves
        await actor.send({ type: "SendMove", user: white, move: { from: "f2", to: "f3" } });
        await actor.send({ type: "SendMove", user: black, move: { from: "e7", to: "e5" } });
        await actor.send({ type: "SendMove", user: white, move: { from: "g2", to: "g4" } });
        const final = await actor.send({
            type: "SendMove",
            user: black,
            move: { from: "d8", to: "h4" }
        });

        assert.deepEqual(final.gameOver, {
            reason: "checkmate",
            winnerName: "Bob",
            winnerSide: "black"
        });

        const finished = published.find((event) => event.type === "GameFinished");
        assert.ok(finished, "GameFinished was not published");
        assert.equal(finished.payload.winner, "black");
        assert.equal(finished.payload.endReason, "checkmate");
        assert.deepEqual(stopped, ["test01"]);

        await assert.rejects(
            actor.send({ type: "SendMove", user: white, move: { from: "a2", to: "a3" } }),
            /Game already finished/
        );
    });

    it("rejects illegal moves without changing the state", async () => {
        const { actor, published } = createActor();
        await actor.send({ type: "JoinAsPlayer", user: black });

        await assert.rejects(
            actor.send({ type: "SendMove", user: white, move: { from: "e2", to: "e5" } })
        );
        assert.equal(actor.snapshot.pgn, "");
        assert.equal(published.filter((event) => event.type === "MovePlayed").length, 0);
    });
});
