# Node、Docker 与 Compose

`@tool-bridge/app` 承担宿主中立业务；`@tool-bridge/server` 为 Node 装配 SQLite、文件对象存储、WebSocket 与 HTTP 监听。它不是 Cloudflare gateway 的兼容壳。

## Node 配置边界

- `TB_DATA_DIR` 持有 SQLite 和对象数据，应挂载持久卷并限制文件权限。
- 首次引导必须设置 `TB_BOOTSTRAP_ADMIN_SK`；缺失时启动默认 fail closed。
- `TB_ALLOW_INSECURE_BOOTSTRAP=true` 只用于一次性本地开发，会生成并输出随机 Admin SK，不能用于共享环境。
- `TB_ALLOW_INSECURE_HTTP=true` 只放行本地 HTTP 上游，不应进入公网部署。
- 反向代理必须保留 WebSocket upgrade、Authorization 和原始 host/proto 语义。

SDK 内嵌与 Node server 使用同一引导下界：首次启动没有显式 Admin SK 就拒绝继续。设备通道由宿主装配的 `DeviceChannel` 提供，不存在可配置但未实现的公共 `DeviceTransport`。

## Compose 开发栈

```bash
pnpm compose:up
pnpm compose:smoke
pnpm compose:down
```

需要清空本地卷时才执行 `pnpm compose:reset`；这会删除 Compose 数据，运行前先确认目标只是本地开发状态。

Compose 默认值仅用于本机闭环，不是部署模板。交付前至少验证：冷启动、持久卷重启、Dashboard 静态资源、HTTP 工具调用、设备 WebSocket，以及缺 Admin SK 时拒绝启动。

Cloudflare 专属的 KV/R2/D1、Durable Object 与 Wrangler 配置不得下沉进 server；Node 的 SQLite/文件语义也不得反向泄漏进 app。
