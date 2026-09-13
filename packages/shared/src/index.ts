import "dotenv/config";

import { randomUUID } from "node:crypto";

import type { Express } from "express";
import express from "express";
import pg from "pg";
import amqplib from "amqplib";

export type QueueName = "domain-events";

export const requireEnv = (name: string, fallback?: string) => {
    const value = process.env[name] ?? fallback;
    if (value === undefined) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
};

export type DbClient = pg.PoolClient;

export const createDbPool = () => {
    const databaseUrl = requireEnv("DATABASE_URL");
    return new pg.Pool({ connectionString: databaseUrl });
};

export const createApp = (serviceName: string): Express => {
    const app = express();
    app.use(express.json());
    app.get("/health", (_, res) => {
        res.status(200).json({ service: serviceName, ok: true });
    });
    return app;
};

export const DOMAIN_EVENTS_EXCHANGE = "domain-events";

export interface DomainEvent<TPayload = unknown> {
    // unique per event, lets consumers detect redelivered duplicates
    id: string;
    type: string;
    source: string;
    occurredAt: string;
    payload: TPayload;
}

export const createDomainEvent = <TPayload>(
    source: string,
    type: string,
    payload: TPayload
): DomainEvent<TPayload> => ({
    id: randomUUID(),
    type,
    source,
    occurredAt: new Date().toISOString(),
    payload
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// RabbitMQ needs a few seconds after its container starts before it accepts connections,
// so keep retrying instead of giving up on the first refused connection.
export const connectRabbitMq = async (attempts = 30, delayMs = 2000) => {
    const url = requireEnv("AMQP_URL", "amqp://guest:guest@localhost:5672");
    for (let attempt = 1; ; attempt++) {
        try {
            const connection = await amqplib.connect(url);
            const channel = await connection.createChannel();
            await channel.assertExchange(DOMAIN_EVENTS_EXCHANGE, "topic", { durable: true });
            // a lost broker connection is fatal: exit and let Docker restart the service
            connection.on("close", () => {
                console.error("RabbitMQ connection closed, exiting");
                process.exit(1);
            });
            return { connection, channel };
        } catch (error) {
            if (attempt >= attempts) {
                throw error;
            }
            console.warn(`RabbitMQ not reachable (attempt ${attempt}/${attempts}), retrying...`);
            await sleep(delayMs);
        }
    }
};

export const createEventPublisher = async (serviceName: string) => {
    const { channel } = await connectRabbitMq();
    console.log(`${serviceName} connected to RabbitMQ`);
    return async (type: string, payload: unknown) => {
        const event = createDomainEvent(serviceName, type, payload);
        // routing key = event type, so consumers can bind to only the events they care about
        channel.publish(DOMAIN_EVENTS_EXCHANGE, event.type, Buffer.from(JSON.stringify(event)), {
            persistent: true,
            contentType: "application/json",
            messageId: event.id
        });
    };
};
