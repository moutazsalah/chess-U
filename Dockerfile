FROM node:22-alpine3.20

ENV PNPM_HOME=/usr/local/bin
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /opt/chessu

COPY . .

RUN corepack enable && \
    corepack prepare pnpm@11.2.2 --activate && \
    pnpm config set store-dir /opt/chessu/.pnpm-store && \
    pnpm install --unsafe-perm && \
    pnpm build:server && \
    pnpm build:client && \
    pnpm store prune && \
    rm -rf /opt/chessu/.pnpm-store /root/.cache/pnpm

EXPOSE 3000 3001

ENTRYPOINT ["pnpm"]
CMD ["start"]
