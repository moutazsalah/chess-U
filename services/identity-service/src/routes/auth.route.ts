import { Router } from "express";

import {
    getCurrentSession,
    guestSession,
    loginUser,
    logoutSession,
    registerUser,
    resolveSession,
    updateUser
} from "../controllers/auth.controller.js";

const router = Router();

router.get("/", getCurrentSession);
router.post("/guest", guestSession);
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/logout", logoutSession);
router.patch("/", updateUser);
router.get("/internal/session", resolveSession);

export default router;
