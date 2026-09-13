import { readCookie, USER_TOKEN_COOKIE, verifyUserToken } from "@chessu/shared";
import type { User } from "@chessu/types";

// The user is identified from the token signed by identity-service. No call to identity-service
// is needed, so games keep working while identity-service is down.
export const resolveUserFromCookie = (cookieHeader?: string | null): User | null => {
    const token = readCookie(cookieHeader, USER_TOKEN_COOKIE);
    return token ? verifyUserToken(token) : null;
};
