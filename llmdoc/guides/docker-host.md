# Node、Docker 与 Compose

`@tool-bridge/app` 承担宿主中立业务；`@tool-bridge/server` 为 Node 装配状态存储（SQLite 或 PostgreSQL）、文件对象存储、WebSocket 与 HTTP 监听。它不是 Cloudflare gateway 的兼容壳。

## Node 配置边界

- `TB_DATA_DIR` 持有 SQLite（未用 PG 时）和对象数据，应挂载持久卷并限制文件权限。对象存储始终是本地 FS，即使状态在 PG——多实例部署下 `$ref` 大对象不共享。
- 首次引导必须设置 `TB_BOOTSTRAP_ADMIN_SK`；缺失时启动默认 fail closed。
- `TB_ALLOW_INSECURE_BOOTSTRAP=true` 只用于一次性本地开发，会生成并输出随机 Admin SK，不能用于共享环境。
- `TB_ALLOW_INSECURE_HTTP=true` 只放行本地 HTTP 上游，不应进入公网部署。
- 反向代理必须保留 WebSocket upgrade、Authorization 和原始 host/proto 语义。

SDK 内嵌与 Node server 使用同一引导下界：首次启动没有显式 Admin SK 就拒绝继续。设备通道由宿主装配的 `DeviceChannel` 提供，不存在可配置但未实现的公共 `DeviceTransport`。

## PostgreSQL 后端

设 `TB_DATABASE_URL` 则 StateStore 与 SearchIndex 都走 PG（共用一个连接池），缺省回退 `TB_DATA_DIR` 下的 SQLite。两者已是独立后端句柄，可分别替换。

- **不需要任何 PG 扩展**，连接角色只要能建表即可（受限托管环境常不给建扩展权限）。
- 全文检索是纯 `ILIKE` 子串匹配，与 SQLite/D1 的 FTS5-trigram 语义对齐（整句 AND、name/description/feedback 加权）。跨后端等价性由共享黑盒契约 `verifySearchIndexContract` 守住。
- 故意不建 trigram GIN 索引：候选查询是三列 `OR` + `LIMIT`，规划器在节点上限满载（4000 条记录）时一律选 Seq Scan，索引从不被用，却让插入慢 5.5 倍、表体积大 6.7 倍。放宽节点上限时需连同查询形状重新评估。
- 索引写路径在事务开头取 advisory lock 串行化：节点容量判定依赖 `COUNT(*)`，无锁时并发 mutation 会各自读到旧计数而突破上限。
- **切换后端不迁移数据。** 给一个已运行的 SQLite 实例设上 `TB_DATABASE_URL`，得到的是一套空 PG 状态：树、SK、secret、annotation、feedback 全部不在，且首次启动会重新走引导（需要 `TB_BOOTSTRAP_ADMIN_SK`）。回滚同理——移除变量即回到原 SQLite 数据，PG 侧写入不会回流。当前没有内建迁移工具，跨后端搬迁需自行导出/导入 `tb_kv` 与 registry 状态，并在切换后重建搜索索引。

## Compose 开发栈

```bash
pnpm compose:up
pnpm compose:smoke
pnpm compose:down
```

需要清空本地卷时才执行 `pnpm compose:reset`；这会删除 Compose 数据，运行前先确认目标只是本地开发状态。

Compose 默认值仅用于本机闭环，不是部署模板。交付前至少验证：冷启动、持久卷重启、Dashboard 静态资源、HTTP 工具调用、设备 WebSocket，以及缺 Admin SK 时拒绝启动。

Cloudflare 专属的 KV/R2/D1、Durable Object 与 Wrangler 配置不得下沉进 server；Node 的 SQLite/PG/文件语义也不得反向泄漏进 app。
