import type { DbClient, DomainEvent } from "@chessu/shared";
import { connectRabbitMq, DOMAIN_EVENTS_EXCHANGE } from "@chessu/shared";

import { withTransaction } from "./db.js";

export const QUEUE = "stats-history-service.events";
export const DEAD_LETTER_EXCHANGE = "domain-events.dead-letter";
export const DEAD_LETTER_QUEUE = "stats-history-service.dead-letter";

// only the events this read model is built from
const SUBSCRIBED_EVENTS = ["UserRegistered", "UserUpdated", "GameFinished"];

type Player = { id?: number | string; name?: string | null };

export type GameFinishedPayload = {
    code: string;
    white?: Player;
    black?: Player;
    winner?: "white" | "black" | "draw";
    endReason?: string;
    pgn?: string;
    startedAt?: number;
    endedAt?: number;
};

export const upsertPlayer = async (client: DbClient, userId: string, displayName: string) => {
    await client.query(
        `INSERT INTO "player_stats"(user_id, display_name)
         VALUES($1, $2)
         ON CONFLICT (user_id)
         DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = CURRENT_TIMESTAMP`,
        [userId, displayName]
    );
};

const incrementResult = async (
    client: DbClient,
    player: Player | undefined,
    outcome: "wins" | "losses" | "draws"
) => {
    if (!player?.id || !player.name) {
        return;
    }
    await upsertPlayer(client, String(player.id), player.name);
    await client.query(
        `UPDATE "player_stats"
         SET ${outcome} = ${outcome} + 1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1`,
        [String(player.id)]
    );
};

const handleUserEvent = async (client: DbClient, event: DomainEvent<Player>) => {
    if (event.payload.id && event.payload.name) {
        await upsertPlayer(client, String(event.payload.id), event.payload.name);
    }
};

// also used by the initialization, which imports finished games from game-service
export const applyGameFinished = async (client: DbClient, game: GameFinishedPayload) => {
    const { white, black, winner, endReason, pgn, startedAt, endedAt, code } = game;

    // a game is recorded once, even if it arrives both from the initialization and as an event
    const inserted = await client.query(
        `INSERT INTO "game_history"(
            game_code, white_id, white_name, black_id, black_name, winner, end_reason, pgn, started_at, ended_at
         ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (game_code) DO NOTHING`,
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
    if (!inserted.rowCount) {
        return;
    }

    if (winner === "draw") {
        await incrementResult(client, white, "draws");
        await incrementResult(client, black, "draws");
    } else if (winner === "white") {
        await incrementResult(client, white, "wins");
        await incrementResult(client, black, "losses");
    } else if (winner === "black") {
        await incrementResult(client, black, "wins");
        await incrementResult(client, white, "losses");
    }
};

/*
 * Idempotent consumer: RabbitMQ guarantees at-least-once delivery, so the same event can
 * arrive twice (e.g. the service crashed after updating the DB but before the ack).
 * The event id is recorded in "processed_events" in the same transaction as the
 * read-model update, so a duplicate is detected and skipped instead of counted twice.
 */
export const applyEvent = (event: DomainEvent) =>
    withTransaction(async (client) => {
        const inserted = await client.query(
            `INSERT INTO "processed_events"(event_id, event_type)
             VALUES($1, $2)
             ON CONFLICT (event_id) DO NOTHING`,
            [event.id, event.type]
        );
        if (!inserted.rowCount) {
            console.log(`skipping duplicate event ${event.type} ${event.id}`);
            return false;
        }

        if (event.type === "UserRegistered" || event.type === "UserUpdated") {
            await handleUserEvent(client, event as DomainEvent<Player>);
        } else if (event.type === "GameFinished") {
            await applyGameFinished(client, (event as DomainEvent<GameFinishedPayload>).payload);
        }
        return true;
    });

export const initConsumer = async () => {
    const { channel } = await connectRabbitMq();

    // messages that fail processing are routed here instead of being lost
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, "fanout", { durable: true });
    await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
    await channel.bindQueue(DEAD_LETTER_QUEUE, DEAD_LETTER_EXCHANGE, "");

    // durable queue: events published while this service is down wait here until it is back
    await channel.assertQueue(QUEUE, {
        durable: true,
        arguments: { "x-dead-letter-exchange": DEAD_LETTER_EXCHANGE }
    });
    for (const eventType of SUBSCRIBED_EVENTS) {
        await channel.bindQueue(QUEUE, DOMAIN_EVENTS_EXCHANGE, eventType);
    }

    // one unacknowledged message at a time keeps events in publish order
    await channel.prefetch(1);

    await channel.consume(QUEUE, async (message: { content: Buffer } | null) => {
        if (!message) {
            return;
        }
        try {
            const event = JSON.parse(message.content.toString()) as DomainEvent;
            if (!event.id) {
                throw new Error("event without id");
            }
            await applyEvent(event);
            // ack only after the DB transaction committed
            channel.ack(message);
        } catch (error) {
            console.error("stats-history consumer error, dead-lettering message", error);
            channel.nack(message, false, false);
        }
    });

    console.log(`stats-history-service consuming ${SUBSCRIBED_EVENTS.join(", ")} from "${QUEUE}"`);
};
