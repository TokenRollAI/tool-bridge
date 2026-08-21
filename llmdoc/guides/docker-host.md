# Node、Docker 与 Compose

`@tool-bridge/app` 承担宿主中立业务；`@tool-bridge/server` 为 Node 装配状态存储（SQLite 或 PostgreSQL）、文件对象存储、WebSocket 与 HTTP 监听。它不是 Cloudflare gateway 的兼容壳。

## Node 配置边界

- `TB_DATA_DIR` 持有 SQLite（未用 PG 时）和对象数据，应挂载持久卷并限制文件权限。对象存储始终是本地 FS，即使状态在 PG——多实例部署下 `$ref` 大对象不共享。
- 首次引导必须设置 `TB_BOOTSTRAP_ADMIN_SK`；缺失时启动默认 fail closed。
- `TB_ALLOW_INSECURE_BOOTSTRAP=true` 只用于一次性本地开发，会生成并输出随机 Admin SK，不能用于共享环境。
- `TB_ALLOW_INSECURE_HTTP=true` 只放行本地 HTTP 上游，不应进入公网部署。
- 反向代理必须保留 WebSocket upgrade、Authorization 和原始 host/proto 语义。

## 健康探针与优雅关停

三个免认证端点分工明确,k8s 探针按此接线:

- `/livez` → 恒 200(进程存活;liveness)。后端断连**不算死**——liveness 探后端会让编排器在 PG 抖动时错杀健康进程。
- `/readyz` → 就绪探测(readiness):Node 宿主逐后端连通性检查(PG `SELECT 1`、Redis `PING`,各限时 1s)+ draining 状态;任一不通或 draining → 503,编排器摘流量。SQLite/FS 无长连接可断,checks 为空恒 200。Workers/嵌入宿主未注入探测器,恒 200。
- `/healthz` → 保持原语义(版本 + catalog digest,三宿主对拍用),容器 HEALTHCHECK 用它。

关停顺序(SIGTERM):置 draining(`/readyz` 立即 503)→ 等 `TB_SHUTDOWN_DRAIN_SEC` 秒(缺省 0;k8s 建议 5–10,等 endpoint 摘除传播)→ 停止接受新连接、既有请求跑完 → 终止设备 WS → 关后端。镜像不再写死 `ENV TB_PORT`,平台注入的 `PORT` 真实生效,HEALTHCHECK 同步读 `TB_PORT ?? PORT ?? 8787`。

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
pnpm compose:up      # SQLite 后端(默认栈,127.0.0.1:8787)
pnpm compose:smoke
pnpm compose:down
```

Postgres 后端走 `pg` profile，映射到独立端口（默认 8788），可与 SQLite 栈并存对照：

```bash
pnpm compose:pg:up      # postgres + gateway-pg(127.0.0.1:8788)
pnpm compose:pg:smoke   # 同一份 smoke 打到 PG 栈
pnpm compose:pg:down
```

两条栈是**两套独立数据**：PG 栈不会带上 `/data` 卷里的树、SK 与 secret，会自己重新引导。`smoke` 全程走 HTTP、与状态后端无关，所以两边共用同一套断言——这正是后端对等的验收方式。

需要清空本地卷时才执行 `pnpm compose:reset`；它会删除**两条栈**的所有卷（含 PG 数据），运行前先确认目标只是本地开发状态。

Compose 默认值仅用于本机闭环，不是部署模板。交付前至少验证：冷启动、持久卷重启、Dashboard 静态资源、HTTP 工具调用、设备 WebSocket，以及缺 Admin SK 时拒绝启动。

## 生产 Compose(deploy/compose/)

`deploy/compose/docker-compose.yml` 是生产参考栈,与根目录的 dev compose 是两回事:没有测试上游/plugin/smoke 装置,secret 全部 `:?required`(缺失时 compose 启动前报错,不会起一个 fail-closed 循环重启的容器),PG 用标准 `postgres:16`。

- `--profile default`:gateway + postgres 单副本。
- `--profile ha`:双 gateway(`TB_REPLICA_ID` 显式 a/b)+ Redis 路由 + Caddy LB,对外一个端口。是**单机** HA 参考栈——验证跨副本设备转发用,机器本身仍是单点;真多副本走 Helm。
- 双副本共享 `$ref` 对象要求配 `TB_OBJECT_STORE_*`;compose 无渲染期校验,这条约束只能靠注释与 README 提醒(Helm 有硬校验)。
- gateway healthcheck 打 `/readyz`(非 `/healthz`):后端断连时容器转 unhealthy,`restart: unless-stopped` + LB 依赖才有意义。

## Kubernetes(deploy/helm/tool-bridge)

Helm chart 按后端配置自动推断形态,无独立 mode 开关:

- **standalone**(缺省,`postgres.url` 空):StatefulSet + RWO PVC,副本恒 1。用 StatefulSet 而非 Deployment+PVC 是为避免 RWO 卷上滚动更新的"新 Pod 等旧 Pod 释放卷"死锁。
- **HA**(`postgres.url` + `objectStore.*` 配齐):无状态 Deployment,`/data` 用 emptyDir(readOnlyRootFilesystem 下的可写落点),`maxUnavailable: 0` 滚动;`replicaCount > 1` 还必须配 `redis.url`。
- 危险组合(`replicas>1 + SQLite`、objectStore 半配、standalone 开 HPA、缺信任根)在 `helm template` 渲染期 `fail`,与运行时 fail-closed 语义对齐——坏栈根本部署不出去。
- `TB_REPLICA_ID` 用 `fieldRef: metadata.name`(Pod 名天然唯一);探针三分工 `/healthz`(startup)、`/livez`(liveness)、`/readyz`(readiness);`terminationGracePeriodSeconds` 要盖过 `shutdownDrainSec` + 排空时间。
- Ingress 接设备 WebSocket 必须放长 proxy 读写超时(nginx:`proxy-read-timeout`/`proxy-send-timeout`,示例见 `examples/values-ha.yaml`);Authorization/Host 语义按反代通则保留。
- chart 不打包 PG/Redis,只留 values 接线点;信任根生产建议走 `secrets.existingSecret`(External Secrets 等),不写明文 values。

## 部署到容器 PaaS（Railway / Fly / Cloud Run / CF Container）

镜像是单容器 + `EXPOSE 8787`，配 PG 后不再需要持久卷来存状态，因此适合这类平台。已就绪的部分：

- 端口取 `TB_PORT`，缺省兜底平台注入的 `PORT`，最后才是 8787。
- 状态与搜索都可外置到托管 PG（`TB_DATABASE_URL`），无扩展依赖，容器本身可无状态重启。
- `TB_CANONICAL_ORIGIN` 把 OAuth `redirect_uri` 钉在规范域名，多域名接入（平台默认域 + 自定义域）必须设置。

部署前必须知道的三个限制：

- **ObjectStore 缺省是容器本地 FS**（落在 `TB_DATA_DIR`），此时 `$ref` 大对象容器重建即丢、多副本互不可见。配 `TB_OBJECT_STORE_*` 换成 S3/R2 即可外置，见下节。
- **设备 WebSocket 多副本需配 `TB_REDIS_URL`**（见下节）。不配时设备只连在一个副本上，调用打到别的副本会误判离线。
- **首次引导需要 `TB_BOOTSTRAP_ADMIN_SK`**，缺失时 fail closed 拒绝启动。平台上表现为容器反复重启，日志有明确原因。

结论：**PG + S3 + Redis 三者配齐即可多副本横向扩容**；只配 PG + S3 是单副本无状态形态（容器可随意重建，但别扩副本）。

## 多副本设备通道（Redis）

设备的 WebSocket 是**活 socket**，只存在于接受它的那个进程里、不可序列化。所以多副本不是「换个存储」能解决的：副本 B 收到打给「连在 A 上的设备」的调用时，B 手里没有那个 socket，必须把调用**转发**给 A 再把结果收回。

```
TB_REDIS_URL=redis://...        # 启用路由表 + pub/sub 转发
TB_REPLICA_ID=<唯一标识>        # 可选，缺省用 hostname（容器平台上天然唯一）
```

机制：
- **路由表**（Redis string + 30s TTL，周期续期）：`deviceId → 持有者副本 ID`。副本崩溃后条目自动过期，不需要墓碑清理。
- **转发**（pub/sub）：发起方往持有者频道发 call，持有者执行完往发起方回执频道发 result，用 `correlationId` 关联。有独立超时兜底——持有者中途崩溃时发起方不会永久挂起。
- **本副本持有连接时完全不经这条路**，所以单副本部署零额外开销、也不用配 Redis。
- **回收保护**：`reclaim` 会 `deleteSubtree`（删数据）。多副本下「本副本没有该连接」不等于「设备离线」，故回收前必须查全局路由；`sweepOrphans` 同理。路由查不通时保守跳过——宁可晚删，不可错删。

`TB_REPLICA_ID` 在同机跑多进程时必须显式给，否则两个进程 hostname 相同、路由表分不清谁是谁。

对照 Cloudflare 宿主：那边用 Durable Object，天然「每设备一个单点」，不存在这个问题。本机制是 Node 多副本的等价物。

## 平台对象存储（S3 / R2）

配齐这四项即用 S3 兼容端点，缺省回退本地 FS：

```
TB_OBJECT_STORE_ENDPOINT=https://<account>.r2.cloudflarestorage.com
TB_OBJECT_STORE_BUCKET=tb-objects
TB_OBJECT_STORE_ACCESS_KEY_ID=...
TB_OBJECT_STORE_SECRET_ACCESS_KEY=...
TB_OBJECT_STORE_REGION=auto          # 可选，缺省 auto（R2 约定；AWS 端点应显式给区域）
```

- **四项必须齐全，缺一即拒绝启动。** 半套凭证静默回退本地 FS 的话，运维以为对象在 S3、实际写进容器层，容器重建即丢——这类错误只在故障时暴露，代价远高于启动即拒。
- 配上后 `$ref` 走 **S3 presign 直连**，大对象下载不再穿过网关进程（本地 FS 无 presign，只能走 `/~ref` 中转）。
- 这是**启动期基础设施配置**，不在 Dashboard 里改：运行时换端点会让已写入的 `$ref` 指向失效。需要按节点用不同存储时，走 `kind: 'context'` 节点自己的 S3 配置（那个本就可经控制面管理）。
- 与 `TB_DATABASE_URL` 组合即完整无状态形态：状态在 PG、对象在 S3，换全新容器（空 `TB_DATA_DIR`）仍能读回一切。这一条有集成测试覆盖。

Cloudflare 专属的 KV/R2/D1、Durable Object 与 Wrangler 配置不得下沉进 server；Node 的 SQLite/PG/文件语义也不得反向泄漏进 app。
