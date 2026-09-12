import type { User } from "@chessu/types";

const identityServiceUrl = process.env.IDENTITY_SERVICE_URL || "http://localhost:4001";

export const resolveUserFromCookie = async (cookieHeader?: string | null) => {
    if (!cookieHeader) {
        return null;
    }

    const response = await fetch(`${identityServiceUrl}/v1/auth/internal/session`, {
        headers: {
            cookie: cookieHeader
        }
    });

    if (response.status !== 200) {
        return null;
    }

    return (await response.json()) as User;
};
