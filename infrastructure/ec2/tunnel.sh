#!/bin/bash
# Opens an SSH tunnel to the EC2 host so the end-to-end tests (and the RabbitMQ UI) can reach
# the deployed stack exactly like the local one. Databases and RabbitMQ are not public,
# they only listen on the server's 127.0.0.1.
#
# Usage:  infrastructure/ec2/tunnel.sh <ec2-host> [ssh-key]
# Then, in another terminal (stop the local stack first, the ports are the same):
#   DOCKER_HOST=ssh://ec2-user@<ec2-host> pnpm test:e2e
# RabbitMQ management UI: http://localhost:15672 (guest/guest)
set -euo pipefail

HOST="${1:?usage: tunnel.sh <ec2-host> [ssh-key]}"
KEY="${2:-$HOME/.ssh/chessu-key.pem}"

forwards=()
for port in 4001 4002 4003 5433 5434 5435 5672 15672; do
    forwards+=(-L "${port}:127.0.0.1:${port}")
done

echo "Tunnel to ${HOST} open, press Ctrl+C to close"
exec ssh -i "$KEY" -N "${forwards[@]}" "ec2-user@${HOST}"
