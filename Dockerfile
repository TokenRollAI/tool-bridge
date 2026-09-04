# Node self-hosted service and local installer. PostgreSQL and S3 own persistent data.
FROM node:22-bookworm AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tool-bridge/dashboard build
RUN pnpm --filter @tool-bridge/server build
RUN pnpm --filter @tool-bridge/server --prod deploy --legacy /out

FROM node:22-bookworm-slim
# Official PostgreSQL client tools provide backup/migration without running a database here.
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-common ca-certificates \
    && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 \
    && apt-get clean
ENV NODE_ENV=production TB_BOOTSTRAP_DIR=/data/bootstrap
COPY --from=build /out /app
COPY --from=build /repo/packages/dashboard/dist /app/dashboard
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "const p=process.env.PORT||8787;fetch('http://127.0.0.1:'+p+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "/app/dist/main.js"]
