import { createDbPool } from "@chessu/shared";

export const db = createDbPool();

export const initIdentityTables = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS "identity_user" (
            id SERIAL PRIMARY KEY,
            name VARCHAR(128) UNIQUE NOT NULL,
            email VARCHAR(128),
            password TEXT,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            draws INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
};
