import type { DomainEvent } from "@chessu/shared";
import { connectRabbitMq } from "@chessu/shared";

import { db } from "./db.js";

const upsertPlayer = async (userId: string, displayName: string) => {
    await db.query(
        `INSERT INTO "player_stats"(user_id, display_name)
         VALUES($1, $2)
         ON CONFLICT (user_id)
         DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = CURRENT_TIMESTAMP`,
        [userId, displayName]
    );
};

const incrementResults = async (
    userId: string,
    displayName: string,
    outcome: "wins" | "losses" | "draws"
) => {
    await upsertPlayer(userId, displayName);
    await db.query(
        `UPDATE "player_stats"
         SET ${outcome} = ${outcome} + 1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1`,
        [userId]
    );
};

const handleUserEvent = async (event: DomainEvent<{ id?: number; name?: string }>) => {
    if (!event.payload.id || !event.payload.name) {
        return;
    }
    await upsertPlayer(String(event.payload.id), event.payload.name);
};

const handleGameFinished = async (
    event: DomainEvent<{
        code: string;
        white?: { id?: number | string; name?: string | null };
        black?: { id?: number | string; name?: string | null };
        winner?: "white" | "black" | "draw";
        endReason?: string;
        pgn?: string;
        startedAt?: number;
        endedAt?: number;
    }>
) => {
    const { white, black, winner, endReason, pgn, startedAt, endedAt, code } = event.payload;

    await db.query(
        `INSERT INTO "game_history"(
            game_code, white_id, white_name, black_id, black_name, winner, end_reason, pgn, started_at, ended_at
         ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
            code,
            white?.id ? String(white.id) : null,
            white?.name || null,
            black?.id ? String(black.id) : null,
            black?.name || null,
            winner || null,
            endReason || null,
            pgn || null,
            startedAt ? new Date(startedAt) : null,
            endedAt ? new Date(endedAt) : new Date()
        ]
    );

    if (white?.id && white.name) {
        await upsertPlayer(String(white.id), white.name);
    }
    if (black?.id && black.name) {
        await upsertPlayer(String(black.id), black.name);
    }

    if (winner === "draw") {
        if (white?.id && white.name) {
            await incrementResults(String(white.id), white.name, "draws");
        }
        if (black?.id && black.name) {
            await incrementResults(String(black.id), black.name, "draws");
        }
        return;
    }

    if (winner === "white") {
        if (white?.id && white.name) {
            await incrementResults(String(white.id), white.name, "wins");
        }
        if (black?.id && black.name) {
            await incrementResults(String(black.id), black.name, "losses");
        }
    } else if (winner === "black") {
        if (black?.id && black.name) {
            await incrementResults(String(black.id), black.name, "wins");
        }
        if (white?.id && white.name) {
            await incrementResults(String(white.id), white.name, "losses");
        }
    }
};

export const initConsumer = async () => {
    try {
        const { channel } = await connectRabbitMq();
        const queue = await channel.assertQueue("stats-history-service", { durable: true });
        await channel.bindQueue(queue.queue, "domain-events", "#");
        channel.consume(queue.queue, async (message: { content: Buffer } | null) => {
            if (!message) {
                return;
            }

            try {
                const event = JSON.parse(message.content.toString()) as DomainEvent;
                if (event.type === "UserRegistered" || event.type === "UserUpdated") {
                    await handleUserEvent(event as DomainEvent<{ id?: number; name?: string }>);
                }
                if (event.type === "GameFinished") {
                    await handleGameFinished(event as DomainEvent<any>);
                }
                channel.ack(message);
            } catch (error) {
                console.error("stats-history consumer error", error);
                channel.nack(message, false, false);
            }
        });
    } catch (error) {
        console.warn("stats-history-service consumer unavailable", error);
    }
};
