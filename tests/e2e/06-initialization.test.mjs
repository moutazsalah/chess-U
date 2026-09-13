// Scenario: stats-history-service is deployed fresh, with empty tables.
// It never saw the past events, so on startup it initializes its read models once with direct
// calls to the owning services (identity-service for users, game-service for finished games).
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
    closeAll,
    dockerCompose,
    findHistory,
    gameDb,
    getPlayerStats,
    playFoolsMate,
    registerUser,
    statsDb,
    waitFor,
    waitForHealthy
} from "./helpers.mjs";

after(async () => {
    dockerCompose("start", "stats-history-service");
    await closeAll();
});

describe("read-model initialization", () => {
    it("a service with empty tables rebuilds its data from the owning services", async () => {
        const white = await registerUser();
        const black = await registerUser();
        await waitFor(() => getPlayerStats(black.user.id), { label: "black player_stats row" });
        const { code } = await playFoolsMate(white, black);
        await waitFor(() => findHistory(code), { label: "game_history row" });

        // simulate a brand-new deployment of stats-history-service: empty database
        dockerCompose("stop", "stats-history-service");
        await statsDb.query(`TRUNCATE "player_stats", "game_history", "processed_events"`);

        dockerCompose("start", "stats-history-service");
        await waitForHealthy("stats");

        // users came from identity-service, games from game-service
        const history = await waitFor(() => findHistory(code), {
            label: "game_history row after initialization"
        });
        assert.equal(history.winner, "black");
        assert.equal((await getPlayerStats(white.user.id)).display_name, white.user.name);

        // player stats were recomputed from the imported games
        assert.equal((await getPlayerStats(black.user.id)).wins, 1);
        assert.equal((await getPlayerStats(white.user.id)).losses, 1);

        // every finished game of the write model is in the read model
        const finished = await gameDb.query(
            `SELECT count(*)::int AS n FROM "game_write" WHERE active = FALSE`
        );
        const imported = await statsDb.query(`SELECT count(*)::int AS n FROM "game_history"`);
        assert.equal(imported.rows[0].n, finished.rows[0].n);
    });
});
