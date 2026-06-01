import type { User } from "@chessu/types";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";

const cookieName = "chessu";
const secret = process.env.SESSION_SECRET || "make sure to change this!";
const maxAge = 30 * 24 * 60 * 60;

export type ServerlessSession = {
    id: string;
    user?: User;
};

function sign(payload: string) {
    return createHmac("sha256", secret).update(payload).digest("base64url");
}

function encode(session: ServerlessSession) {
    const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
    return `${payload}.${sign(payload)}`;
}

function decode(value?: string): ServerlessSession {
    if (!value) return { id: randomUUID() };
    const [payload, signature] = value.split(".");
    if (!payload || !signature) return { id: randomUUID() };

    const expected = sign(payload);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) return { id: randomUUID() };

    try {
        return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ServerlessSession;
    } catch {
        return { id: randomUUID() };
    }
}

export function readSession(cookies?: string[]) {
    const cookie = cookies
        ?.flatMap((c) => c.split(";"))
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${cookieName}=`));
    return decode(cookie?.slice(cookieName.length + 1));
}

export function sessionCookie(session: ServerlessSession) {
    const sameSite = process.env.NODE_ENV === "production" ? "None" : "Lax";
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `${cookieName}=${encode(session)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=${sameSite}${secure}`;
}

export function clearSessionCookie() {
    return `${cookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;
}
