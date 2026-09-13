// Scenario: events are injected straight into RabbitMQ, the way the broker could deliver them.
// - The same event delivered twice (at-least-once delivery) must be applied only once.
// - A message the consumer cannot process must go to the dead-letter queue, not be lost.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

import {
    DEAD_LETTER_QUEUE,
    closeAll,
    getPlayerStats,
    queueDepth,
    sleep,
    statsDb,
    uniqueName,
    waitFor,
    withRabbitChannel
} from "./helpers.mjs";

after(closeAll);

const publish = (routingKey, body) =>
    withRabbitChannel(async (channel) => {
        channel.publish("domain-events", routingKey, Buffer.from(body), { persistent: true });
        // make sure the broker has the message before the connection closes
        await channel.checkExchange("domain-events");
    });

describe("consumer reliability", () => {
    it("a duplicated GameFinished event is counted only once (idempotent consumer)", async () => {
        const winnerId = uniqueName("guest");
        const loserId = uniqueName("guest");
        const code = uniqueName("g").slice(0, 8);
        const event = {
            id: randomUUID(),
            type: "GameFinished",
            source: "e2e-test",
            occurredAt: new Date().toISOString(),
            payload: {
                code,
                white: { id: winnerId, name: "DupWhite" },
                black: { id: loserId, name: "DupBlack" },
                winner: "white",
                endReason: "checkmate",
                pgn: "",
                startedAt: Date.now(),
                endedAt: Date.now()
            }
        };

        await publish("GameFinished", JSON.stringify(event));
        await publish("GameFinished", JSON.stringify(event));

        await waitFor(() => getPlayerStats(winnerId), { label: "winner player_stats row" });
        await waitFor(async () => (await queueDepth("stats-history-service.events")) === 0, {
            label: "queue drained"
        });
        await sleep(500);

        const history = await statsDb.query(`SELECT * FROM "game_history" WHERE game_code = $1`, [
            code
        ]);
        assert.equal(history.rowCount, 1);
        assert.equal((await getPlayerStats(winnerId)).wins, 1);
        assert.equal((await getPlayerStats(loserId)).losses, 1);
    });

    it("an unprocessable message is moved to the dead-letter queue", async () => {
        const before = await queueDepth(DEAD_LETTER_QUEUE);

        await publish("GameFinished", "this is not valid JSON");

        await waitFor(async () => (await queueDepth(DEAD_LETTER_QUEUE)) === before + 1, {
            label: "message in dead-letter queue"
        });
    });
});
