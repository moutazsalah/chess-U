// Scenario: identity-service is DOWN.
// Already logged-in players can still play: game-service verifies their signed token itself and
// does not call identity-service. The gateway reports only the identity routes as unavailable.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
    closeAll,
    dockerCompose,
    findHistory,
    gatewayUrl,
    getPlayerStats,
    playFoolsMate,
    registerUser,
    waitFor,
    waitForHealthy
} from "./helpers.mjs";

after(async () => {
    dockerCompose("start", "identity-service");
    await waitForHealthy("identity");
    await closeAll();
});

describe("services keep working while another service is down", () => {
    it("a full game can be played while identity-service is stopped", async () => {
        const white = await registerUser();
        const black = await registerUser();
        await waitFor(() => getPlayerStats(black.user.id), { label: "black player_stats row" });

        dockerCompose("stop", "identity-service");

        // the gateway isolates the failure: 503 for identity only
        assert.equal((await fetch(`${gatewayUrl}/identity/health`)).status, 503);
        assert.equal((await fetch(`${gatewayUrl}/game/health`)).status, 200);
        assert.equal((await fetch(`${gatewayUrl}/stats/v1/leaderboard`)).status, 200);

        const { code, gameOver } = await playFoolsMate(white, black);
        assert.equal(gameOver.winnerSide, "black");

        const history = await waitFor(() => findHistory(code), { label: "game_history row" });
        assert.equal(history.black_id, String(black.user.id));
    });

    it("requests without a valid token are rejected by game-service", async () => {
        const response = await fetch(`${gatewayUrl}/game/v1/games`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Cookie: "chessu_token=forged.token.value"
            },
            body: JSON.stringify({ side: "white" })
        });
        assert.equal(response.status, 401);
    });
});
