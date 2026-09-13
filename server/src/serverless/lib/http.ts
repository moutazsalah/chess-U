export interface LambdaEvent {
    rawPath?: string;
    path?: string;
    routeKey?: string;
    requestContext?: {
        http?: {
            method?: string;
            path?: string;
        };
    };
    queryStringParameters?: Record<string, string | undefined> | null;
    pathParameters?: Record<string, string | undefined> | null;
    headers?: Record<string, string | undefined>;
    cookies?: string[];
    body?: string | null;
    isBase64Encoded?: boolean;
}

export interface LambdaResponse {
    statusCode: number;
    headers?: Record<string, string>;
    cookies?: string[];
    body?: string;
}

const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";

export function json(statusCode: number, body?: unknown, cookies?: string[]): LambdaResponse {
    return {
        statusCode,
        headers: {
            "content-type": "application/json",
            "access-control-allow-origin": corsOrigin,
            "access-control-allow-credentials": "true"
        },
        cookies,
        body: body === undefined ? "" : JSON.stringify(body)
    };
}

export function empty(statusCode: number, cookies?: string[]): LambdaResponse {
    return {
        statusCode,
        headers: {
            "access-control-allow-origin": corsOrigin,
            "access-control-allow-credentials": "true"
        },
        cookies,
        body: ""
    };
}

export function readBody<T extends Record<string, unknown>>(event: LambdaEvent): T {
    if (!event.body) return {} as T;
    const raw = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body;
    return JSON.parse(raw) as T;
}

export function method(event: LambdaEvent) {
    return event.requestContext?.http?.method || event.routeKey?.split(" ")[0] || "GET";
}

export function path(event: LambdaEvent) {
    return event.rawPath || event.requestContext?.http?.path || event.path || "/";
}
