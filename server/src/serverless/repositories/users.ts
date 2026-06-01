import type { User } from "@chessu/types";
import {
    GetCommand,
    PutCommand,
    QueryCommand,
    TransactWriteCommand,
    UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { dynamo, tableName } from "./dynamo.js";

type StoredUser = User & {
    pk: string;
    sk: string;
    password?: string;
    createdAt: number;
};

const publicUser = (user: StoredUser) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    wins: user.wins ?? 0,
    losses: user.losses ?? 0,
    draws: user.draws ?? 0
});

export async function createUser(user: User, password: string) {
    if (!user.name || !user.email || user.name === "Guest") return null;
    const id = Date.now();
    const createdAt = Date.now();
    const item: StoredUser = {
        pk: `USER#${id}`,
        sk: "PROFILE",
        id,
        name: user.name,
        email: user.email,
        password,
        wins: 0,
        losses: 0,
        draws: 0,
        createdAt
    };

    await dynamo.send(
        new TransactWriteCommand({
            TransactItems: [
                {
                    Put: {
                        TableName: tableName,
                        Item: item,
                        ConditionExpression: "attribute_not_exists(pk)"
                    }
                },
                {
                    Put: {
                        TableName: tableName,
                        Item: { pk: `USER_NAME#${user.name}`, sk: "LOOKUP", userId: id },
                        ConditionExpression: "attribute_not_exists(pk)"
                    }
                },
                {
                    Put: {
                        TableName: tableName,
                        Item: { pk: `USER_EMAIL#${user.email}`, sk: "LOOKUP", userId: id },
                        ConditionExpression: "attribute_not_exists(pk)"
                    }
                }
            ]
        })
    );

    return publicUser(item);
}

export async function findUserById(id: number, includePassword = false) {
    const res = await dynamo.send(
        new GetCommand({ TableName: tableName, Key: { pk: `USER#${id}`, sk: "PROFILE" } })
    );
    const user = res.Item as StoredUser | undefined;
    if (!user) return null;
    return includePassword ? user : publicUser(user);
}

async function lookupUserId(type: "NAME" | "EMAIL", value?: string | null) {
    if (!value) return null;
    const res = await dynamo.send(
        new GetCommand({ TableName: tableName, Key: { pk: `USER_${type}#${value}`, sk: "LOOKUP" } })
    );
    return res.Item?.userId as number | undefined;
}

export async function findByNameEmail(user: User, includePassword = false) {
    const ids = new Set<number>();
    const nameId = await lookupUserId("NAME", user.name);
    const emailId = await lookupUserId("EMAIL", user.email);
    if (nameId) ids.add(nameId);
    if (emailId) ids.add(emailId);
    return Promise.all([...ids].map((id) => findUserById(id, includePassword)));
}

export async function updateUserStats(id: number, field: "wins" | "losses" | "draws") {
    await dynamo.send(
        new UpdateCommand({
            TableName: tableName,
            Key: { pk: `USER#${id}`, sk: "PROFILE" },
            UpdateExpression: `ADD ${field} :inc`,
            ExpressionAttributeValues: { ":inc": 1 }
        })
    );
}

export async function updateUser(id: number, updates: User & { password?: string }) {
    const existing = (await findUserById(id, true)) as StoredUser | null;
    if (!existing) return null;

    const next = { ...existing, ...updates };
    await dynamo.send(new PutCommand({ TableName: tableName, Item: next }));
    return publicUser(next);
}

export async function listUserGames(id: number, limit = 10) {
    const res = await dynamo.send(
        new QueryCommand({
            TableName: tableName,
            IndexName: "gsi1",
            KeyConditionExpression: "gsi1pk = :pk",
            ExpressionAttributeValues: { ":pk": `USER_GAMES#${id}` },
            ScanIndexForward: false,
            Limit: limit
        })
    );
    return (res.Items || []).map((item) => item.game);
}
