import type { Game } from "@chessu/types";
import { createDbPool } from "@chessu/shared";

export const db = createDbPool();

export const initGameTables = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS "game_write" (
            id SERIAL PRIMARY KEY,
            code VARCHAR(16) UNIQUE NOT NULL,
            state JSONB NOT NULL,
            active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
};

const sanitizeGameForStorage = (game: Game) => ({
    ...game,
    timeout: undefined
});

export const upsertGameState = async (game: Game, active = true) => {
    await db.query(
        `INSERT INTO "game_write"(code, state, active)
         VALUES($1, $2::jsonb, $3)
         ON CONFLICT (code)
         DO UPDATE SET state = EXCLUDED.state, active = EXCLUDED.active, updated_at = CURRENT_TIMESTAMP`,
        [game.code, JSON.stringify(sanitizeGameForStorage(game)), active]
    );
};

const loadStates = async (query: string, params: unknown[] = []) =>
    (await db.query(query, params)).rows.map((row) => row.state as Game);

export const loadGameState = async (code: string) =>
    (await loadStates(`SELECT state FROM "game_write" WHERE code = $1`, [code]))[0];

export const listActiveGameStates = () =>
    loadStates(`SELECT state FROM "game_write" WHERE active = TRUE ORDER BY created_at`);

export const listFinishedGameStates = () =>
    loadStates(`SELECT state FROM "game_write" WHERE active = FALSE ORDER BY updated_at`);
