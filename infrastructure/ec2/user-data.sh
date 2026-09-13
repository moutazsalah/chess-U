#!/bin/bash
# EC2 bootstrap (Amazon Linux 2023). Runs once as root on the instance's first boot.
# Installs Docker + the Compose plugin and adds swap so a t3.small (2 GB RAM) can run
# 3 Node services, 3 PostgreSQL databases and RabbitMQ.
set -euxo pipefail

dnf install -y docker
systemctl enable --now docker
usermod -aG docker ec2-user

COMPOSE_VERSION=v2.29.7
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo "/swapfile swap swap defaults 0 0" >> /etc/fstab

mkdir -p /home/ec2-user/chess-u
chown ec2-user:ec2-user /home/ec2-user/chess-u
