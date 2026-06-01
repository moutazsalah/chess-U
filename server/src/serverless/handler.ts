import type { User } from "@chessu/types";
import { hash, verify } from "argon2";
import xss from "xss";
import { createGame, getGameByCode, getGameById, listActiveGames } from "./repositories/games.js";
import { createUser, findByNameEmail, listUserGames, updateUser } from "./repositories/users.js";
import { clearSessionCookie, readSession, sessionCookie } from "./lib/session.js";
import { empty, json, method, path, readBody, type LambdaEvent } from "./lib/http.js";

const namePattern = /^[A-Za-z0-9]+$/;

function cleanName(value: unknown) {
    const name = xss(String(value || ""));
    return namePattern.test(name) ? name : null;
}

function sessionUser(user: User) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws
    };
}

export async function handler(event: LambdaEvent) {
    try {
        const requestPath = path(event);
        const requestMethod = method(event);
        const session = readSession(event.cookies);

        if (requestMethod === "OPTIONS") return empty(204);

        if (requestPath === "/v1/auth" && requestMethod === "GET") {
            return session.user ? json(200, session.user) : empty(204);
        }

        if (requestPath === "/v1/auth/guest" && requestMethod === "POST") {
            if (typeof session.user?.id === "number") return empty(403);
            const body = readBody<{ name?: string }>(event);
            const name = cleanName(body.name);
            if (!name) return empty(400);
            session.user = { id: session.id, name };
            return json(201, session.user, [sessionCookie(session)]);
        }

        if (requestPath === "/v1/auth/logout" && requestMethod === "POST") {
            return empty(204, [clearSessionCookie()]);
        }

        if (requestPath === "/v1/auth/register" && requestMethod === "POST") {
            if (typeof session.user?.id === "number") return empty(403);
            const body = readBody<{ name?: string; email?: string; password?: string }>(event);
            const name = cleanName(body.name);
            const email = xss(String(body.email || ""));
            if (!name || !email || !body.password) return empty(400);

            const duplicates = await findByNameEmail({ name, email });
            if (duplicates.length) {
                const dupl = duplicates[0]?.name === name ? "Username" : "Email";
                return json(409, { message: `${dupl} is already in use.` });
            }

            const created = await createUser({ name, email }, await hash(body.password));
            if (!created) return empty(500);
            session.user = sessionUser(created);
            return json(201, session.user, [sessionCookie(session)]);
        }

        if (requestPath === "/v1/auth/login" && requestMethod === "POST") {
            if (typeof session.user?.id === "number") return empty(403);
            const body = readBody<{ name?: string; password?: string }>(event);
            const nameOrEmail = xss(String(body.name || ""));
            const users = await findByNameEmail({ name: nameOrEmail, email: nameOrEmail }, true);
            const user = users[0] as (User & { password?: string }) | null | undefined;
            if (!user) return json(404, { message: "Invalid username/email." });
            if (!body.password || !(await verify(user.password as string, body.password))) {
                return json(401, { message: "Invalid password." });
            }
            session.user = sessionUser(user);
            return json(200, session.user, [sessionCookie(session)]);
        }

        if (requestPath === "/v1/auth" && requestMethod === "PATCH") {
            if (!session.user?.id || typeof session.user.id === "string") return empty(403);
            const body = readBody<{ name?: string; email?: string; password?: string }>(event);
            if (!body.name && !body.email && !body.password) return empty(400);
            const name = cleanName(body.name || session.user.name);
            if (!name) return empty(400);
            const email = xss(String(body.email || session.user.email || ""));
            const duplicates = await findByNameEmail({ name, email: email || name });
            if (duplicates.length && duplicates[0]?.id !== session.user.id) {
                const dupl = duplicates[0]?.name === name ? "Username" : "Email";
                return json(409, { message: `${dupl} is already in use.` });
            }
            const password = body.password ? await hash(body.password) : undefined;
            const updated = await updateUser(session.user.id, { name, email, password });
            if (!updated) return empty(500);
            session.user = sessionUser(updated);
            return json(200, session.user, [sessionCookie(session)]);
        }

        if (requestPath === "/v1/games" && requestMethod === "GET") {
            const id = Number(event.queryStringParameters?.id);
            const userId = Number(event.queryStringParameters?.userid);
            if (id) {
                const game = await getGameById(id);
                return game ? json(200, game) : empty(404);
            }
            if (userId) return json(200, await listUserGames(userId));
            return json(200, await listActiveGames());
        }

        if (requestPath === "/v1/games" && requestMethod === "POST") {
            if (!session.user?.id) return empty(401);
            const body = readBody<{ side?: string; unlisted?: boolean }>(event);
            const user = { id: session.user.id, name: session.user.name, connected: false };
            return json(201, await createGame(user, body.side, body.unlisted ?? false));
        }

        const gameCodeMatch = requestPath.match(/^\/v1\/games\/([^/]+)$/);
        if (gameCodeMatch && requestMethod === "GET") {
            const game = await getGameByCode(gameCodeMatch[1]);
            return game ? json(200, game) : empty(404);
        }

        const userMatch = requestPath.match(/^\/v1\/users\/([^/]+)$/);
        if (userMatch && requestMethod === "GET") {
            const name = xss(decodeURIComponent(userMatch[1]));
            const users = await findByNameEmail({ name, email: name });
            const user = users[0];
            if (!user || typeof user.id !== "number") return empty(404);
            const recentGames = await listUserGames(user.id);
            return json(200, { ...user, recentGames });
        }

        return empty(404);
    } catch (err) {
        console.error(err);
        return empty(500);
    }
}
