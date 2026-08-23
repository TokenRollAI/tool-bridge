# 当前状态

## 阶段

项目处于 pre-launch 开发期。核心树、认证、插件、Search、设备通道、CLI、Dashboard、Cloudflare 与 Node 宿主均已有实现；共享部署仅作开发验收，不代表正式上线。

## 当前事实

- 宿主中立应用在 `packages/app`，Cloudflare、Node、SDK 分别位于 gateway、server、sdk。
- Node server 的 StateStore/SearchIndex 是两个独立后端：缺省 SQLite，设 `TB_DATABASE_URL` 走 PostgreSQL（纯 `ILIKE` 检索，无扩展依赖）。切换后端不迁移既有数据。
- Node server 具备完整生产探针面：`/livez` 恒 200 只报进程存活；`/readyz` 做 PG/Redis 连通探测并在 draining 时返回未就绪；`/healthz` 报版本与 catalog digest 供对拍。SIGTERM 先进入 draining 再关停，窗口由 `TB_SHUTDOWN_DRAIN_SEC` 控制。
- StateStore 契约含可选原子原语 `putIfAbsent`，三宿主(D1/SQLite/PG)均原子实现。bootstrap Admin SK 铸造以 hash key winner-takes-all 去重，多副本并发冷启动不再产生重复 sk 索引。
- Cloudflare 宿主权威状态在 D1(ADR-001;TB_STATE/TB_SEARCH 两个 binding 指向同一个库),KV 已撤出；State/Search 均用请求级 `first-primary` Session，保留吊销即时性并让同请求后续读使用满足 bookmark 的副本；Wrangler 默认 Smart Placement 并输出 D1/Worker 时延观测。
- `@tool-bridge/gateway` 是双入口发布：包根是零插件库入口，`./full` 是与源码部署同形态的全量装配入口（内置插件目录 + D1 search）。Deploy Button template 消费 `./full`，template 与源码部署是同一个产品。
- 部署产物：`deploy/helm/tool-bridge`（standalone=StatefulSet+PVC 单副本，HA=无状态 Deployment 多副本，危险组合在渲染期 fail）与 `deploy/compose`（生产参考栈，default/ha 两 profile）。CI 的 deploy-artifacts job 把 helm lint、双形态渲染、负向用例、compose config 钉成硬闸门。
- SDK 根入口面向 Node 22+；React Native/Hermes 设备从独立 neutral 产物 `@tool-bridge/sdk/device` 导入，宿主注入 WebSocket、凭证、生命周期与 executor。
- 节点 kind 与 builtin 清单以 core 类型和 app bootstrap 常量为准，不在 MUST 手抄数量。
- 内置集成由生成 catalog + binding 成对装配，直接挂载；`system/plugin` 只承担显式注册管理。
- `system/catalog` 只返回逐 export 的 `exportDetails` 精确契约，不兼容 provider 级聚合字段。
- 首次 bootstrap 默认要求显式 Admin SK；Node server 只在显式本地开发开关下允许随机生成。
- 仓库内 Cloudflare 配置是账户中立模板，真实账户、域名和资源 ID 由 provision 回填，不提交。

## 近期重点

- 保持 pre-launch 契约收敛，避免重新引入隐藏别名、旧 wire fallback 或未实现公共面。
- 接口面变化继续执行 API / CLI / Dashboard 对等审计。
- 对宿主、搜索、插件与安全边界的修改，以可重跑测试和 build 产物为验收。

## 验收入口

```sh
pnpm verify
pnpm turbo run build   # 改 public package、打包配置或依赖时必跑
```

真实外部资源验证只在任务明确需要且得到授权时执行；每轮最多一次，并把证据留在 PR/CI，而不是追加到本文件。
