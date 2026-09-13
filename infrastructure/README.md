# Chessu serverless backend

Legacy note: this serverless path belongs to the older backend architecture.
The current primary deployment story for the microservices project is:

- GitHub Actions CI for build and validation
- GitHub Actions CD for EC2 deployment
- Dockerized `identity-service`, `game-service`, `stats-history-service`, and `client`

This adds an AWS serverless backend path:

API Gateway HTTP API -> Lambda -> DynamoDB

Deploy with AWS SAM from the repository root:

```sh
sam build -t infrastructure/template.yaml
sam deploy --guided
```

After deploy, set the client environment variable to the `ApiUrl` output:

```sh
NEXT_PUBLIC_API_URL=https://your-api-id.execute-api.your-region.amazonaws.com
```

The current Socket.IO realtime chess flow is still served by the existing Express server. API Gateway REST/HTTP APIs do not run Socket.IO rooms. To make live games fully serverless, migrate `server/src/socket/game.socket.ts` to API Gateway WebSocket routes and store connection IDs/game state in DynamoDB, or use a managed realtime service.
