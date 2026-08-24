# Cloudflare 初始化、部署与验收

Cloudflare 是一种宿主，不是业务真源。仓库中的 `packages/gateway/wrangler.jsonc` 必须保持账户中立：不提交 account ID、域名、D1/R2 ID 或环境凭据。

## 推荐入口

从源码 checkout 运行：

```bash
tb init cloudflare --repo .
```

向导负责生成 Admin SK、配置 secrets、创建资源、部署并做基础验证。非交互环境可显式传入 `--account-id`、`--domain` 与 `--yes`；完整选项以 `tb init cloudflare --help` 为准。

手工流程只用于调试：

```bash
pnpm provision
pnpm verify
pnpm turbo run build
pnpm --filter @tool-bridge/dashboard build
pnpm --filter @tool-bridge/gateway run deploy
```

`provision` 从环境读取账户与命名前缀，幂等创建 R2 与一个 D1 库(TB_STATE/TB_SEARCH 两个 binding 指向它)，并把本地 checkout 的部署目标写入 wrangler 配置。该写回含环境标识，不应作为通用模板提交。

## D1 延迟配置

gateway 已按请求使用 D1 Sessions API，但**代码接入与数据库启用读复制是两步**：

1. 在 Cloudflare Dashboard 打开 `D1 → <数据库> → Settings → Read Replication`。Wrangler 当前没有对应的启用命令，`provision` 会提醒但不会伪装成已经开启。
2. State session 用 `first-primary`：每个 HTTP 请求的首个权威查询必须看到最新 SK/权限/节点状态，保留吊销即时生效；同请求后续查询可由满足 bookmark 的副本服务。
3. Search session 也用 `first-primary`：首次惰性建表后若立即从尚未同步 schema 的副本读取会报错；首查询钉 primary 后，同 session 的后续候选查询仍可由满足 bookmark 的副本服务并保持 read-my-own-writes。

`wrangler.jsonc` 默认启用 Smart Placement。所有鉴权请求至少访问一次 State primary，把 Worker 放近主要后端可减少单请求内连续 D1/上游往返的跨区成本。当前 Dashboard 仍是 `assets.run_worker_first=true`，所以 `/ui` 静态资源也会先到 Smart-Placed Worker；这是核心 API 延迟优先的明确取舍。若要同时追求全球静态资源最低 TTFB，应把 UI 拆到 edge-first Assets/Pages Worker，再用同源或明确 CORS 接 API，不能只改 `run_worker_first` 让 SPA 吞掉 API 路由。

性能诊断不靠体感：

- 响应 `Server-Timing` 含 `tb-worker`，有 D1 查询时另含 `tb-d1`（D1 等待时间总和）。
- 总处理时间达到 500ms 时，Workers Logs 写一条 `event=tool_bridge_slow_request` 的结构化 warning，包含 D1 调用数、wall/SQL 时间、`served_by_region`、primary/replica 次数、入站 colo；不记录 SQL、key、参数、SK 或返回值。
- D1 SQL time 很低但 wall time 很高，优先查 primary/replica 区域和网络往返；两者都低但 `tb-worker` 很高，继续查外部 provider、R2/DO 或应用 CPU。
- 兼容日期必须与仓库锁定的 workerd 可验证上限一致；升级 Wrangler/Miniflare/workerd 后再同步推进，不能把“最新日期”写成测试无法启动的配置。

## gateway 双入口与三条发布路径

`@tool-bridge/gateway` 有两个入口：包根是零插件库入口；`./full` 是全量装配入口（内置插件目录 + D1 search）。到 Cloudflare 的发布路径有三条，必须保持同形态：

1. 源码 wrangler 部署：main 为 `packages/gateway/src/deployEntry.ts`。
2. npm 消费：`@tool-bridge/gateway/full`。
3. Deploy Button template：导入 `/full`。

一致性要求：

- 改 gateway 装配（插件目录、search 后端、入口 wiring）时，三处同轮核对，不允许某一条路径掉队。
- template 的依赖版本要与当轮发布的 gateway/dashboard minor 对齐：0.x 下 caret 不跨 minor，template 停在旧 minor 就装不到新装配。
- gateway minor 若改变 search 后端或搜索能力，除同步 template 的 0.x 依赖 pin，还要同轮核对 `template/wrangler.jsonc` 等面向部署者的 search binding 文案；旧实现描述会让模板即使装到新包仍暴露错误运维模型。

会复发的构建坑：给 Workers 目标 bundle 含 `@modelcontextprotocol/sdk` 的入口时，tsup 的 `platform: 'neutral'` 必须设 esbuild `conditions: ['workerd', 'worker', 'browser']`；否则 `pkce-challenge`（exports 只有 browser/node 分支）解析失败。

## 必需安全配置

- 首次引导必须预置 `TB_BOOTSTRAP_ADMIN_SK`，并保存在密码管理器；不得从日志回收最高权限凭据。
- SecretStore 的加密密钥必须通过 Wrangler secret 注入，不进入 `vars` 或仓库文件。
- 上游默认只允许 HTTPS；`TB_ALLOW_INSECURE_HTTP=true` 仅供本地验证。
- 自定义域名、canonical origin 与 OAuth redirect 必须一致；未配置域名时使用 workers.dev/preview 入口。

## 验收层次

1. 本地：`pnpm verify`，以及发布/打包相关改动的全仓 build。
2. 部署产物：确认 Worker 与 Dashboard 实际加载的是本轮构建，而非旧 `dist`。
3. 基础 smoke：健康检查、Admin SK 鉴权、受限 SK 的 allow/deny/404 语义。
4. 按需真实验证：MCP、search、device、plugin 等脚本必须显式提供 URL 与 SK。

真实云资源和上游会产生费用或副作用；每轮最多执行一次，需获得用户授权并把证据留在 PR/CI，而不是写入 `current-state.md`。

项目当前没有正式生产环境。共享开发部署可重置，不承担旧预览状态兼容责任。
