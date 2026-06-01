import type { User } from "@chessu/types";
import PGSimple from "connect-pg-simple";
import type { Session } from "express-session";
import session from "express-session";
import { nanoid } from "nanoid";

import { db } from "../db/index.js";

const PGSession = PGSimple(session);
const secureCookie =
    process.env.COOKIE_SECURE !== undefined
        ? process.env.COOKIE_SECURE === "true"
        : process.env.NODE_ENV === "production";

declare module "express-session" {
    // eslint-disable-next-line no-unused-vars
    interface SessionData {
        user: User;
    }
}
declare module "http" {
    // eslint-disable-next-line no-unused-vars
    interface IncomingMessage {
        session: Session & {
            user: User;
        };
    }
}
const sessionMiddleware = session({
    store: new PGSession({ pool: db, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "make sure to change this!",
    resave: false,
    saveUninitialized: false,
    name: "chessu",
    proxy: true,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        secure: secureCookie,
        httpOnly: true,
        sameSite: secureCookie ? "none" : "lax"
    },
    genid: function () {
        return nanoid(21);
    }
});

export default sessionMiddleware;
