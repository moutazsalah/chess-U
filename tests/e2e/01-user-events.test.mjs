// Scenario: a user registers / renames in identity-service.
// identity-service writes to ITS database and publishes UserRegistered / UserUpdated to RabbitMQ;
// stats-history-service consumes the event and writes a copy of the data into ITS database.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
    closeAll,
    getPlayerStats,
    identityDb,
    registerUser,
    uniqueName,
    updateUserName,
    waitFor
} from "./helpers.mjs";

after(closeAll);

describe("user events replicate data from identity-service to stats-history-service", () => {
    it("UserRegistered: the new user appears in both databases", async () => {
        const { user } = await registerUser();

        // write side: identity-service's own database
        const identityRow = await identityDb.query(`SELECT * FROM "identity_user" WHERE id = $1`, [
            user.id
        ]);
        assert.equal(identityRow.rows[0].name, user.name);

        // read side: projection built asynchronously from the RabbitMQ event
        const stats = await waitFor(() => getPlayerStats(user.id), { label: "player_stats row" });
        assert.equal(stats.display_name, user.name);
        assert.equal(stats.wins, 0);
    });

    it("UserUpdated: renaming a user updates the other service's copy", async () => {
        const { cookie, user } = await registerUser();
        await waitFor(() => getPlayerStats(user.id), { label: "player_stats row" });

        const newName = uniqueName("renamed");
        await updateUserName(cookie, newName);

        const stats = await waitFor(
            async () => {
                const row = await getPlayerStats(user.id);
                return row?.display_name === newName && row;
            },
            { label: "renamed player_stats row" }
        );
        assert.equal(stats.display_name, newName);
    });
});
