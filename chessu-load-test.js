import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const THINK_TIME = Number(__ENV.THINK_TIME || 1);
const LOAD_LEVEL = __ENV.LOAD_LEVEL || "moderate";
const LIST_GAMES_RATE = Number(__ENV.LIST_GAMES_RATE || 0.1);

const loadProfiles = {
  serverless: {
    executor: "ramping-vus",
    stages: [
      { duration: "30s", target: 8 },
      { duration: "1m", target: 8 },
      { duration: "30s", target: 0 },
    ],
  },
  moderate: {
    executor: "ramping-vus",
    stages: [
      { duration: "30s", target: 50 },
      { duration: "1m", target: 50 },
      { duration: "30s", target: 0 },
    ],
  },
  high: {
    executor: "ramping-vus",
    stages: [
      { duration: "30s", target: 200 },
      { duration: "1m", target: 200 },
      { duration: "30s", target: 0 },
    ],
  },
  extreme: {
    executor: "ramping-vus",
    stages: [
      { duration: "30s", target: 500 },
      { duration: "1m", target: 500 },
      { duration: "30s", target: 0 },
    ],
  },
};

export const options = {
  scenarios: {
    rest_api_flow: loadProfiles[LOAD_LEVEL] || loadProfiles.moderate,
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<3000"],
    checks: ["rate>0.98"],
    guest_session_failed: ["rate<0.02"],
    create_game_failed: ["rate<0.02"],
  },
};

const guestSessionDuration = new Trend("guest_session_duration");
const createGameDuration = new Trend("create_game_duration");
const listGamesDuration = new Trend("list_games_duration");
const guestSessionFailed = new Rate("guest_session_failed");
const createGameFailed = new Rate("create_game_failed");
const status4xx = new Counter("status_4xx");
const status5xx = new Counter("status_5xx");
const unexpectedStatus = new Counter("unexpected_status");

function jsonHeaders() {
  return {
    headers: {
      "content-type": "application/json",
    },
  };
}

function uniqueName(prefix) {
  return `${prefix}${__VU}${__ITER}${Math.floor(Math.random() * 100000)}`;
}

function jsonValue(res, path) {
  try {
    if (path === undefined) return res.json();
    return res.json(path);
  } catch {
    return undefined;
  }
}

function trackStatus(res, label) {
  if (res.status >= 400 && res.status < 500) status4xx.add(1);
  if (res.status >= 500) status5xx.add(1);

  if (res.status >= 400) {
    unexpectedStatus.add(1);
    if (__ENV.DEBUG_FAILURES === "true") {
      console.log(`${label} failed: status=${res.status} body=${String(res.body).slice(0, 300)}`);
    }
  }
}

export default function () {
  let gameCode;
  let hasSession = false;
  const guestName = uniqueName("Guest");

  group("guest session", () => {
    const res = http.post(
      `${BASE_URL}/v1/auth/guest`,
      JSON.stringify({ name: guestName }),
      jsonHeaders()
    );

    guestSessionDuration.add(res.timings.duration);
    trackStatus(res, "guest session");

    const ok = check(res, {
      "guest returns 201": (r) => r.status === 201,
      "guest has user id": (r) => Boolean(jsonValue(r, "id")),
      "guest has matching name": (r) => jsonValue(r, "name") === guestName,
    });

    guestSessionFailed.add(!ok);
    hasSession = ok;
  });

  if (hasSession) {
    group("current session", () => {
      const res = http.get(`${BASE_URL}/v1/auth`);
      trackStatus(res, "current session");

      check(res, {
        "session returns 200": (r) => r.status === 200,
        "session user matches guest": (r) => jsonValue(r, "name") === guestName,
      });
    });

    group("create game", () => {
      const res = http.post(
        `${BASE_URL}/v1/games`,
        JSON.stringify({ side: "white", unlisted: true }),
        jsonHeaders()
      );

      createGameDuration.add(res.timings.duration);
      trackStatus(res, "create game");

      const ok = check(res, {
        "create game returns 201": (r) => r.status === 201,
        "create game returns code": (r) => Boolean(jsonValue(r, "code")),
      });

      createGameFailed.add(!ok);
      if (ok) gameCode = jsonValue(res, "code");
    });
  }

  if (Math.random() < LIST_GAMES_RATE) {
    group("list public games", () => {
      const res = http.get(`${BASE_URL}/v1/games`);

      listGamesDuration.add(res.timings.duration);
      trackStatus(res, "list public games");

      check(res, {
        "list games returns 200": (r) => r.status === 200,
        "list games returns array": (r) => Array.isArray(jsonValue(r)),
      });
    });
  }

  if (gameCode) {
    group("get game by code", () => {
      const res = http.get(`${BASE_URL}/v1/games/${gameCode}`);
      trackStatus(res, "get game by code");

      check(res, {
        "get game returns 200": (r) => r.status === 200,
        "get game code matches": (r) => jsonValue(r, "code") === gameCode,
      });
    });
  }

  sleep(THINK_TIME);
}
