// The frontend talks to the backend only through the API gateway, never to the services directly.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080").replace(
    /\/$/,
    ""
);
export const IDENTITY_API_URL = `${API_URL}/identity`;
export const GAME_API_URL = `${API_URL}/game`;
export const STATS_API_URL = `${API_URL}/stats`;
export const SOCKET_URL = API_URL;
export const SOCKET_PATH = "/game/socket.io";
export const REALTIME_ENABLED = process.env.NEXT_PUBLIC_REALTIME_ENABLED !== "false";
