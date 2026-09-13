import type { User } from "@chessu/types";
import { hash, verify } from "argon2";
import type { Request, Response } from "express";
import xss from "xss";

import { publishEvent as emitIdentityEvent } from "../publisher.js";
import { createUser, findByNameOrEmail, updateUserById } from "../repositories/user.repository.js";
import { clearUserToken, issueUserToken } from "../session.js";

const usernamePattern = /^[A-Za-z0-9]+$/;

export const getCurrentSession = async (req: Request, res: Response) => {
    if (req.session.user) {
        res.status(200).json(req.session.user);
        return;
    }
    res.status(204).end();
};

export const guestSession = async (req: Request, res: Response) => {
    if (req.session.user?.id && typeof req.session.user.id === "number") {
        res.status(403).end();
        return;
    }

    const name = xss(req.body.name);
    if (!usernamePattern.test(name)) {
        res.status(400).end();
        return;
    }

    req.session.user = {
        id: req.session.id,
        name
    };

    await emitIdentityEvent("GuestSessionStarted", { sessionId: req.session.id, name });

    issueUserToken(res, req.session.user);
    req.session.save(() => {
        res.status(201).json(req.session.user);
    });
};

export const logoutSession = async (req: Request, res: Response) => {
    clearUserToken(res);
    req.session.destroy(() => {
        res.status(204).end();
    });
};

export const registerUser = async (req: Request, res: Response) => {
    if (req.session.user?.id && typeof req.session.user.id === "number") {
        res.status(403).end();
        return;
    }

    const name = xss(req.body.name);
    const email = xss(req.body.email);
    const password = await hash(req.body.password);

    if (!usernamePattern.test(name)) {
        res.status(400).end();
        return;
    }

    const compareEmail = email || name;
    const duplicateUsers = await findByNameOrEmail({ name, email: compareEmail });

    if (duplicateUsers.length) {
        const duplicateField = duplicateUsers[0].name === name ? "Username" : "Email";
        res.status(409).json({ message: `${duplicateField} is already in use.` });
        return;
    }

    const newUser = await createUser({ name, email }, password);
    if (!newUser) {
        res.status(500).json({ message: "Failed to create user" });
        return;
    }

    req.session.user = newUser;
    await emitIdentityEvent("UserRegistered", { id: newUser.id, name: newUser.name, email: newUser.email });

    issueUserToken(res, req.session.user);
    req.session.save(() => {
        res.status(201).json(req.session.user);
    });
};

export const loginUser = async (req: Request, res: Response) => {
    if (req.session.user?.id && typeof req.session.user.id === "number") {
        res.status(403).end();
        return;
    }

    const nameOrEmail = xss(req.body.name);
    const password = req.body.password;
    const users = await findByNameOrEmail(
        { name: nameOrEmail, email: nameOrEmail },
        true
    );

    if (!users.length) {
        res.status(404).json({ message: "Invalid username/email." });
        return;
    }

    const validPassword = await verify(users[0].password as string, password);
    if (!validPassword) {
        res.status(401).json({ message: "Invalid password." });
        return;
    }

    req.session.user = {
        id: users[0].id,
        name: users[0].name,
        email: users[0].email,
        wins: users[0].wins,
        losses: users[0].losses,
        draws: users[0].draws
    };

    await emitIdentityEvent("UserLoggedIn", { id: users[0].id, name: users[0].name });

    issueUserToken(res, req.session.user);
    req.session.save(() => {
        res.status(200).json(req.session.user);
    });
};

export const updateUser = async (req: Request, res: Response) => {
    if (!req.session.user?.id || typeof req.session.user.id === "string") {
        res.status(403).end();
        return;
    }

    if (!req.body.name && !req.body.email && !req.body.password) {
        res.status(400).end();
        return;
    }

    const name = xss(req.body.name || req.session.user.name);
    const email = xss(req.body.email || req.session.user.email);
    const compareEmail = email || name;

    if (!usernamePattern.test(name)) {
        res.status(400).end();
        return;
    }

    const duplicateUsers = await findByNameOrEmail({ name, email: compareEmail });
    if (duplicateUsers.length && duplicateUsers[0].id !== req.session.user.id) {
        const duplicateField = duplicateUsers[0].name === name ? "Username" : "Email";
        res.status(409).json({ message: `${duplicateField} is already in use.` });
        return;
    }

    const updatedUser: User & { password?: string } = {
        name,
        email
    };

    if (req.body.password) {
        updatedUser.password = await hash(req.body.password);
    }

    const user = await updateUserById(req.session.user.id as number, updatedUser);
    if (!user) {
        res.status(500).json({ message: "Failed to update user" });
        return;
    }

    req.session.user = user;
    await emitIdentityEvent("UserUpdated", { id: user.id, name: user.name, email: user.email });

    issueUserToken(res, req.session.user);
    req.session.save(() => {
        res.status(200).json(req.session.user);
    });
};
