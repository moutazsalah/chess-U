# ChessU Load Balancer Performance Report

Test date: 2026-06-01  
Region: us-east-1  
Load balancer: `chessu-alb-1491087100.us-east-1.elb.amazonaws.com`  
Backend target group: `chessu-backend-tg`, port `3001`

## Objective

The objective of this test was to evaluate the ChessU backend API under load when accessed through an AWS Application Load Balancer. The test compares moderate and high load levels, checks whether the backend target group is correctly configured, and uses CloudWatch metrics to explain the observed behavior.

## Test Setup

The load tests were executed with k6 against the ALB backend route:

```bash
k6 run \
  -e LOAD_LEVEL=moderate \
  -e THINK_TIME=5 \
  -e BASE_URL=http://chessu-alb-1491087100.us-east-1.elb.amazonaws.com \
  chessu-load-test.js
```

```bash
k6 run \
  -e LOAD_LEVEL=high \
  -e THINK_TIME=5 \
  -e BASE_URL=http://chessu-alb-1491087100.us-east-1.elb.amazonaws.com \
  chessu-load-test.js
```

The test simulates the main REST API flow:

- Create a guest session with `/v1/auth/guest`
- Verify the current session with `/v1/auth`
- Create a game with `/v1/games`
- Fetch the created game by code
- Occasionally list public games with `/v1/games`

## k6 Results

| Test level | Max VUs | Completed iterations | HTTP requests | Checks passed | HTTP failure rate | p95 HTTP duration | Guest failure rate | Create game failure rate | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Moderate | 50 | 773 | 3,174 | 100.00% | 0.00% | 531 ms | 0.00% | 0.00% | Passed |
| High | 200 | 2,636 | 10,821 | 99.92% | 0.08% | 1.81 s | 0.00% | 0.00% | Passed |
| Extreme, previous ALB run | 500 | 3,135 | 12,904 | 98.22% | 1.88% | 6.73 s | 0.93% | 2.51% | Failed latency/create threshold |
| Extreme, previous direct EC2 run | 500 | 2,751 | 9,231 | 87.36% | 10.47% | 4.64 s | 26.76% | 2.42% | Failed |

## Serverless Test Result

The serverless deployment was tested separately through API Gateway:

```bash
k6 run \
  -e LOAD_LEVEL=serverless \
  -e THINK_TIME=5 \
  -e LIST_GAMES_RATE=0.02 \
  -e BASE_URL=https://2f17u2bpn2.execute-api.us-east-1.amazonaws.com \
  chessu-load-test.js
```

The `serverless` profile was added to keep the test below the current Lambda concurrency quota of 10:

| Test level | Max VUs | Completed iterations | HTTP requests | Checks passed | HTTP failure rate | p95 HTTP duration | Guest failure rate | Create game failure rate | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Serverless safe profile | 8 | 125 | 504 | 100.00% | 0.00% | 561 ms | 0.00% | 0.00% | Passed |
| Serverless moderate, previous run | 50 | 732 | 3,373 | 87.61% | 12.68% | 4.41 s | 9.54% | 12.06% | Failed |

This shows that the serverless code path works correctly at a concurrency level below the AWS account limit. The earlier 50 VU serverless test failed because the account-level Lambda concurrency quota was only 10, causing API Gateway to return `503 Service Unavailable` when the test exceeded available Lambda concurrency.

## Endpoint-Level Observations

| Metric | Moderate | High |
|---|---:|---:|
| Guest session avg duration | 213 ms | 347 ms |
| Guest session p95 duration | 510 ms | 1.01 s |
| Create game avg duration | 220 ms | 404 ms |
| Create game p95 duration | 346 ms | 1.52 s |
| List games avg duration | 1.81 s | 6.16 s |
| List games p95 duration | 2.87 s | 30.07 s |

The slowest endpoint is clearly `GET /v1/games`. The response body is currently very large because the database contains many public test games. This endpoint is the main reason latency rises under high and extreme load.

## CloudWatch and AWS Infrastructure Findings

### Target Health

The backend target group currently has only one healthy target:

| Target group | Healthy targets | Target |
|---|---:|---|
| `chessu-backend-tg` | 1 | `i-0de7dc50416b6df03:3001` |

This means the backend API test is not truly balanced across multiple backend instances yet.

### Auto Scaling Group

The Auto Scaling group `chessu-template` has:

| Setting | Value |
|---|---:|
| Minimum capacity | 1 |
| Desired capacity | 1 |
| Maximum capacity | 3 |
| Instance type | `t3.small` |
| Current ASG instance | `i-02e169d682cb646b4` |

Important issue: the ASG is attached to the frontend target group `chessu-target-group`, not the backend target group `chessu-backend-tg`. Therefore, scaling the ASG does not automatically add more backend API targets to port `3001`.

### ALB Metrics

CloudWatch showed healthy ALB behavior during the test window:

| Metric | Observation |
|---|---|
| Healthy backend hosts | Constant at 1 |
| Target 5xx count | No datapoints |
| ALB 5xx count | No datapoints |
| Target connection errors | No datapoints |
| Target 4xx count | No datapoints |

This means the backend generally returned successful HTTP responses. The remaining k6 failures were mostly client-visible EOF, connection reset, or timeout errors under heavier load, not application-generated 500 responses.

### EC2 CPU and RAM

Measured CloudWatch window: 2026-06-01 22:10-22:40 Europe/Rome.

| Instance | Role observed | CPU average range | CPU max | RAM max |
|---|---|---:|---:|---:|
| `i-0de7dc50416b6df03` | Backend target on port 3001 | 3.54%-8.53% | 18.56% | 38.23% |
| `i-02e169d682cb646b4` | ASG/frontend target | 0.94%-1.09% | 1.49% | Not available for this host |

CPU and RAM were not saturated. The bottleneck is more likely connection handling, single backend target capacity, Node.js process behavior, session handling, or the large `GET /v1/games` response rather than raw CPU or memory exhaustion.

## Analysis

The load balancer setup works correctly for moderate and high API load. At 50 VUs, all k6 thresholds passed with no HTTP failures and p95 latency around 531 ms. At 200 VUs, the API still passed all thresholds with a very low HTTP failure rate of 0.08% and p95 latency of 1.81 seconds.

The 500 VU test failed because the backend configuration is still effectively single-instance for API traffic. Although an Auto Scaling group exists, it is attached to the frontend target group, while the backend target group has only one healthy target. This explains why the ALB improves reliability compared with direct EC2 testing, but does not fully solve the extreme load case.

The serverless deployment also has a clear explanation: it passes at 8 VUs, but failed at 50 VUs because of the current AWS Lambda concurrency quota. Therefore, the serverless moderate failure should be reported as an account quota limitation, not as proof that the application logic is broken.

The biggest application-level bottleneck is `GET /v1/games`. Under high load its p95 reached about 30 seconds, while guest creation and game creation stayed much faster. This endpoint returns a large public games list, so repeated load-test game creation makes the endpoint slower over time.

## Recommendations

1. Attach the Auto Scaling group to the backend target group `chessu-backend-tg`, or create a separate backend ASG for port `3001`.
2. Set backend ASG desired capacity to at least 2 for load balancing tests.
3. Add a lightweight health endpoint such as `/health` and use it for the backend target group health check instead of `/v1/games`.
4. Paginate or limit `GET /v1/games`, for example default `limit=20` or `limit=50`.
5. Clean old public test games before benchmarking, or make k6 create unlisted games only.
6. If using multiple backend instances, verify session storage. Express in-memory sessions should be replaced with a shared store, or ALB stickiness should be enabled for session-based routes.
7. For a stable 500 VU result, use multiple backend instances or a larger instance size, then rerun the same k6 test.
8. For a fair serverless benchmark, rerun the moderate and high tests after AWS approves the Lambda concurrency quota increase.

## Conclusion

The ALB deployment passes the required moderate and high load tests. The high test with 200 virtual users achieved 99.92% successful checks, only 0.08% HTTP failures, and p95 latency of 1.81 seconds.

The deployment does not yet pass the 500 VU extreme test because the backend target group has only one healthy API target and the list-games endpoint becomes very slow as test data grows. The next improvement should be to connect the backend Auto Scaling group to the backend target group, run at least two backend targets, and optimize `GET /v1/games`.
