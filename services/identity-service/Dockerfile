FROM node:22-alpine3.20

ENV PNPM_HOME=/usr/local/bin
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /opt/chessu

COPY . .

RUN corepack enable && \
    corepack prepare pnpm@11.9.0 --activate && \
    pnpm config set store-dir /opt/chessu/.pnpm-store && \
    pnpm install --unsafe-perm --trust-lockfile && \
    pnpm --filter @chessu/shared build && \
    pnpm --filter @chessu/identity-service build && \
    pnpm store prune && \
    rm -rf /opt/chessu/.pnpm-store /root/.cache/pnpm

EXPOSE 4001

ENTRYPOINT ["pnpm"]
CMD ["--filter", "@chessu/identity-service", "start"]
