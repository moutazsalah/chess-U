// Scenario: two players finish a game.
// Command side: game-service (actor) stores the game in its write model and publishes GameFinished.
// Query side: stats-history-service consumes the event and updates its read models
// (game_history, player_stats), which are served by its query API.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
    closeAll,
    gameDb,
    gameUrl,
    getPlayerStats,
    playFoolsMate,
    registerUser,
    statsDb,
    statsUrl,
    waitFor
} from "./helpers.mjs";

after(closeAll);

describe("CQRS: finishing a game updates the read models", () => {
    it("GameFinished flows from the write model to the read models", async () => {
        const white = await registerUser();
        const black = await registerUser();
        await waitFor(() => getPlayerStats(black.user.id), { label: "black player_stats row" });

        const { code, gameOver } = await playFoolsMate(white, black);
        assert.equal(gameOver.reason, "checkmate");
        assert.equal(gameOver.winnerSide, "black");

        // write model (game-service database): the game is stored as finished
        const writeRow = await gameDb.query(`SELECT * FROM "game_write" WHERE code = $1`, [code]);
        assert.equal(writeRow.rows[0].active, false);
        assert.equal(writeRow.rows[0].state.winner, "black");

        // the game's actor is stopped, so game-service no longer serves it as active
        assert.equal((await fetch(`${gameUrl}/v1/games/${code}`)).status, 404);

        // read model (stats-history-service database), eventually consistent
        const history = await waitFor(
            async () =>
                (await statsDb.query(`SELECT * FROM "game_history" WHERE game_code = $1`, [code]))
                    .rows[0],
            { label: "game_history row" }
        );
        assert.equal(history.winner, "black");
        assert.equal(history.end_reason, "checkmate");
        assert.equal(history.white_id, String(white.user.id));
        assert.equal(history.black_id, String(black.user.id));

        const blackStats = await getPlayerStats(black.user.id);
        const whiteStats = await getPlayerStats(white.user.id);
        assert.deepEqual([blackStats.wins, blackStats.losses], [1, 0]);
        assert.deepEqual([whiteStats.wins, whiteStats.losses], [0, 1]);

        // query API of the read side
        const profile = await (await fetch(`${statsUrl}/v1/users/${black.user.name}`)).json();
        assert.equal(profile.wins, 1);
        assert.equal(profile.recentGames[0].code, code);
    });
});
