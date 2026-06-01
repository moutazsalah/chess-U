// back-end server url
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
export const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || API_URL;
export const REALTIME_ENABLED = process.env.NEXT_PUBLIC_REALTIME_ENABLED !== "false";
