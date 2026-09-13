// Scenario: all external calls go through the API gateway, the single entry point.
// It forwards /identity, /game and /stats to the owning service and hides internal endpoints.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { closeAll, gatewayUrl } from "./helpers.mjs";

after(closeAll);

describe("API gateway", () => {
    it("forwards each route prefix to the service that owns it", async () => {
        for (const [prefix, service] of [
            ["identity", "identity-service"],
            ["game", "game-service"],
            ["stats", "stats-history-service"]
        ]) {
            const response = await fetch(`${gatewayUrl}/${prefix}/health`);
            assert.equal(response.status, 200);
            assert.equal((await response.json()).service, service);
        }
    });

    it("does not expose internal service-to-service endpoints", async () => {
        for (const path of ["/identity/v1/internal/users", "/game/v1/internal/games/finished"]) {
            assert.equal((await fetch(`${gatewayUrl}${path}`)).status, 404, path);
        }
    });

    it("answers 404 for routes that belong to no service", async () => {
        assert.equal((await fetch(`${gatewayUrl}/payments/v1/anything`)).status, 404);
    });

    it("handles CORS for the frontend in one place", async () => {
        const response = await fetch(`${gatewayUrl}/stats/v1/leaderboard`, {
            method: "OPTIONS",
            headers: {
                Origin: "http://localhost:3000",
                "Access-Control-Request-Method": "GET"
            }
        });
        assert.equal(response.status, 204);
        assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:3000");
    });
});
