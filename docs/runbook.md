# Chess-U Runbook

## Build checks

From the project root:

```sh
pnpm build:microservices
pnpm build:client
```

## Infrastructure

Start RabbitMQ and the databases:

```sh
docker compose up -d rabbitmq identity-db game-db stats-db
```

## Local service startup

`identity-service` and `game-service` must use the same `TOKEN_SECRET`: identity-service signs
the user tokens, game-service verifies them.

Start `identity-service`:

```sh
PORT=4001 \
DATABASE_URL=postgres://user:password@127.0.0.1:5433/chessu_identity \
SESSION_SECRET=change-me \
TOKEN_SECRET=dev-token-secret \
AMQP_URL=amqp://guest:guest@127.0.0.1:5672 \
pnpm --filter @chessu/identity-service start
```

Start `game-service`:

```sh
PORT=4002 \
DATABASE_URL=postgres://user:password@127.0.0.1:5434/chessu_game \
TOKEN_SECRET=dev-token-secret \
AMQP_URL=amqp://guest:guest@127.0.0.1:5672 \
pnpm --filter @chessu/game-service start
```

Start `stats-history-service` (the two service URLs are only used to initialize empty tables):

```sh
PORT=4003 \
DATABASE_URL=postgres://user:password@127.0.0.1:5435/chessu_stats \
AMQP_URL=amqp://guest:guest@127.0.0.1:5672 \
IDENTITY_SERVICE_URL=http://127.0.0.1:4001 \
GAME_SERVICE_URL=http://127.0.0.1:4002 \
pnpm --filter @chessu/stats-history-service start
```

Start the `api-gateway`:

```sh
PORT=8080 \
CORS_ORIGIN=http://localhost:3000 \
IDENTITY_SERVICE_URL=http://127.0.0.1:4001 \
GAME_SERVICE_URL=http://127.0.0.1:4002 \
STATS_SERVICE_URL=http://127.0.0.1:4003 \
pnpm --filter @chessu/api-gateway start
```

Start the client (it only talks to the gateway):

```sh
NEXT_PUBLIC_API_URL=http://localhost:8080 \
pnpm --filter client dev
```

## Tests

Unit tests for the game actor and its supervisor:

```sh
pnpm test:unit
```

End-to-end tests (need the Docker Compose stack, because some tests stop, restart or wipe
services with `docker compose`):

```sh
docker compose up -d --build --wait api-gateway identity-service game-service stats-history-service
pnpm test:e2e
```

Expected result: all tests pass. They cover user-data replication, the CQRS write/read flow,
events buffered in RabbitMQ while a consumer is down, duplicate delivery, dead-lettering, the API
gateway, read-model initialization, playing while identity-service is down, and recovering games
after a game-service restart.

RabbitMQ management UI (queues, message counts, dead-letter queue): http://localhost:15672 (guest/guest)

## Useful commands

```sh
docker compose logs -f game-service                 # follow one service's logs
docker compose stop identity-service                # simulate an outage
docker compose restart game-service                 # active games are recovered on startup
docker compose exec stats-db psql -U user chessu_stats -c 'select * from player_stats'
```
