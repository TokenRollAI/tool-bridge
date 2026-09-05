# 自托管重构验收记录

日期：2026-09-05。范围：本轮实现、PR 与追加授权的 Railway 部署；尚未合并或发布 npm。

## 工程检查

| 检查 | 结果 |
| --- | --- |
| `pnpm verify` | 通过：全仓 typecheck、ESLint、全部测试，无 skipped/todo。review 修复最后一轮 Server 138 项与根脚本实际重新执行，其余复用已通过的 Turbo 缓存；CLI 共 398 项。 |
| `pnpm turbo run build` | 6 个构建任务全部通过；review 修改的 CLI/Server 实际重建，其余 4 项复用缓存。最初架构重构已另跑过无缓存全构建。 |
| 六个 public 包 `pack-and-verify-package --skip-install` | 全部通过 tarball manifest、协议/依赖与入口检查。由于本轮 workspace 版本尚未发布，单包 registry 安装留给合并后的发布流程。 |
| 仓库外联合安装 | 六个被审阅的 tarball 在全新临时项目中联合 npm 安装成功；所有库/neutral 入口可 import，CLI、Server、admin 的版本与 help 命令通过。 |
| 产物内版本 | app 0.21.0、CLI 0.31.0、Dashboard 0.28.0、SDK 0.23.0、Server/admin 0.22.0 已从重建入口或产物验证。plugin-sdk 无自身契约改动，不机械 bump。 |
| Docker 镜像 | 从干净构建上下文成功构建，使用 Node 22 slim 与官方 PostgreSQL 18 客户端。 |
| Helm/Compose | Helm lint、双形态渲染以及零环境变量 Compose 解析通过。 |

## 本地实服务验证

本节数据验证均使用本地隔离环境，没有读取或写入现有 Railway 数据。

- PostgreSQL：同幂等键竞争、配额临界竞争、事务中断回滚、双消费者领取、旧租约拒绝、重复完成与未知执行结果。
- S3：实际 SeaweedFS 条件写、并发 create-only 仅一胜、错误 ETag 拒绝、LIST 分页与特殊 key、空对象、流式限额、请求中断与重启持久化。
- 存储身份：切换默认后端时旧 session/对象仍保留原后端；Context 引用与后端删除通过外键和同一事务防止竞争。
- 配置与安全：expected revision 冲突、回调失败恢复实际配置、慢同步不覆盖新值、普通 SK 和别名节点无法越过 canonical 管理权限。
- 安装与密钥：无 PG 的受保护安装入口、配对过期/并发、安装中断恢复、已初始化故障不重开安装、重加密任务中断续跑、旧签名保留及显式撤销。
- 数据库维护：官方 `pg_dump`/`pg_restore` 实际复制数据与实例身份；空库/错误身份预检；独立数据库管理员执行登录角色轮换，新连接可读、旧登录被拒绝。
- Redis/设备：真实跨副本 WebSocket 路由、在线设备回收保护，以及 SDK 的 HTTP→WebSocket 全链路。
- 浏览器：实际配对安装，设置、存储、维护和密钥页面；真实 HTTP 配置保存/应用、S3 能力探测；页面无横向溢出，敏感字段保持隐藏。
- Compose 执行器：宿主端口、实际镜像、数据目录、UI 目录均完成实际重建；占用目标端口时恢复原 Compose 和服务，生效 revision 不前进。

默认五卷快照的冷恢复已在全新隔离项目通过：保留实例身份、原管理员凭证和 registry 节点，恢复后的完整 HTTP 对象下载与源 SHA-256 一致。实测发现 S3 开始监听、HEAD 成功不等于数据卷已注册，因此恢复脚本的完成门禁已经增加实际对象数据读取，不能仅凭 `/healthz` 报告成功。

## Review 回归

review 的六项问题全部复现并修复：

| 问题 | 修复和验证 |
| --- | --- |
| 数据库迁移分叉 | 检查所有其他副本登记，复制/退役/失败目标保留持久屏障；真实 PG 覆盖导出后的同一行更新、过期登记、锁连接被终止、恢复/提交确认丢失以及新副本注册竞争。 |
| 管理路径自等待 | 使用实际异步请求上下文，仅排除维护调用自身；真实可执行进程验证百分号编码、大小写和别名路径，其他在途写仍须完成。 |
| 中断安装恢复空库 | recovery 授权以 initialized 标记为准；同一故障状态修复前空库恢复 200、修复后 409，且不改变原密钥或创建目标实例表。 |
| status 与换钥并发 | 状态快照和任务修复也取得独占锁；真实 PG 定序回归不再产生反向旧 key 任务，保留崩溃后任务恢复能力。锁竞争返回 conflict。 |
| 关停设置未生效 | 真实 SIGTERM 验证已应用 2 秒窗口生效、未应用的 10 秒不生效，窗口内业务继续服务；并发维护重载后最后一个 runtime 也被正常关闭。 |
| 清除 UI 仍残留挂载 | 移除固定 UI 目标挂载，并核对实际容器；真实 Compose 验证镜像 HTML 恢复，以及继承 bind/named volume 残留时拒绝成功回执并回滚。 |

独立复核进一步补充了真实慢 HTTP 流验证：请求要保持到正文完成、取消清理或错误，不能在返回响应头时就退出排空计数。测试覆盖背压、取消和异常，避免维护截断 S3 下载。全仓验证还暴露旧夹具先删库后关闭服务的问题，已按逆序释放修正；没有吞掉生产租约错误来让测试变绿。

共享 CI runner 曾出现原有 Dashboard 表单用例的 5 秒超时；原样用例本地 76ms、全套 162 项通过。保留原测试、交互断言和超时，只在 CI 限制 Turbo 包级并行，避免多个已经自行并行的 Vitest 进程池叠加争抢资源。

明确取舍：过期登记不代表旧进程已经排空，PostgreSQL reserved 连接重连也不代表仍持有原 advisory lock。崩溃遗留的副本登记、持久维护屏障或无法确认的迁移结果需要离线确认与恢复；不能通过 TTL 自动恢复旧库写入。完整修复保留在本 PR 尚未发布的 CLI 0.31.0、Server 0.22.0 中。

## Railway 部署验收

PR #132 的源码 `8cd8dfc` 已经由 Railway 重新构建并部署至 [Dashboard](https://tb.pdjjq.org/ui/)，GitHub CI 的 verify（包括构建与六个发布包检查）和 deploy-artifacts 均通过。部署使用既有 PostgreSQL 服务中的独立新库及非 superuser 应用角色，新建 bootstrap 卷与私网 SeaweedFS 服务/持久卷；未执行旧数据迁移。

review 修复版 `de844e1` 随后部署到同一应用服务，没有重新初始化数据库、bootstrap 或 S3。一次只读线上验收确认同一 instanceId、原 Admin Key 与本地 CLI 认证成功，配置仍为 applied、原 active backend 验证状态正常，`/readyz` 通过；容器内也确认加载了新关停入口，密钥文件仍为 UID 1000/0600。并发换钥和迁移故障测试仅在本地隔离环境执行，没有对生产做这些破坏性操作。

- `/healthz` 报告 Server 0.22.0，setup 为 ready，`/readyz` 的 PG 与 S3 检查通过；Dashboard 产物版本 0.28.0。
- canonicalOrigin 与实际公网 HTTPS 域名一致，期望/生效配置 revision 一致，只有一个经过能力检查的 active S3 后端；匿名管理请求被拒绝。
- PID 1 为 UID 1000 的 Node；`/data` 与 `/data/bootstrap` 权限 0700，bootstrap 文件均为 UID 1000、0600。管理员凭据安全保存于本机受保护文件，没有写入提交或服务日志。
- 通过 public SDK 上传 262144 字节对象并完整下载。重启应用与 S3 后，实例身份、原管理员凭据、配置和后端不变，再次完整下载的 SHA-256 仍为 `3a5fbaeb748163a6d4f19ebde8f34f0f0ff3737f48a5f0ea8787edeaed9fccc5`，随后删除验收对象。

部署期间发现并修正两项配置问题：Railway 的 root 挂载需要同时赋予应用用户 bootstrap **父目录**写权限，以创建旁置锁；SeaweedFS 逻辑卷上限不能按物理卷 GB 数设成 4，否则内部元数据会耗尽槽位，导致业务桶写入失败。安装能力门禁确实拦截了失败，修正后沿用同一实例身份完成安装，移除了未启用的失败探测记录。此次是一次线上交付验收，失败准备步骤与最终成功结果均保留在本机脱敏证据中。

## 发布与保留边界

这是破坏性的 0.x minor 变更：删除 Cloudflare/SQLite/部署级 FS、旧环境变量覆盖和 `r2` provider 形状；SDK Store/Mailbox 通过显式领域依赖装配。根据本轮使用方决定，不迁移旧实例数据或保留旧运行时兼容。

Railway 平台设置继续使用其 CLI；Dashboard 的部署执行器只控制明确选定的本机 Compose。标准 S3 驱动默认 relay，不承诺直传、multipart 或后端自动搬迁。物理快照只支持默认五卷布局、相同镜像及明确隔离的恢复目标；外部数据库/桶需要各自的备份流程。

合并后再按仓库发布规则逐包发布；本 PR 不提前创建生产 tag。
