export const IDENTITY_API_URL =
    process.env.NEXT_PUBLIC_IDENTITY_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4001";
export const GAME_API_URL =
    process.env.NEXT_PUBLIC_GAME_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4002";
export const STATS_API_URL =
    process.env.NEXT_PUBLIC_STATS_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4003";
export const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || GAME_API_URL;
export const REALTIME_ENABLED = process.env.NEXT_PUBLIC_REALTIME_ENABLED !== "false";
