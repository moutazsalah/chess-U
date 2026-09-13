import { createApp } from "@chessu/shared";
import { createServer } from "http";
import { Server } from "socket.io";

import { resolveUserFromCookie } from "./auth.js";
import { initGameTables, listFinishedGameStates } from "./db.js";
import { initPublisher } from "./publisher.js";
import { createGame, getActiveGame, listPublicGames, recoverActiveGames } from "./runtime.js";
import { initSocketServer } from "./socket.js";

const app = createApp("game-service");
const httpServer = createServer(app);
// CORS is handled by the API gateway, browsers never call this service directly
const io = new Server(httpServer);
const port = Number(process.env.PORT || 4002);

await initGameTables();
await initPublisher();
// games that were in progress when the service stopped get their actors back
console.log(`recovered ${await recoverActiveGames()} active games`);

// internal (service-to-service): lets a freshly deployed consumer initialize its game history
app.get("/v1/internal/games/finished", async (_, res) => {
    res.status(200).json(await listFinishedGameStates());
});

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
    const user = resolveUserFromCookie(req.headers.cookie);
    if (!user?.id) {
        res.status(401).end();
        return;
    }

    try {
        const game = await createGame(
            user,
            String(req.body.side || "random"),
            Boolean(req.body.unlisted)
        );
        res.status(201).json({ code: game.code });
    } catch (error) {
        console.error("create game failed", error);
        res.status(500).json({ message: "Could not create game" });
    }
});

initSocketServer(io);

httpServer.listen(port, () => {
    console.log(`game-service listening on :${port}`);
});
