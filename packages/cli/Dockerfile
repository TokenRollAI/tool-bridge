# tb-agent:常驻 `tb connect` 的边车(sidecar)镜像 —— 把内网/集群里的一台机器或一个 pod
# 反向挂到 HTBP 树的 device/ 下,部署即被发现。与根 Dockerfile 同源(从 monorepo 构建),
# 保证 agent 的 CLI 版本 == 网关版本,不依赖 npm 发布时序。
#
# 单文件 ESM bin:tsup 已把 @tool-bridge/core 内联,仅 commander/partysocket/ws/marked*
# 5 个运行时依赖留 external,故用 `pnpm deploy --prod` 隔出最小 node_modules 进 slim。
# `tb connect` 自身处理 SIGTERM/SIGINT 优雅收尾(见 deviceRuntime.ts),配 tini 做 PID1
# 转发信号 + 回收 shell 子进程僵尸。
#
# 用法:
#   docker build -f packages/cli/Dockerfile -t tb-agent .
#   docker run --rm -e TB_BASE_URL=https://tool-bridge.example.com -e TB_SK=tbk_... \
#     tb-agent connect --device-id demo --allow echo
#   k8s sidecar 清单见 llmdoc/guides/k8s-device-sidecar.md。

FROM node:22-bookworm AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tool-bridge/cli build
# 隔离 prod 部署:CLI 包(files=["dist"])+ 生产依赖 → /out（--legacy:workspace 依赖按 pack 规则复制）
RUN pnpm --filter @tool-bridge/cli --prod deploy --legacy /out

FROM node:22-bookworm-slim
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /out /app
# 把 bin 暴露到 PATH:dist/index.js 带 shebang 且已可执行
RUN ln -s /app/dist/index.js /usr/local/bin/tb
USER node
# tini 作 PID1:转发 SIGTERM 给 tb（触发 WS 优雅关闭 → 节点即时下线）、回收 shell 子进程
ENTRYPOINT ["/usr/bin/tini", "--", "tb"]
# 裸跑打印帮助;k8s/compose 用 args 覆盖为 `connect --device-id ... --allow ...`
CMD ["--help"]
