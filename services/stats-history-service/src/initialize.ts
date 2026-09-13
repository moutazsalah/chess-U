import { applyGameFinished, type GameFinishedPayload, upsertPlayer } from "./consumer.js";
import { db, withTransaction } from "./db.js";

/*
 * Initialization of the read models.
 *
 * A newly deployed (or reset) stats-history-service has empty tables and never saw the events
 * published before it existed. So, only when a table is empty, it asks the owning service once
 * for its current data through a direct internal call. After that, it keeps its copy up to date
 * from events only.
 *
 * If an owning service is down, the initialization is skipped for that table: this service
 * still starts and serves queries (the service must not depend on the others being up).
 */

const identityServiceUrl = process.env.IDENTITY_SERVICE_URL || "http://localhost:4001";
const gameServiceUrl = process.env.GAME_SERVICE_URL || "http://localhost:4002";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async <T>(url: string, attempts = 10, delayMs = 2000): Promise<T | null> => {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                return (await response.json()) as T;
            }
            console.warn(`initialization: ${url} answered ${response.status}`);
        } catch {
            console.warn(`initialization: ${url} unreachable (attempt ${attempt}/${attempts})`);
        }
        if (attempt < attempts) {
            await sleep(delayMs);
        }
    }
    return null;
};

const isEmpty = async (table: "player_stats" | "game_history") =>
    (await db.query(`SELECT 1 FROM "${table}" LIMIT 1`)).rowCount === 0;

const initializePlayers = async () => {
    const users = await fetchJson<{ id: number; name: string }[]>(
        `${identityServiceUrl}/v1/internal/users`
    );
    if (!users) {
        console.warn("initialization: identity-service unavailable, players not imported");
        return;
    }
    await withTransaction(async (client) => {
        for (const user of users) {
            await upsertPlayer(client, String(user.id), user.name);
        }
    });
    console.log(`initialization: imported ${users.length} players from identity-service`);
};

const initializeGameHistory = async () => {
    const games = await fetchJson<GameFinishedPayload[]>(
        `${gameServiceUrl}/v1/internal/games/finished`
    );
    if (!games) {
        console.warn("initialization: game-service unavailable, game history not imported");
        return;
    }
    // same projection logic as for GameFinished events, so stats are recomputed from the games
    await withTransaction(async (client) => {
        for (const game of games) {
            await applyGameFinished(client, game);
        }
    });
    console.log(`initialization: imported ${games.length} finished games from game-service`);
};

export const initializeReadModels = async () => {
    const [noPlayers, noGames] = [await isEmpty("player_stats"), await isEmpty("game_history")];
    if (noPlayers) {
        await initializePlayers();
    }
    if (noGames) {
        await initializeGameHistory();
    }
};
