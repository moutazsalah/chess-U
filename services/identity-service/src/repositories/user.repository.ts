import type { User } from "@chessu/types";

import { db } from "../db.js";

export interface StoredUser extends User {
    password?: string;
}

export const createUser = async (user: User, password: string) => {
    if (user.name === "Guest" || user.email === undefined) {
        return null;
    }

    const result = await db.query(
        `INSERT INTO "identity_user"(name, email, password)
         VALUES($1, $2, $3)
         RETURNING id, name, email, wins, losses, draws`,
        [user.name, user.email || null, password]
    );

    return result.rows[0] as User;
};

export const findById = async (id: number) => {
    const result = await db.query(
        `SELECT id, name, email, wins, losses, draws
         FROM "identity_user"
         WHERE id = $1`,
        [id]
    );
    return result.rows[0] as User | undefined;
};

export const findByNameOrEmail = async (
    user: Pick<User, "name" | "email">,
    includePassword = false,
    limit = 1
) => {
    const result = await db.query(
        `SELECT id, name, email, wins, losses, draws${
            includePassword ? ", password" : ""
        }
         FROM "identity_user"
         WHERE name = $1 OR email = $2
         LIMIT $3`,
        [user.name, user.email, limit]
    );

    return result.rows as StoredUser[];
};

export const updateUserById = async (id: number, updatedUser: StoredUser) => {
    if (updatedUser.password) {
        const result = await db.query(
            `UPDATE "identity_user"
             SET name = $1, email = $2, password = $3
             WHERE id = $4
             RETURNING id, name, email, wins, losses, draws`,
            [updatedUser.name, updatedUser.email, updatedUser.password, id]
        );
        return result.rows[0] as User | undefined;
    }

    const result = await db.query(
        `UPDATE "identity_user"
         SET name = $1, email = $2
         WHERE id = $3
         RETURNING id, name, email, wins, losses, draws`,
        [updatedUser.name, updatedUser.email, id]
    );
    return result.rows[0] as User | undefined;
};
