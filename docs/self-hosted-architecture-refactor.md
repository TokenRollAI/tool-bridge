# Tool Bridge：Self-hosted 架构重构方案与实施路线

日期：2026-09-05。

状态：**自托管主线已实现，正在本轮 PR 完成验证与审阅；尚未合并或发布。** 下文保留原始设计与验收边界，当前接口与部署行为以代码和 llmdoc 为准。

本轮按使用方的追加决定收敛：没有需要保留的旧实例数据，因此删除 Cloudflare、SQLite、部署级文件对象后端和旧环境变量兼容，不交付旧 SQLite/FS/环境变量迁移器。Railway 平台配置继续通过其 CLI 管理，不扩展 Dashboard 的平台部署适配器。默认 S3 已选用通过实测的 SeaweedFS，标准驱动采用网关 relay；直传、自动对象搬迁与后续搜索一致性调整不作为本轮承诺。

已经落地 PG Store/Mailbox 领域事务、固定后端身份、安装/恢复配对、版本化配置与三入口管理、密钥轮换和受限 Compose 执行器。验证记录见 [本轮验收记录](./self-hosted-refactor-validation.md)。

本文承接 [开源组件替代审计](./open-source-replacement-audit.md)，更新其中的部署前提与优先级，不沿用历史行数或删码估算作为本轮承诺。目标是减少长期维护的实现与部署分支，同时保留 Tool Bridge 的权限、工具发现和设备执行语义。

## 1. 决策状态与重构目标

| 事项 | 状态 | 本轮结论 |
| --- | --- | --- |
| 仅支持 Self-hosted | 已确认 | 本地与自行部署是唯一宿主方向，完整 Docker Compose 是默认交付方式 |
| Cloudflare 全面退出 | 已确认 | 删除 Workers、D1、DO、KV、R2 binding 及专属工具、配置、模板、CI 和说明；不维护次级适配或旧版本支持线 |
| SQLite | 已确认可以移除 | 从 Node 服务的生产/开发运行后端及公开导出中移除，不再维持 PG/SQLite 全功能对等 |
| PostgreSQL | 本方案目标 | 成为标准服务的唯一权威数据库；充分使用事务、约束和索引 |
| 对象存储 | 已确认方向 | 用通用 S3 兼容服务替换部署级本地文件对象后端，默认本地对象服务，允许自定义 S3 endpoint |
| 全量可视化配置 | 已确认 | 所有保留的产品环境配置都有 Dashboard 操作与 API/CLI 对等入口；首次安装无需手填 `.env`，后续配置同样可操作 |
| Redis | 本方案建议 | Compose 提供可选组件，先保留设备跨副本路由，缓存只用于可重建数据 |
| 默认 S3 服务品牌 | 待兼容性原型决定 | 不直接锁定已归档的 MinIO 社区镜像；先评估 SeaweedFS，AIStor 为另一个可选方案 |
| 联邦搜索一致性 | 待产品决策 | 可以研究精简，但本轮不把“允许分页重复或失效规则放宽”当作已接受变更 |

成功标准不是依赖更多、文件更少，而是：一次业务修改涉及更少权威定义；数据一致性由成熟组件承担；默认部署无需云账号；不再维护 Cloudflare 宿主分支，默认安装不要求用户先理解并填写环境变量。

## 2. 当前问题与替换边界

| 当前实现 | 造成的成本 | 目标处理 |
| --- | --- | --- |
| SQL 后端仍通过 `StateStore` 的 JSON KV + 单键 CAS 暴露 | Store 多记录写入要补偿，owner 列表先扫描再过滤，Mailbox 扫历史找待办 | 配置保留简单 KV；Store/Mailbox 使用窄领域存储接口和 PG 表 |
| Node 缺数据库配置时回退 SQLite | 双驱动、双搜索适配、原生依赖和双套部署验收 | 仅 PG 承担业务持久化；无配置时进入安装向导，业务路由未就绪，不创建 SQLite 库 |
| 部署级 FS ObjectStore | 临时文件、fsync、硬链接、rename、staging 清理及路径防护都由仓库承担 | 删除运行时 FS fallback，字节操作交给 S3 服务 |
| `aws4fetch` 上手写 S3 REST/XML | XML 解码、分页、路径编码、响应及异常处理自行维护 | Node 使用官方 AWS S3 SDK，保留小型 TB 语义适配器 |
| 一个进程固定一个 ObjectStore | 改 endpoint 会让旧对象和在途上传找错桶 | 对象绑定不可变后端身份，切换只改变新上传的默认后端 |
| 固定端点在 app/OpenAPI/SDK 重复绑定 | 路径、schema 与返回值可能漂移 | 少量固定路由先验证声明与生成方案 |
| 手写 OAuth URL 与静态资源协议 | 已复现 query 拼接和编码协商边界错误 | Web 标准 API、OAuth 库与 Hono 中间件 |
| 递归联邦搜索的严格快照 | 递归校验、会话账本、全局配额及清理成本 | 保留现有契约，另开有真实查询样本的精简试点 |

代码入口：[`StateStore`](../packages/core/src/store.ts)、[`StoreService`](../packages/core/src/objectStoreService/service.ts)、[`Mailbox`](../packages/core/src/device/mailbox.ts)、[`Node FS driver`](../packages/server/src/objects.ts)、[`S3 driver`](../packages/app/src/providers/s3Object.ts)、[`Node 装配`](../packages/server/src/server.ts)。

### 2.1 三种“CAS/原子写”必须分开处理

1. **业务元数据 CAS**：object/session/quota/lease 的并发状态转换。迁到 PG 事务与条件更新，仍需防止两个消费者同时推进状态。
2. **对象字节的条件写**：禁止覆盖、按 ETag 更新。交给经过验证的 S3 `If-None-Match` / `If-Match`，不能退化成先 HEAD 再 PUT。
3. **设备本地执行屏障**：设备 journal 的 fsync/rename 用于崩溃恢复、防止未知结果被重新执行。它不属于网关对象存储，不迁到远端 S3。

`packages/server/src/objects.ts` 是可退役的部署级对象后端。`packages/core/src/node/fsObjectStore.ts` 仍服务设备暴露本地目录，设备执行 journal 也仍需本地持久化，不能按文件名机械删除。设备本地目录 `ifMatch` 的并发语义应另行审计，不在本轮冒充已获得 S3 的原子保证。

## 3. 目标运行架构

```mermaid
flowchart TB
    U[Dashboard / CLI / SDK / MCP] --> A[Tool Bridge Node 服务]
    A --> P[(PostgreSQL：权威状态)]
    A --> O[S3 SDK 与 TB 薄适配器]
    O --> L[Compose 内置 S3 服务]
    O --> R[自定义 S3 endpoint]
    A -. 多副本设备路由与派生缓存 .-> C[(Redis：可选)]
    A --> D[设备 WebSocket / Mailbox]
```

应用保持一个服务进程和现有 core/app/server 的责任划分，不拆微服务。PG、S3 和 Redis 是成熟基础设施；只有出现明确扩展需要时才把后台 maintenance 独立成进程。

- **PG**：节点、SK、加密凭证、配置、Store 元数据、Mailbox、必要持久任务与审计记录。
- **S3 服务**：对象字节、对象级条件写和必要的上传原语。Tool Bridge 仍决定 owner、分享、限额与对象何时可读。
- **Redis**：设备连接路由、瞬时通知、经评估的派生缓存；不是权限、执行结果或存储记录的唯一来源。
- **浏览器和 neutral SDK**：继续通过公开 HTTP 契约访问，不能因服务端改成 PG/S3 SDK 而引入 Node 依赖。

只交付 Node 自托管宿主。删除所有 Cloudflare 专属适配、预设、部署和维护承诺；通用 S3 自定义 endpoint 按协议能力验证，不提供任何云厂商专用路径。首次启动还包含一个不依赖 PG 的受限安装面，详见第 6 节。

## 4. PG 主线与 SQLite 退役

### 4.1 移除范围

删除 Node 的 SQLite StateStore/SearchIndex、默认回退分支、`better-sqlite3` 相关运行依赖、公开导出和只服务该后端的测试/构建配置。根开发 Compose、生产 Compose、示例、Helm 与安装说明统一指向 PG。

SDK 当前的内存测试替身和设备本地 journal 不等于 SQLite；它们不在删除范围。SDK 嵌入应用如要持久 Store/Mailbox，应显式注入新的领域依赖，不能通过不具原子性的默认实现伪装生产可用。

**升级后的行为变化**：未初始化实例可启动安装界面，但 PG 未配置完成前不提供业务服务；已初始化实例 PG 故障时进入故障/恢复状态，不能重新开放匿名安装。旧 SQLite 类导出不再存在。该变化必须在 minor 版本、提交、PR 与迁移说明中明确写出。

### 4.2 持久层形状

保留现有 `postgres` 驱动。优先以 Drizzle 做 schema、迁移和查询原型，但只有净收益成立才引入；不再造通用 ORM、事务 DSL 或全后端兼容层。

建议用两个领域接口包住真正的业务原子操作，而非把 `transaction(callback)` 暴露给所有 core 代码：

| 接口/操作（示意名） | 应由一次数据库原子操作保护的内容 |
| --- | --- |
| `StoreRepository.beginUpload` | 幂等绑定、对象记录、上传会话、call 配额 reservation、backendId |
| `StoreRepository.finishUpload` | 确认当前 session、推进 ready、固定已消耗配额；成功不能释放 call 的累计对象名额 |
| `StoreRepository.listReadyObjects` | owner/status 过滤与稳定分页 |
| `MailboxRepository.enqueue` | 幂等键唯一性、pending 配额与 operation 创建 |
| `MailboxRepository.claimNext` | device/credential 约束、候选选择、lease/attempt 推进 |
| `MailboxRepository.complete` | 有效 lease、终态幂等提交与结果持久化 |

表至少覆盖 objects、upload sessions、shares、call reservations、device operations、storage backends 与当前默认配置。简单配置仍可存在 PG JSONB KV 中，不为“关系化完整”重写所有 registry/secret 读写。

配额迁移保持既有累计语义：成功上传继续消耗该 call 的对象数/字节额度，不能因 session 完成而允许同一次 call 无限上传。未知 size 的预留差额是否返还、失败/取消何时释放，逐项按旧实现对拍；改变这些行为需单独声明契约变化。

索引围绕真实访问建立：owner + status + 分页键、device + 可领取状态/时间、到期清理时间、幂等身份。并发测试必须验证配额判定与写入处于同一原子边界；`SKIP LOCKED` 只解决候选领取，不自动解决配额和副作用幂等。[PG 领取语义](https://www.postgresql.org/docs/current/sql-select.html)

### 4.3 不跨网络持有数据库事务

上传授权、S3 PUT/HEAD/DELETE 和 PG 提交分段完成，不能持有行锁等待远端网络：

1. PG 创建有界 reservation 和 pending/session。
2. 返回 relay/direct 授权，执行对象存储 I/O。
3. 服务端校验实际对象后，用 PG 事务推进 ready。
4. 断线或崩溃留给同 identity 的恢复/清理流程，不产生新 identity 重做外部副作用。

对象已上传而 PG 未提交、PG 标记删除而 S3 暂时不可达，这两种情况仍需可恢复状态。迁移的目标是删除跨数据库记录的人工补偿，不是声称数据库和 S3 构成一个分布式事务。

## 5. S3 对象存储与默认服务选型

### 5.1 MinIO 的当前状态改变了默认选择

2026-09-05 核查：[MinIO 社区仓库](https://github.com/minio/minio)明确已归档且不再维护。官方转向 AIStor；其[容器安装](https://docs.min.io/aistor/installation/container/install/)要求许可证，包含可申请的单机免费层。因此，“默认部署旧 MinIO 社区镜像”不应直接成为长期方案。

| 候选 | 定位 | 决策条件 |
| --- | --- | --- |
| SeaweedFS | 默认本地 S3 服务的首个原型候选 | 官方已有单机 S3/Docker 入口；需验证条件写、流式上传、重启持久性、资源占用及最小暴露面 |
| MinIO AIStor | 用户自选的 S3 后端候选 | 接受其当前许可与获取流程后验证；不把自动接受许可或申请账号藏进安装脚本 |
| 现有 MinIO 部署 | 兼容接入候选 | 针对部署版本测试；不因此承诺维护旧上游软件 |
| AWS S3 / 其他通用 S3 endpoint | 用户配置的外部对象后端 | 通过所需 S3 能力测试，不将“S3 兼容”理解为全部行为相同 |

SeaweedFS 的[官方项目](https://github.com/seaweedfs/seaweedfs)提供 S3 Docker/单机运行方式。这只是进入原型的依据，不构成生产可靠性或 TB 契约等价的验收结论。最终镜像必须在实施 PR 中锁定版本/摘要。

### 5.2 用官方 SDK 接管协议

Node 优先试用 `@aws-sdk/client-s3` 与 `@aws-sdk/s3-request-presigner`，替换手写 S3 URL/XML/分页/签名调用编排，依据 [AWS SDK 官方文档](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-s3.html)验证流与 presigner 接口。

保留薄适配层负责：TBError 映射、secret 脱敏、域与网络策略、请求 deadline、流式限额、create-only/ETag 契约和 backendId 选择。SDK 留在 Node 服务端边界，不能进入浏览器或 neutral device SDK 闭包。

原型明确配置 `maxAttempts: 1`，先保住当前不隐式重放请求的行为；未来重试按操作幂等性单独决定。AWS 将 initial request 计入 max attempts，1 表示无自动重试。[重试配置](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html)

还需验证 SDK 的流式 body、socket 释放、checksum 默认行为与目标 S3 服务兼容性，不用 `arrayBuffer()` 把大对象全部读进内存。[SDK 流处理](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-s3.html)

### 5.3 必需能力与可选直传

服务端 relay 的必需能力是 PUT/HEAD/GET/DELETE、metadata、create-only 条件写；Context 还要验证 LIST、分页、特殊字符 key、ETag 条件更新和保留 namespace 隔离。S3 的条件写用于对象原子保护。[AWS 条件写](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)

后端不满足所需原子条件时拒绝启用相关能力，不能用 HEAD+PUT 模拟。每个目标服务逐项验证，不能凭 SDK 调用成功推导所有条件都被服务端执行。

**默认本地 S3 先走 gateway relay**：Compose 内部域名无法被用户浏览器/设备访问，HTTPS Dashboard 也不能直接访问内网 HTTP 地址。后端 signer 可用不等于 direct 可用。

直传必须同时验证：

- 公网可达且符合信任策略的 S3 endpoint；禁止签名后改 host/scheme。
- 精确 size 与 Content-Length、Content-Type、create-only 条件实际受签名及后端约束；错误大小被拒绝。
- 浏览器 CORS、真实 PUT、complete/HEAD 构成闭环；浏览器不能手工设置某些受限 header，必须测试最终 wire。
- 上传会话的大小/数量限制、TTL 和 secret 脱敏保持一致。

不满足直传条件时使用受限流式 relay，而不是放宽大小和条件写保证。签名 endpoint 必须与实际请求一致，不能任意替换成另一个域名。

下载先保留现有网关鉴权 relay 与可撤销 share。直接签发长寿命 S3 GET 会改变撤销语义，不纳入本轮默认优化。Multipart/断点续传按真实文件需求单独验证 SDK/lib-storage/tus，不提前扩成通用上传平台。

## 6. 全量 Dashboard 配置、首次安装与存储管理

### 6.1 无需 `.env` 的首次安装

默认路径是下载完整 Compose、执行 `docker compose up -d`、打开 Dashboard 安装向导。应用以固定默认监听启动；独立 setup 模式不依赖 PG、SecretStore 或完整业务装配，只开放安装、健康和受限恢复接口。

1. 初始化任务自动生成本地 PG/S3 应用凭证、加密根和稳定实例身份，通过受保护的持久卷/secret 文件交付服务，不要求复制密钥进 `.env`。服务镜像是否支持文件式凭证逐一验证，不能假设所有变量都有 `_FILE` 变体。[Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/)
2. 安装入口的宿主公开端口默认绑定 loopback，容器内部仍按容器网络监听，远程安装可经 SSH 隧道；安装器交付一次性配对凭证。凭证不放 URL，不复用长期 Admin SK，不开放“第一个公网访客成为管理员”。
3. 向导自动发现内置 PG/S3，也允许在页面填写外置 PG、S3、Redis、公开地址与高级设置。默认无需填写数据库 URL、密码或根密钥。
4. 验证连接与权限，执行 schema migration、bucket 初始化、管理员创建，逐步记录可恢复进度。多个安装请求只能有一个获准推进；失败重启可继续，不重复生成并覆盖已有密钥或实例身份。
5. 完成后持久化 initialized 状态并关闭初始安装入口，再开放业务路由。PG 不可达时显示故障与受保护恢复入口，绝不能被识别为“新安装”。管理员凭证通过专门交付/恢复流程管理，不写普通日志。

恢复鉴权独立于故障中的 PG 与待恢复加密根：由具有宿主/持久卷权限的本机管理员运行恢复命令，建立短寿命、单次、绑定实例的恢复配对凭证，经本机受保护通道交付。远程网页不能自行生成恢复资格；完成或超时即关闭，不能复用已经失效的首次安装凭证。

安装、恢复也须有同权 API/CLI。尚无 HTBP 业务装配时使用最小 bootstrap 接口，共用 schema、权限与实现；业务就绪后关闭首次安装权限，不能留下匿名管理旁路。

### 6.2 配置存放位置与单一权威

| 配置类别 | 保存位置 | Dashboard 操作与生效方式 |
| --- | --- | --- |
| 业务与运行参数 | PG 版本化配置记录 | 校验、预览差异、保存；按字段声明热更新或重建运行时 |
| 服务凭证 | PG SecretStore 加密记录 | 写入、验证、轮换、撤销；只显示是否配置与版本，不回显原值 |
| PG 连接、加密根/keyring 引用、初始化标记、监听参数 | PG 外最小 bootstrap 文件与受保护 secret 文件 | 安装/维护/恢复页面管理；启动参数受控重启，数据库切换和根轮换走专项流程 |
| 镜像、容器端口映射、挂载目录 | 本机安装器维护的部署描述与实际部署状态 | 页面编辑期望值、预览、通过受限执行器应用并回报结果 |
| CLI 连接偏好 | 客户端 profile | Dashboard 配对/导出，CLI 安全导入；不要求编辑客户端 env |

PG 地址不能只保存在 PG 自己里面，加密根也不能只保存在用它加密的数据库里。bootstrap 只保存启动与恢复必需的少量字段，不能变成第二套完整 KV 数据库；默认固定路径由安装器管理。根密钥依赖文件权限或部署 secret 保护，不能声称“用自身加密”解决保护问题。

文件持久化优先使用成熟的 [write-file-atomic](https://github.com/npm/write-file-atomic) 一类组件；它解决原子替换，不提供多进程分布式 CAS。每个实例引导状态由单一安装器写入，业务进程不并发改写。该文件不是对象字节后端，不能因此恢复已退役的 FS ObjectStore。

旧 `.env` 支持向导一次性导入：解析并显示识别项、废弃项、敏感项和覆盖差异，校验后写入各自权威位置。迁移完成后重启不再让旧 env 静默覆盖页面设置。保留的自动化输入也经同一配置 schema 导入，不能建立永久的 env/PG 双重优先级。

### 6.3 统一配置契约与生效状态

用一个 Zod schema/config catalog 声明字段类型、默认值、敏感性、权限、作用域和生效方式，生成或驱动 API/CLI/表单。普通设置使用清晰表单，高级设置仍提供校验、单位与说明，不要求用户编辑任意 JSON。后续新增产品配置必须同时进入该目录和三入口覆盖验收，不能新增只有 env 能设置的参数。不要再造通用配置平台或独立配置微服务。

- 页面同时显示期望值、实际生效值、配置 revision、最近错误，以及“已生效 / 待重启 / 等待执行器 / 迁移中 / 失败已恢复”等状态。
- 修改带 expected revision，避免两位管理员互相覆盖；服务端再次校验，敏感值不进入审计、浏览器持久状态或 CLI argv。
- 热更新在明确请求边界使用同一配置快照；存量 grant、上传 session、搜索请求保留原 TTL/限额/预算，不能用新设置重新解释已签发能力。
- 多副本通过 PG revision 发现更新，Redis 仅加速通知；漏消息仍能收敛。权限与存储切换不能依赖本地旧缓存放行。
- 连接池、Redis、调度器等不能只改配置对象；必须完成重建、drain 或重新调度才报告生效。副本身份为每实例独立值，不能全局配置成相同 ID。
- 所有高权限配置有独立 admin 权限和脱敏审计；出站规则也可在页面配置，应用精确 origin 例外，不提供无边界的“关闭安全”开关。

拟议三入口：`system/config` ↔ `tb config` ↔ “设置”；操作至少包括 schema/get/validate/update/status。专项操作包括 apply/restart、database migrate、keys rotate/recover；它们必须绑定被验证的 revision、当前实例和操作者权限。存储配置细化见 6.6–6.10。

### 6.4 重启、切库、密钥与部署设置必须真的可操作

**启动参数**：Dashboard 保存候选 bootstrap revision，先校验端口/路径等，再执行受控重启与 readiness 复核；失败保留已知可用配置及本机恢复入口。dataDir/引导目录搬迁由安装器更新定位与挂载，不能把“新目录地址”只写进即将找不到的旧文件里。

**数据库**：页面区分首次连接、迁移当前实例、接入另一实例。切库校验 schema/权限/instanceId，进入维护并停写，备份、迁移、校验，然后原子更新 PG 外的连接指针并重启。空库连接成功不等于迁移成功。新库接受写入后，回退需要处理新数据，不能直接改回旧 URL。内置 PG 用户/密码/数据库名的变更必须更新真实角色、权限或数据库，再同步部署 secret、bootstrap 与连接池；只改连接字符串不算完成。凭证轮换先验证新身份可用，再切换并退休旧身份，保留失败恢复步骤；内置 S3 凭证也须经其管理接口实际轮换。

**密钥**：加密根、Store token secret 可在页面生成、备份/恢复和轮换，不能普通表单覆盖。先引入带 keyId 的密文与 keyring，覆盖 SecretStore、Mailbox payload 和签名能力的实际使用点；任务记录重加密进度与校验，完成后才退休旧根。签名轮换需保留旧验签 key 到既有 token 到期，或让管理员明确选择撤销；不能静默使全部旧 grant 失效。备份下载是显式高权限操作，不回显在常规设置查询中。

**镜像、宿主端口、卷和静态资源路径**：业务进程写 PG 无法修改 Docker 端口映射。沿用 `tb` 增加本机部署执行模式，由具备该部署管理权限的本地安装器执行固定操作；不新增自研通用编排平台。Dashboard 编辑、预检、展示变更后请求应用；执行器只接受绑定实例/配置 revision 的白名单操作，回报重建、健康检查与失败恢复结果。业务容器不挂 Docker socket、不接受任意 shell。

默认 Compose 的首次启动不依赖常驻宿主执行器。需要修改宿主部署项时，页面给出配对本机执行器的具体命令并显示连接状态；连接后从页面应用。执行器不可用时明确“已保存，等待本机执行器”，不能显示已生效。仅下载 YAML 或让用户手改 env 不算该能力完成；需验收完整应用路径，包括端口改变后展示新的访问地址和恢复方法。

### 6.5 配置覆盖清单

以下是当前代码中的输入清单，不只依赖 `.env.example`；实施时逐项登记页面/API/CLI 入口、保存位置、生效时机、失败恢复与敏感值策略。变量名仅用于旧部署导入与审计，新页面用产品名称。

| 配置组 | 现有输入 | 目标处理 |
| --- | --- | --- |
| PG | `TB_DATABASE_URL`、`TB_PG_USER`、`TB_PG_PASSWORD`、`TB_PG_DB` | 内置自动初始化；安装/数据库维护页；引导文件 + 部署 secret |
| 管理员 | `TB_BOOTSTRAP_ADMIN_SK`、`TB_ALLOW_INSECURE_BOOTSTRAP` | 一次性安装配对、管理员交付；删除 insecure bootstrap 逃生口，不做危险开关 |
| 加密/签名 | `TB_SECRET_ENCRYPTION_KEY`、`TB_STORE_TOKEN_SECRET` | 安全设置与版本化轮换/恢复 |
| S3 | `TB_OBJECT_STORE_ENDPOINT`、`TB_OBJECT_STORE_BUCKET`、`TB_OBJECT_STORE_REGION`、`TB_OBJECT_STORE_ACCESS_KEY_ID`、`TB_OBJECT_STORE_SECRET_ACCESS_KEY` | 存储表单、验证、启用、凭证轮换 |
| 监听/映射 | `TB_HOST`、`TB_PORT`、`PORT`、`TB_BIND`、`TB_PUBLIC_PORT` | 网络/部署页，重启或重建；`PORT` 只作导入别名 |
| 镜像/目录 | `TB_IMAGE`、`TB_DATA_DIR`、`TB_UI_DIR` | 部署页 + 本机执行器，校验路径/挂载并维护恢复位置 |
| Redis/实例 | `TB_REDIS_URL`、`TB_REPLICA_ID`、`TB_INSTANCE_ID`、`TB_SHUTDOWN_DRAIN_SEC` | 服务连接、实例及维护设置，必要时 drain/重建；默认生成独立实例身份 |
| Origin/出站 | `TB_CANONICAL_ORIGIN`、`TB_ALLOW_INSECURE_HTTP`、`TB_REMOTE_ALLOWLIST`、`TB_MAX_HOPS` | 网络与出站策略页；精确例外替代全局不安全模式；说明 callback/分享地址影响 |
| 联邦搜索 | `TB_SEARCH_FEDERATION_CONCURRENCY`、`TB_SEARCH_FEDERATION_DEADLINE_MS`、`TB_SEARCH_FEDERATION_MAX_RESPONSE_BYTES`、`TB_SEARCH_FEDERATION_MAX_SOURCES`、`TB_SEARCH_FEDERATION_MIN_CHILD_WORK_MS`、`TB_SEARCH_FEDERATION_RETURN_RESERVE_MS`、`TB_SEARCH_FEDERATION_SESSION_TTL_SEC` | 高级搜索设置；当前保留契约，新请求固定预算快照 |
| 设备/缓存 | `TB_DEVICE_RECLAIM_SEC`、`TB_TOOL_CACHE_TTL` | 设备及缓存页；按安全回收流程生效 |
| Context/grant | `TB_REF_THRESHOLD_BYTES`、`TB_REF_TTL_SEC`、`TB_UPLOAD_GRANT_TTL_SEC` | Context/上传设置；影响新签发能力 |
| Store 限额 | `TB_STORE_MAX_OBJECT_BYTES`、`TB_STORE_RELAY_MAX_BYTES`、`TB_STORE_CALL_MAX_BYTES`、`TB_STORE_CALL_MAX_OBJECT_BYTES`、`TB_STORE_CALL_MAX_OBJECTS`、`TB_STORE_CALL_ALLOWED_CONTENT_TYPES` | 存储限额页；新 session 固化约束 |
| Store TTL/清理 | `TB_STORE_UPLOAD_TTL_SEC`、`TB_STORE_SHARE_TTL_SEC`、`TB_STORE_READ_TTL_SEC`、`TB_STORE_CLEANUP_INTERVAL_SEC` | 存储维护页；新 TTL 与显式重新调度 |
| 客户端连接 | `TB_BASE_URL`、`TB_SK` | Dashboard 配对/连接配置导出与 CLI profile；不混成服务器全局 SK |
| 测试输入 | `TB_TEST_MCP_URL`、`TB_TEST_MCP_BEARER`、`TB_TEST_S3_ENDPOINT`、`TB_TEST_S3_ACCESS_KEY_ID`、`TB_TEST_S3_SECRET_ACCESS_KEY`、`TB_TEST_S3_BUCKET` | 从产品模板移入测试 harness；产品外部连接诊断如保留，提供同权页面/API/CLI 并保护凭证 |
| CF 专属 | `CLOUDFLARE_*`、`TB_PROVISION_*`、`TB_DOMAIN`、`TB_NAME_PREFIX`、`TB_R2*` 及 CF bindings | 随能力删除，不为已删除功能新增表单；`TB_BASE_URL` 的客户端用途保留 |

移出测试输入、删除 CF/不安全逃生口必须显式列明，不能把未覆盖项藏进“高级 env”。`pluginCatalog` 等程序化注入不是环境变量，也不能直接变成网页上传可执行代码入口。

### 6.6 最小用户流程

在管理区增加“对象存储”配置，与已有文件列表区分：

1. 展示当前默认后端、历史仍有数据的后端、健康/验证结果。
2. 新增连接：选择内置对象服务或通用 S3，填写 endpoint、bucket、region 和凭证；不提供 Cloudflare/R2 专用选项。
3. 保存为未启用配置；输入凭证只写 SecretStore，后续页面仅显示“已配置”，留空表示沿用。
4. 管理员显式执行“测试读写”，服务端在专用随机 probe key 上做 PUT/HEAD/GET/DELETE，并实测 create-only 并发冲突；如服务 Context，还需实测 If-Match、LIST/分页等所需能力。显示逐项结果及清理失败，不扫描业务对象或要求列出账户全部 bucket。
5. 对应配置 revision 与 credential generation 的全部必需能力通过后，执行“用于新上传”；普通读写成功不足以启用。说明旧文件继续保留在原存储，不把切换按钮描述成数据搬迁。
6. 有引用的旧后端可停用新上传，但不可删除；凭证轮换走独立更新和复验流程。

内置对象服务由安装器初始化应用 bucket 和凭证；自定义 endpoint 首版连接已有 bucket，连接测试不自动修改其管理策略或 CORS。

### 6.7 权威配置与凭证

PG 保存 `backendId`、显示名称、endpoint、bucket、region、prefix、authRef、revision 和验证能力；访问密钥通过现有 SecretStore 加密保存。原始密钥不进入 backend GET、registry、审计、浏览器持久状态或 CLI argv。

配置创建时，把用户授权提供/引用的凭证保存为内部受保护的 credential generation；复用现有保留命名空间，不让普通 `secret set/delete` 绕过存储验证改写它。验证结果绑定 backend revision 和 credential generation。轮换先验证新凭证，再原子切换 generation；失败保持旧值，请求期间固定 generation，旧值按在途请求与恢复窗口回收。

PG 连接、加密根、安装身份与基础网络策略也必须可视化管理，按 6.1–6.5 的引导、权限和维护流程操作，不能作为“仍须编辑环境变量”的例外。

Compose 初次初始化创建一个默认 S3 backend 和应用专用 bucket 凭证。已有 PG 配置时不在每次启动用 env 覆盖它；旧环境变量只作为可预览的一次性迁移输入，PG 是业务配置权威；启动根另存于最小引导状态。迁移旧 `TB_OBJECT_STORE_*` 配置时显式生成初始 backend 记录并保留审计证据。

配置管理使用独立的部署级 admin 权限；普通节点 `register`/`read`/`call` 不能修改默认桶或使用任意 secret。解析 authRef 前验证 secret 使用权限；错误不暴露密钥存在性。

### 6.8 网络与 SSRF 边界

S3 endpoint 变为 UI 输入后，服务端必须在 probe、启用和所有实际请求上执行同一策略：标准 URL parser、拒绝 userinfo/query/fragment/未知路径形态、限制 scheme、禁止 redirect 重放凭证、设置 deadline 与响应大小上限。

Compose 的私网 S3 是精确的部署级例外：允许声明的服务 origin 和必要 HTTP，不通过全局开关放开全部 provider 的内网访问。Metadata/link-local 等地址继续拒绝。Node 的 DNS 检查必须与实际连接绑定，或由部署网络出口保证；仅在保存表单时解析一次域名不能宣称已阻断 DNS rebinding。优先复用成熟 request handler/网络策略组件，不手写另一套 DNS 协议。

应用凭证仅需目标 bucket/prefix 的业务权限，存储 root/admin 凭证只用于初始化，不进入 Tool Bridge 日常请求配置。

### 6.9 三入口对等

下列名称是**拟议接口**，不是当前可执行命令：

| 管理能力 | HTBP/API 建议 | CLI 建议 | Dashboard |
| --- | --- | --- | --- |
| 查询后端 | `system/storage list|get` | `tb storage list|get` | 列表与详情 |
| 创建配置 | `system/storage write` | `tb storage add` | 新增连接 |
| 轮换凭证 | `system/storage update` + SecretStore | `tb storage update` + stdin/file 凭证通道 | 留空沿用、显式替换 |
| 验证能力 | `system/storage test` | `tb storage test` | 测试读写 |
| 切换新上传 | `system/storage activate` | `tb storage activate` | 用于新上传 |
| 删除无引用后端 | `system/storage delete` | `tb storage rm` | 删除 |

沿用现有 HtbpCommandRegistry/Zod 投影 Help、权限和入参，不新增另一条绕过 HTBP 的管理通道。`system/store` 继续管理用户对象；`system/storage` 管理部署后端。实现时同步 builtin 保留路径、SDK、MCP 可见性与三端发现闭环。

### 6.10 切换不丢旧对象

当前 StoreObject 只有 driverKey，服务实例只有一个 ObjectStore，因此**先实现 backendId，再开放切换 UI**：

- backend 的 endpoint/bucket/prefix 定义不可原地改变；更换位置创建新 backendId。凭证轮换保留 backendId，提升配置 revision。
- 每个 object 持有唯一权威 backendId；upload session、share 优先通过 objectId 解析后端，不重复存储可漂移的字段。幂等重试恢复原绑定。
- `activate` 原子修改唯一 active backend 指针；新建上传在创建事务中读取该指针。不能依赖 Redis 消息才能看见切换。
- 旧 session 的 PUT、complete、HEAD，以及旧对象的 read/share/delete/cleanup 均按原 backendId 路由；请求期间固定 driver/config revision。
- share 通过 object 解析后端，公开 `store://default/<id>` 身份不变。
- 旧 backend 尚被对象、会话或待清理记录引用时不得删除；旧 secret 也不能被删除后让这些记录不可恢复。

首版支持“一处用于新上传、多处保存历史对象”，不提供按用户分桶、自动分层或通用多云调度。切回旧默认只改变后续新上传，新后端已有对象仍从新后端读取；旧后端故障不能静默读取其他桶的同名 key。

现有对象型 Context 也可能复用平台 ObjectStore。切换 default Store 时，既有 Context 必须显式绑定原 backend 或使用其自身独立配置，不能随 active 指针一起换桶。迁移时核对 Context 和 Store 两类引用，继续隔离保留 namespace；删除历史后端的引用检查也必须包含 Context。

## 7. 其他代码收敛与明确保留项

| 工作 | 做法 | 验收重点 |
| --- | --- | --- |
| OAuth URL | 用 URL/URLSearchParams；标准 provider OAuth 试 oauth4webapi，MCP 继续官方 SDK | 已有 query 不产生重复协议参数；fragment 拒绝；PKCE/refresh/凭证绑定与跳转策略不退化 |
| 静态文件 | Hono static/ETag + 构建预压缩 | `*;q=1, br;q=0, gzip;q=0` 不发 br；304/Vary、SPA fallback 与路径防护 |
| 挂载参数 | 共享 normalized input → NodeConfig 的 Zod 规则 | CLI/UI 不再平行维护 MCP OAuth 与 HTTP tool shape |
| 固定 API | 用三个 device operation 端点试 @hono/zod-openapi 与生成 client | route/schema/OpenAPI 一处声明；runtime validation 与错误脱敏保留 |
| Provider catalog | 挑几个维护成本最高的 provider 比较官方 SDK/OpenAPI 生成 | 普通 HTTP 已有共享层，不重复实施历史审计的已完成工作 |
| 搜索 | 先保留 PG 查询；另试 Meilisearch 或放宽联邦快照 | 中文/英文真实 query 的 top-k、权限、延迟、运维成本；不能只比行数 |
| 包与构建 | 统一 source resolution，按真实消费者决定 public 包边界 | neutral 闭包、tarball 和跨 bundle TBError 行为不破坏 |

保留的产品核心：HTBP 树/动态发现、deny 优先与不可见 404、SecretStore 引用边界、受控出站、设备连接 generation、Mailbox dispatch certainty/journal、Store owner/capability/share、Context 与 Store namespace 隔离。

Self-hosted 默认闭环不依赖 SaaS。Nango/OpenConnector 等独立集成服务仅作为另行评估的可选项；不因它们有大量连接器就直接转移凭证权威或取消现有 provider 安全边界。

## 8. Compose 交付、维护与故障行为

目标基础栈：应用（含 Dashboard）+ PG + 本地 S3 服务。Redis 在多副本 profile 启用；自定义外部 S3 模式不启动本地对象服务。默认使用一个应用副本，避免把多副本本身当成可靠性的前提。

完整交付至少包括：

- 默认 `docker compose up -d` 后即可访问安装向导，无需创建 `.env`；自动生成本地 PG/S3 凭证、根密钥和实例身份，固定镜像版本/摘要并提供健康检查。
- PG/S3 持久卷；应用容器不再持有权威对象字节。数据库和对象服务管理端口默认不暴露公网。
- 一次性 bucket/应用凭证初始化，以及受数据库锁保护的 schema migration；失败时新服务不接受业务流量。
- readiness 等待实际依赖就绪，应用运行期支持连接重建；容器 `unhealthy` 不等于 Docker 自动重启或故障转移。[Compose 启动语义](https://docs.docker.com/compose/how-tos/startup-order/)
- PG 备份、对象备份、加密根备份与恢复演练；只有数据库 dump 无法恢复对象，只有 bucket 无法恢复 owner/分享/凭证。
- 升级前备份、明确 schema 兼容窗口和失败恢复；单机双副本不能掩盖宿主机、PG 或对象盘单点。

| 故障 | 目标行为 |
| --- | --- |
| PG 不可用 | 依赖权威状态的请求失败，readiness 不就绪；不使用缓存继续接受授权写入 |
| S3 暂时不可用 | Store 请求可诊断失败；已知状态保留，恢复后继续同 session/清理；不宣告对象 ready |
| Redis 不可用 | 单副本不受该依赖约束；多副本路由按明确未知/未分发结果处理，不盲目重执行 |
| 新后端验证失败 | 配置保持未启用，不改变 active backend |
| 切换后旧 S3 不可用 | 只影响绑定旧后端的对象，显示可诊断失败；不跨桶猜测对象 |
| maintenance 中途崩溃 | 可从持久记录继续；重复 tick 不越过状态和删除权限边界 |

## 9. 数据迁移、兼容与 Cloudflare 处理

### 9.1 新部署与旧数据分开

新部署直接使用 PG + S3。旧预览环境可由部署者选择重建，但不能默认删除已有数据。需保留数据的实例走一次性维护窗口迁移，不做双写平台。

迁移顺序：

1. 停止新写入、设备 claim 与后台 cleanup；在途上传完成或显式收敛，保留未知执行结果。
2. 备份旧 SQLite/PG KV、对象目录/桶、加密根和部署配置；记录可恢复的完整源快照。
3. 用独立迁移工具读取旧 SQLite/PG KV，导入 PG 目标表；保留 owner、SK 身份、时间、幂等键和密文关联字段，不无理由旋转加密根。
4. 原来就在 S3 的对象绑定原 S3 backend。原 FS 对象先复制到目标 S3，逐对象计算并核对源/目标 SHA-256 与大小，再在切流前把对象引用绑定目标 S3 backend；既有 checksum 可辅助但不能替代实际内容校验。最终不得保留只有已删除 FS driver 才能解析的有效对象/会话/Context 引用。ETag 不通用等价于 MD5，不能跨后端直接比较。
5. 确认 ready、pending、deleted/待清理、share、call reservation、Mailbox queued/claimed/terminal 均有处理规则。数据库租约到期不证明设备从未执行；保留 result_unknown 与 journal barrier。
6. 重建派生搜索索引；停止写入期间对齐对象清单与数据库引用，再切入新服务。
7. 完成抽样下载、授权/分享撤销、恢复与清理检查后解除维护；旧卷保留到验收窗口结束。

SQLite reader 只属于一次性迁移工具，不作为服务运行依赖保留。未支持的旧 schema/version 必须在迁移预检中明确拒绝，不能部分导入后继续上线。

### 9.2 回滚边界

解除维护前可以整体恢复源快照并重启旧版本。新版本接受写入后，不能只切回旧镜像/旧 SQLite；需要对应版本迁移或停写恢复，并明确恢复点之后的数据处理。普通业务升级与对象后台搬迁应分别实施。

后续跨 S3 backend 搬迁也应先复制和校验，再改对象绑定；保持对象 id，暂停受影响上传/清理，不把“切换默认”顺带实现成自动迁移。

### 9.3 Cloudflare 删除清单

决定已经确定：新版只支持 self-hosted，不再研究 Workers 适配，也不保留维护中的旧版 CF 支持线。现有实现尚未删除；下列清单必须随实施一起落地。

| 范围 | 删除或迁移内容 |
| --- | --- |
| 宿主包 | 删除 `packages/gateway/` 的 Worker、D1、DO、KV/R2 binding、scheduled、Assets 与 Workers 测试；先迁出被 Node/Compose 使用的共享测试资产 |
| 模板与初始化 | 删除 `template/`、Deploy Button、`scripts/provision*`、`scripts/gen-dev-vars.mjs`、CLI `cloudflareInit` 和 CF init 子命令；以自托管安装替代默认初始化体验 |
| 插件部署 | 删除插件的 `wrangler.feishu.jsonc`、`deploy:feishu:cf` 与 Worker 托管说明；保留 Node/HTTP 插件能力 |
| 工具链与发布 | 删除 gateway 发布 workflow、release-plan/version-bump/pack 检查中的该包及 `cloudflare:` 豁免；移除 wrangler、workerd、Workers types/test pool 和无消费者依赖；同步 lockfile |
| 配置与文档 | 删除 CF 专属 env、wrangler 配置、README/网站部署入口及历史审计中的失效指导；更新 AGENTS/CLAUDE 发布包清单、llmdoc 架构/部署/存储/安全/发布知识 |
| 中立业务中的旧名称 | 将 Context/skillhub 的 `provider: 'r2'` 迁为中立存储绑定，转换已有记录、CLI/UI/help；保留默认桶、namespace 和旧对象访问语义 |
| 旧校验器 | `@cfworker/json-schema` 当前承担运行时校验；评估并验证 Node/MCP 标准校验器替换后再移除，不能删掉 schema 验证本身 |

`gateway/scripts/echo-mcp.ts`、`compose-smoke.ts`、`stub-provider.ts` 等仍被共享验证消费，先迁到中立测试目录再删包。`core/device`、Node deviceHub/Router、Mailbox 和设备 journal 保留；删除的是 DO 宿主实现。通用 S3 SDK/endpoint 能力保留，R2 binding、专用预设、账户引导和厂商支持说明删除。

文档随对应代码删除同步收敛：移除 `llmdoc/hosts-deploy/cloudflare-paths.mdx`，将仍包含 Node 设备契约的 DO 命名文档改名并保留有效内容；清理历史审计的 CF 专属内容，更新知识映射。不可在代码仍依赖旧实现时先删知识，制造虚假的“已迁移”状态。

删除范围是仓库当前受维护的代码、产物和文档，不重写 Git 历史、不撤回已发布 npm 版本，也不自动销毁任何云端资源。若存在 CF 部署，切换前由部署者导出数据并通过一次性迁移验收；需要的数据导入完成前不能宣称该实例迁移成功，不为此保留长期 CF 运行适配器。

## 10. 分阶段实施与停止条件

每阶段单独 PR、独立验收；并行调查可以进行，数据库/对象迁移与最终验证由同一 owner 串行执行。

| 阶段 | 交付 | 前置依赖 | 验收与停止条件 |
| --- | --- | --- | --- |
| P0：冻结方向与覆盖矩阵 | 本文、CF 删除清单、全部配置分类、迁移与恢复规则 | 无 | self-hosted 唯一目标；无 env-only 产品设置 |
| P1：验证关键替换 | AWS SDK + 本地 S3 契约原型；PG beginUpload/claim；无 PG setup 与部署执行器原型 | P0 | 条件写/流/事务符合语义；干净卷可打开受保护安装界面；不满足条件不放宽契约 |
| P2：唯一宿主与引导基础 | 删除 CF 专属宿主/工具/内容；PG 默认；SQLite → 现有 PG 状态的一次性迁移；SQLite 退役；bootstrap 与 config schema/API/CLI/UI 基础 | P1 | 迁移工具先于退役版本可用；无 CF/SQLite runtime；无 env 启动向导；已初始化 PG 故障不重开安装 |
| P3：领域存储 | PG KV → 领域表、索引/事务、backendId/active pointer、幂等与租约 | P2 | 配额竞争、领取/完成与故障恢复通过；数据/行为对拍 |
| P4：S3 默认与 FS 退役 | 内置 S3、官方 SDK、自定义 endpoint、FS → S3 工具、中立 Context 绑定 | P1 S3、P3 | 兼容矩阵与恢复通过；无部署级 FS/staging；设备 FS/journal 不误删 |
| P5：完整配置体验 | 覆盖全部产品配置；storage test/activate/rotate；重启、数据库迁移、keyring 轮换、受限部署应用与本机恢复 | P2–P4 | 三入口同权；每个配置有真实生效/失败恢复路径；旧对象稳定；无敏感值回显 |
| P6：发布级部署闭环 | 零 env 全新安装、旧 env 导入、备份恢复、升级、多副本 profile、手册 | P2–P5 | 干净卷重复安装；Dashboard 改端口/镜像等可验证生效；不只检查 YAML 可解析 |
| P7：后续减负 | OAuth/static、固定 API 生成、挂载规则、搜索/connector/包边界试点 | 可独立推进 | 每项证明净维护成本降低；搜索契约变化另决策 |

P1 原型可以放在可删除的实验目录，不能在通过上述条件前变成默认生产路径。默认对象服务尚未确定不会阻止文档、PG 与固定 API 调查，但会阻止 P4 的最终镜像选择。

## 11. 验收矩阵与发布要求

### 11.1 必须验证的场景

| 类别 | 代表场景 |
| --- | --- |
| 配置覆盖 | 6.5 每项具备界面/API/CLI、持久化、生效、失败恢复策略；无需要手填 env 的保留产品设置 |
| 首次安装 | 干净卷零 env；无 PG 可打开配对向导；并发安装/断电恢复；PG 故障不重开匿名 setup；重启不重新生成根 |
| 配置应用 | revision 冲突；热更新快照；多副本漏通知；重启失败恢复；端口重映射与镜像更新真实生效；执行器断线可诊断 |
| 专项维护 | 切库不接入错误实例；停写迁移及恢复；根轮换中断恢复；旧 token 策略；PG 完全不可达/根文件损坏时独立配对恢复；PG 角色密码真实轮换并验证新旧连接 |
| CF 退出 | 无受支持 CF 宿主/模板/命令/workflow/依赖残留；共享测试、中立 Context 与 Node 设备闭环仍通过 |
| PG 并发 | 同幂等键并发创建、配额临界并发、两消费者 claim、lease 过期/撤销、重复 completion、事务中断 |
| S3 等价 | 同 key 并发 create-only 仅一个成功；错误 ETag 拒绝；LIST 编码/分页；metadata；流断开、空对象、超限 |
| 存储切换 | A 上传中激活 B；A complete 与旧下载仍命中 A；新对象命中 B；既有 Context 不跟随切换；旧后端被引用时删除失败；两个管理员同时 activate；验证后凭证不能被旁路改写 |
| 安全 | ordinary SK 不能配置存储；authRef 不越权；凭证不回显；受限内网 origin；redirect/DNS 策略；share revoke 即时生效 |
| 浏览器/设备 | relay 可用；直传 CORS/大小/create-only 真请求；签名 URL 不进日志；neutral SDK 无 Node/PG/S3 SDK 泄漏 |
| 部署与恢复 | 干净 Compose 安装、PG/S3 重启、应用重建、备份恢复、错误配置、schema migration 失败、单机与多副本行为 |
| 兼容 | HTBP Help → 原 path 调用闭环，MCP era 不回退，CLI 参数严格，Store URI 稳定，旧包消费者得到明确迁移指引 |

后端契约先在本地容器验证；真实 S3/生产网关/真实上游每轮最多一次且留证据，未经明确授权不创建资源或写真实桶。对外报告区分静态审查、模拟测试、本地容器与真实服务结果。

### 11.2 工程闸门

- 实施 PR 必须通过 `pnpm verify`；改 public 包、依赖或打包配置还必须通过 `pnpm turbo run build`。
- typecheck/单测通过不能替代 SQL/S3 wire 与 Docker Compose 故障恢复验收。缓存命中与跳过项必须说明。
- 迁移规模与优化效果通过查询计划、查询次数、真实样本、延迟和净 diff 判断，不预先声称删除某个百分比代码。
- 每个可发布包按自身契约/依赖/产物 ownership bump。移除 Cloudflare/SQLite、改为安装向导与持久配置、改变 SDK 注入面和存储配置行为属于 0.x minor 变化；不能统称 patch 修复。
- 按仓库流程重建并验证新版本进入产物，PR 合入 main 后才打 tag，一次推一个，发布后复查 registry。文档本身不触发 public 包 bump 或发布。
- 每阶段同步相应 llmdoc 当前事实；本文只在实际验收后更新实施状态，不能提前把目标写成现状。

## 12. 下一步可直接开始的工作包

- [ ] A：先做受保护的无 PG 安装向导与配置 schema 原型，自动初始化默认凭证；打通 Dashboard → 受限安装器 → 端口重映射的实际执行和状态反馈。
- [ ] B：按 9.3 删除 CF 清单逐项确认消费者，先迁共享测试与中立存储绑定，再删除宿主/工具/历史内容。
- [ ] C：验证 AWS SDK + SeaweedFS 的 ObjectStore 契约；以现有 postgres 驱动验证 `beginUpload`/`claimNext`，比较直接 SQL 与 Drizzle 的收益。
- [ ] D：完成 SQLite 迁移工具、PG 外 bootstrap/恢复格式和完整配置覆盖矩阵，迁移工具先于退役版本可用。
- [ ] E：落实 backendId、SecretStore credential generation、配置 revision 和 keyring；按三入口契约交付完整设置页，逐项验证热更新、重启与维护操作。

首轮优先 A/B/C。存储身份未落地前不开放后端切换；部署执行与恢复未验证前，不把“表单能保存”当成配置功能完成。

## 13. 实施状态与边界

本轮实现和验收记录见 [self-hosted-refactor-validation.md](./self-hosted-refactor-validation.md)。原第 9 节旧数据迁移与第 10 节逐阶段迁移工具要求已被本轮“不保留旧数据、不维护兼容”的决定取代；新的 PG→PG 维护与默认 Compose 快照恢复仍作为运维能力保留。

后续项包括固定 API 生成、搜索/connector 选型试验、S3 direct/multipart 与对象后端自动搬迁。本轮没有放宽联邦搜索快照、权限、设备未知结果或幂等契约，也没有声称已部署 Railway 或完成 npm 发布。

当前契约：[整体架构](../llmdoc/architecture.mdx)、[Node 部署](../llmdoc/hosts-deploy/node-docker-and-helm.mdx)、[Default Store](../llmdoc/store/default-store.mdx)、[Mailbox](../llmdoc/device/durable-mailbox.mdx)、[安全边界](../llmdoc/protocol/security-boundaries.mdx)。
