import type { Game, User } from "@chessu/types";
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { nanoid } from "nanoid";
import { dynamo, tableName } from "./dynamo.js";
import { updateUserStats } from "./users.js";

type StoredGame = Game & {
    pk: string;
    sk: string;
    entityType: "GAME";
    gsi1pk?: string;
    gsi1sk?: string;
};

const activeGamesIndexKey = "ACTIVE_GAMES";

function publicStoredGame(game: StoredGame): Game {
    const { pk, sk, entityType, gsi1pk, gsi1sk, ...publicGame } = game;
    return publicGame;
}

export async function listActiveGames(limit = 50) {
    const res = await dynamo.send(
        new QueryCommand({
            TableName: tableName,
            IndexName: "gsi1",
            KeyConditionExpression: "gsi1pk = :pk",
            ExpressionAttributeValues: { ":pk": activeGamesIndexKey },
            ScanIndexForward: false,
            Limit: limit
        })
    );
    return (res.Items || []).map((item) => publicStoredGame(item as StoredGame));
}

export async function getGameByCode(code: string) {
    const res = await dynamo.send(
        new GetCommand({ TableName: tableName, Key: { pk: `GAME#${code}`, sk: "STATE" } })
    );
    return res.Item ? publicStoredGame(res.Item as StoredGame) : null;
}

export async function getGameById(id: number) {
    const res = await dynamo.send(
        new QueryCommand({
            TableName: tableName,
            IndexName: "gsi1",
            KeyConditionExpression: "gsi1pk = :pk",
            ExpressionAttributeValues: { ":pk": `GAME_ID#${id}` },
            Limit: 1
        })
    );
    const item = res.Items?.[0] as StoredGame | undefined;
    return item ? publicStoredGame(item) : null;
}

export async function createGame(host: User, side: string | undefined, unlisted = false) {
    const code = nanoid(6);
    const game: StoredGame = {
        pk: `GAME#${code}`,
        sk: "STATE",
        entityType: "GAME",
        code,
        unlisted,
        host,
        pgn: ""
    };

    if (!unlisted) {
        game.gsi1pk = activeGamesIndexKey;
        game.gsi1sk = `${Date.now()}#${code}`;
    }

    if (side === "white") {
        game.white = host;
    } else if (side === "black") {
        game.black = host;
    } else if (Math.floor(Math.random() * 2) === 0) {
        game.white = host;
    } else {
        game.black = host;
    }

    await dynamo.send(
        new PutCommand({
            TableName: tableName,
            Item: game,
            ConditionExpression: "attribute_not_exists(pk)"
        })
    );
    return { code };
}

export async function saveFinishedGame(game: Game) {
    const id = Date.now();
    const finished: StoredGame = {
        pk: `GAME#${game.code || id}`,
        sk: "STATE",
        entityType: "GAME",
        ...game,
        id,
        gsi1pk: `GAME_ID#${id}`,
        gsi1sk: `${id}`
    };

    const gameRefs = [game.white, game.black]
        .filter((user): user is User & { id: number } => typeof user?.id === "number")
        .map((user) => ({
            Put: {
                TableName: tableName,
                Item: {
                    pk: `GAME_REF#${id}#${user.id}`,
                    sk: "REF",
                    gsi1pk: `USER_GAMES#${user.id}`,
                    gsi1sk: `${id}`,
                    game: publicStoredGame(finished)
                }
            }
        }));

    await dynamo.send(
        new TransactWriteCommand({
            TransactItems: [
                {
                    Put: {
                        TableName: tableName,
                        Item: finished
                    }
                },
                ...gameRefs
            ]
        })
    );

    if (game.winner === "draw") {
        if (typeof game.white?.id === "number") await updateUserStats(game.white.id, "draws");
        if (typeof game.black?.id === "number") await updateUserStats(game.black.id, "draws");
    } else if (game.winner) {
        const winner = game.winner === "white" ? game.white : game.black;
        const loser = game.winner === "white" ? game.black : game.white;
        if (typeof winner?.id === "number") await updateUserStats(winner.id, "wins");
        if (typeof loser?.id === "number") await updateUserStats(loser.id, "losses");
    }

    return publicStoredGame(finished);
}
