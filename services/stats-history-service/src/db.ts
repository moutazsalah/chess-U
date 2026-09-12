import { createDbPool } from "@chessu/shared";

export const db = createDbPool();

export const initReadModelTables = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS "player_stats" (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR(64) NOT NULL UNIQUE,
            display_name VARCHAR(128) NOT NULL,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            draws INTEGER DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS "game_history" (
            id SERIAL PRIMARY KEY,
            game_code VARCHAR(16) NOT NULL,
            white_id VARCHAR(64),
            white_name VARCHAR(128),
            black_id VARCHAR(64),
            black_name VARCHAR(128),
            winner VARCHAR(16),
            end_reason VARCHAR(32),
            pgn TEXT,
            started_at TIMESTAMP,
            ended_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
};
