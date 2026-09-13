// The frontend talks to the backend only through the API gateway, never to the services directly.
// In the browser it uses the public gateway URL. Pages rendered on the Next.js server may need a
// different address for the same gateway (inside Docker, "localhost" is the client container),
// so the server side uses API_URL_INTERNAL when it is set.
const publicApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const serverApiUrl = process.env.API_URL_INTERNAL || publicApiUrl;

export const API_URL = (typeof window === "undefined" ? serverApiUrl : publicApiUrl).replace(
    /\/$/,
    ""
);
export const IDENTITY_API_URL = `${API_URL}/identity`;
export const GAME_API_URL = `${API_URL}/game`;
export const STATS_API_URL = `${API_URL}/stats`;
export const SOCKET_URL = publicApiUrl.replace(/\/$/, "");
export const SOCKET_PATH = "/game/socket.io";
export const REALTIME_ENABLED = process.env.NEXT_PUBLIC_REALTIME_ENABLED !== "false";
