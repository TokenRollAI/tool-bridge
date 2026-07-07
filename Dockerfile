# tool-bridge 自部署镜像(User Case #4):单容器拉起同一棵 HTBP 树,/data 卷持久。
#
# 多阶段:全量 bookworm 构建(better-sqlite3 无 prebuild 时可编译;不用 alpine——
# musl 无官方 prebuild)→ slim 运行时。dashboard dist 作为 server 的 prod 依赖
# 随 pnpm deploy 进入 /out/node_modules,运行时经包解析托管 /ui。
#
# 用法:
#   docker build -t tool-bridge .
#   docker run -d -p 8787:8787 -v tbdata:/data \
#     -e TB_SECRET_ENCRYPTION_KEY=<base64url 32B> tool-bridge
#   （首次启动日志打印 Admin SK 明文一次;或以 TB_BOOTSTRAP_ADMIN_SK 指定。）

FROM node:22-bookworm AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tool-bridge/dashboard build
RUN pnpm --filter @tool-bridge/server build
# 隔离 prod 部署:server 包 + 生产依赖(含 dashboard dist)→ /out
# (--legacy:不启用 inject-workspace-packages,workspace 依赖按 pack 规则复制)
RUN pnpm --filter @tool-bridge/server --prod deploy --legacy /out

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    TB_DATA_DIR=/data \
    TB_PORT=8787 \
    TB_HOST=0.0.0.0
COPY --from=build /out /app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "/app/dist/main.js"]
