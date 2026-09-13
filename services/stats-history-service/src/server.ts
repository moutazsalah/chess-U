import { createApp } from "@chessu/shared";

import { db, initReadModelTables } from "./db.js";
import { initConsumer } from "./consumer.js";
import { initializeReadModels } from "./initialize.js";

const app = createApp("stats-history-service");
const port = Number(process.env.PORT || 4003);

await initReadModelTables();
// fill empty read models from the owning services before consuming new events
await initializeReadModels();
await initConsumer();

const normalizeUserId = (value: string | null) => {
    if (!value) {
        return undefined;
    }
    return /^\d+$/.test(value) ? Number(value) : value;
};

const mapHistoryRow = (row: Record<string, any>) => ({
    id: row.id,
    code: row.game_code,
    white: { id: normalizeUserId(row.white_id), name: row.white_name },
    black: { id: normalizeUserId(row.black_id), name: row.black_name },
    winner: row.winner,
    endReason: row.end_reason,
    pgn: row.pgn,
    startedAt: row.started_at?.getTime(),
    endedAt: row.ended_at?.getTime()
});

app.get("/v1/leaderboard", async (_, res) => {
    const result = await db.query(
        `SELECT user_id, display_name, wins, losses, draws
         FROM "player_stats"
         ORDER BY wins DESC, draws DESC, display_name ASC
         LIMIT 20`
    );
    res.status(200).json(result.rows);
});

app.get("/v1/games", async (req, res) => {
    const id = req.query.id ? Number(req.query.id) : undefined;
    const userId = req.query.userid ? String(req.query.userid) : undefined;

    if (id) {
        const result = await db.query(`SELECT * FROM "game_history" WHERE id = $1`, [id]);
        if (!result.rowCount) {
            res.status(404).end();
            return;
        }
        const row = result.rows[0];
        res.status(200).json(mapHistoryRow(row));
        return;
    }

    if (userId) {
        const result = await db.query(
            `SELECT *
             FROM "game_history"
             WHERE white_id = $1 OR black_id = $1
             ORDER BY ended_at DESC
             LIMIT 20`,
            [userId]
        );
        res.status(200).json(result.rows.map(mapHistoryRow));
        return;
    }

    res.status(400).json({ message: "Expected id or userid query parameter" });
});

app.get("/v1/users/:name", async (req, res) => {
    const playerResult = await db.query(
        `SELECT user_id, display_name, wins, losses, draws
         FROM "player_stats"
         WHERE display_name = $1`,
        [req.params.name]
    );

    if (!playerResult.rowCount) {
        res.status(404).end();
        return;
    }

    const player = playerResult.rows[0];
    const recentGames = await db.query(
        `SELECT *
         FROM "game_history"
         WHERE white_id = $1 OR black_id = $1
         ORDER BY ended_at DESC
         LIMIT 20`,
        [player.user_id]
    );

    res.status(200).json({
        id: normalizeUserId(player.user_id),
        name: player.display_name,
        wins: player.wins,
        losses: player.losses,
        draws: player.draws,
        recentGames: recentGames.rows.map(mapHistoryRow)
    });
});

app.listen(port, () => {
    console.log(`stats-history-service listening on :${port}`);
});
