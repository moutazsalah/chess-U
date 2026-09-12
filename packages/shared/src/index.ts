import "dotenv/config";

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

export interface DomainEvent<TPayload = unknown> {
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
    type,
    source,
    occurredAt: new Date().toISOString(),
    payload
});

export const connectRabbitMq = async () => {
    const url = requireEnv("AMQP_URL", "amqp://guest:guest@localhost:5672");
    const connection = await amqplib.connect(url);
    const channel = await connection.createChannel();
    await channel.assertExchange("domain-events", "topic", { durable: true });
    return { connection, channel };
};
