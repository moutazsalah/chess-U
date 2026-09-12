import { createApp } from "@chessu/shared";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

import { resolveUserFromCookie } from "./auth.js";
import { initGameTables } from "./db.js";
import { initPublisher } from "./publisher.js";
import { createGame, getActiveGame, listPublicGames } from "./runtime.js";
import { initSocketServer } from "./socket.js";

const app = createApp("game-service");
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: process.env.CORS_ORIGIN || "http://localhost:3000",
        credentials: true
    }
});
const port = Number(process.env.PORT || 4002);

await initGameTables();
await initPublisher();

app.use(
    cors({
        origin: process.env.CORS_ORIGIN || "http://localhost:3000",
        credentials: true
    })
);

app.get("/v1/games", (req, res) => {
    if (req.query.id || req.query.userid) {
        res.status(404).json({ message: "Archived game queries moved to stats-history-service" });
        return;
    }
    res.status(200).json(listPublicGames());
});

app.get("/v1/games/:code", (req, res) => {
    const game = getActiveGame(req.params.code);
    if (!game) {
        res.status(404).end();
        return;
    }
    res.status(200).json(game);
});

app.post("/v1/games", async (req, res) => {
    const user = await resolveUserFromCookie(req.headers.cookie);
    if (!user?.id) {
        res.status(401).end();
        return;
    }

    const game = await createGame(user, String(req.body.side || "random"), Boolean(req.body.unlisted));
    res.status(201).json({ code: game.code });
});

initSocketServer(io);

httpServer.listen(port, () => {
    console.log(`game-service listening on :${port}`);
});
