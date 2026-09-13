// Scenario: the consumer microservice is DOWN while an event happens.
// Because services communicate through a durable RabbitMQ queue (not direct HTTP calls),
// game-service keeps working, the GameFinished event waits in the queue, and
// stats-history-service catches up as soon as it is started again.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
    STATS_QUEUE,
    closeAll,
    dockerCompose,
    getPlayerStats,
    playFoolsMate,
    queueDepth,
    registerUser,
    sleep,
    statsDb,
    statsUrl,
    waitFor
} from "./helpers.mjs";

after(async () => {
    // never leave the stack broken, even if an assertion failed
    dockerCompose("start", "stats-history-service");
    await closeAll();
});

const findHistory = async (code) =>
    (await statsDb.query(`SELECT * FROM "game_history" WHERE game_code = $1`, [code])).rows[0];

describe("message queue decouples the services", () => {
    it("events published while stats-history-service is down are processed after restart", async () => {
        const white = await registerUser();
        const black = await registerUser();
        await waitFor(() => getPlayerStats(black.user.id), { label: "black player_stats row" });

        dockerCompose("stop", "stats-history-service");

        // game-service does not depend on the consumer being up
        const { code } = await playFoolsMate(white, black);

        await sleep(1000);
        assert.equal(
            await findHistory(code),
            undefined,
            "read model changed while consumer was down"
        );
        assert.ok((await queueDepth(STATS_QUEUE)) >= 1, "GameFinished is not waiting in the queue");

        dockerCompose("start", "stats-history-service");

        const history = await waitFor(() => findHistory(code), {
            timeoutMs: 60000,
            label: "game_history row after restart"
        });
        assert.equal(history.winner, "black");
        assert.equal((await getPlayerStats(black.user.id)).wins, 1);
        assert.equal(await queueDepth(STATS_QUEUE), 0);

        // service is serving queries again
        await waitFor(async () => (await fetch(`${statsUrl}/health`).catch(() => null))?.ok, {
            timeoutMs: 30000,
            label: "stats-history-service health"
        });
    });
});
