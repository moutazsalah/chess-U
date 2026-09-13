import { signUserToken, USER_TOKEN_COOKIE, USER_TOKEN_MAX_AGE_SECONDS } from "@chessu/shared";
import type { User } from "@chessu/types";
import type { Response } from "express";
import PGSimple from "connect-pg-simple";
import type { Session } from "express-session";
import session from "express-session";
import { nanoid } from "nanoid";

import { db } from "./db.js";

declare module "express-session" {
    interface SessionData {
        user?: User;
    }
}

declare module "http" {
    interface IncomingMessage {
        session: Session & {
            user?: User;
        };
    }
}

const PGSession = PGSimple(session);

export const sessionMiddleware = session({
    store: new PGSession({ pool: db, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "make sure to change this!",
    resave: false,
    saveUninitialized: false,
    name: "chessu_identity",
    proxy: true,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        secure: false,
        httpOnly: true,
        sameSite: "lax"
    },
    genid: () => nanoid(21)
});

// signed token that lets other services identify the user without calling identity-service
export const issueUserToken = (res: Response, user: User) => {
    res.cookie(
        USER_TOKEN_COOKIE,
        signUserToken({ id: user.id as number | string, name: user.name as string }),
        {
            httpOnly: true,
            sameSite: "lax",
            secure: false,
            maxAge: USER_TOKEN_MAX_AGE_SECONDS * 1000
        }
    );
};

export const clearUserToken = (res: Response) => {
    res.clearCookie(USER_TOKEN_COOKIE);
};
