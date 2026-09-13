import { createDbPool, type DbClient } from "@chessu/shared";

export const db = createDbPool();

export const withTransaction = async <T>(work: (client: DbClient) => Promise<T>) => {
    const client = await db.connect();
    try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

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

    await db.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "game_history_game_code_key" ON "game_history"(game_code)`
    );

    // inbox of already-applied event ids, used to make the consumer idempotent
    await db.query(`
        CREATE TABLE IF NOT EXISTS "processed_events" (
            event_id UUID PRIMARY KEY,
            event_type VARCHAR(64) NOT NULL,
            processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
};
