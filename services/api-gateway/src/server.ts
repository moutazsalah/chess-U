import cors from "cors";
import express from "express";
import type { Request } from "express";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { createProxyMiddleware } from "http-proxy-middleware";
import type { Socket } from "net";

/*
 * API gateway: the single public entry point of the system.
 * Clients (frontend, tests) only know this URL; it forwards each call to the internal service
 * that owns the route, so services can move, scale or restart without clients noticing.
 *
 *   /identity/...  -> identity-service
 *   /game/...      -> game-service (HTTP and Socket.IO WebSockets)
 *   /stats/...     -> stats-history-service
 */

const port = Number(process.env.PORT || 8080);
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";

const routes = [
    { prefix: "/identity", target: process.env.IDENTITY_SERVICE_URL || "http://localhost:4001" },
    { prefix: "/game", target: process.env.GAME_SERVICE_URL || "http://localhost:4002", ws: true },
    { prefix: "/stats", target: process.env.STATS_SERVICE_URL || "http://localhost:4003" }
];

const matchesPrefix = (path: string, prefix: string) =>
    path === prefix || path.startsWith(`${prefix}/`);

const app = express();
app.disable("x-powered-by");

// CORS is handled once here, the internal services are never called by browsers directly
app.use(cors({ origin: corsOrigin, credentials: true }));

app.get("/health", (_, res) => {
    res.status(200).json({ service: "api-gateway", ok: true });
});

// "/internal/" endpoints are for service-to-service calls only and are not exposed publicly
app.use((req, res, next) => {
    if (req.path.includes("/internal/")) {
        res.status(404).json({ message: "Not found" });
        return;
    }
    next();
});

const server = createServer(app);

for (const route of routes) {
    const proxy = createProxyMiddleware<Request, ServerResponse>({
        target: route.target,
        pathFilter: (path) => matchesPrefix(path, route.prefix),
        // "/game/v1/games" -> "/v1/games"
        pathRewrite: (path) => path.slice(route.prefix.length) || "/",
        changeOrigin: true,
        xfwd: true,
        ws: route.ws,
        on: {
            // one service being down must not affect the routes of the other services
            error: (error, _req: IncomingMessage, res: ServerResponse | Socket) => {
                console.warn(`${route.prefix} -> ${route.target} unavailable: ${error.message}`);
                if (!("writeHead" in res)) {
                    res.destroy(); // WebSocket upgrade
                    return;
                }
                if (!res.headersSent) {
                    res.writeHead(503, { "Content-Type": "application/json" });
                }
                res.end(
                    JSON.stringify({ message: `${route.prefix.slice(1)} service unavailable` })
                );
            }
        }
    });

    app.use(proxy);
    if (route.ws) {
        server.on("upgrade", (req, socket, head) => {
            if (matchesPrefix(req.url || "", route.prefix)) {
                proxy.upgrade(req, socket as Socket, head);
            }
        });
    }
}

app.use((req, res) => {
    res.status(404).json({ message: `No service for ${req.path}` });
});

server.listen(port, () => {
    console.log(`api-gateway listening on :${port}`);
    for (const route of routes) {
        console.log(`  ${route.prefix}/* -> ${route.target}`);
    }
});
