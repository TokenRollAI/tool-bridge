# 自托管重构验收记录

日期：2026-09-05。范围：本轮实现与 PR；尚未合并、部署 Railway 或发布 npm。

## 工程检查

| 检查 | 结果 |
| --- | --- |
| `pnpm verify` | 通过：全仓 typecheck、ESLint、全部测试，无 skipped/todo。最后一轮复用已通过的 Turbo 缓存；Server 112 项与根脚本实际重新执行。 |
| `pnpm turbo run build` | 6 个构建任务全部通过，该轮无缓存命中；包括 neutral JS/DTS、Dashboard 预压缩和服务端产物。 |
| 六个 public 包 `pack-and-verify-package --skip-install` | 全部通过 tarball manifest、协议/依赖与入口检查。由于本轮 workspace 版本尚未发布，单包 registry 安装留给合并后的发布流程。 |
| 仓库外联合安装 | 六个被审阅的 tarball 在全新临时项目中联合 npm 安装成功；所有库/neutral 入口可 import，CLI、Server、admin 的版本与 help 命令通过。 |
| 产物内版本 | app 0.21.0、CLI 0.31.0、Dashboard 0.28.0、SDK 0.23.0、Server/admin 0.22.0 已从重建入口或产物验证。plugin-sdk 无自身契约改动，不机械 bump。 |
| Docker 镜像 | 从干净构建上下文成功构建，使用 Node 22 slim 与官方 PostgreSQL 18 客户端。 |
| Helm/Compose | Helm lint、双形态渲染以及零环境变量 Compose 解析通过。 |

## 实服务验证

所有下列数据验证均使用本地隔离环境，没有读取或写入现有 Railway 数据。

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

## 发布与保留边界

这是破坏性的 0.x minor 变更：删除 Cloudflare/SQLite/部署级 FS、旧环境变量覆盖和 `r2` provider 形状；SDK Store/Mailbox 通过显式领域依赖装配。根据本轮使用方决定，不迁移旧实例数据或保留旧运行时兼容。

Railway 平台设置继续使用其 CLI；Dashboard 的部署执行器只控制明确选定的本机 Compose。标准 S3 驱动默认 relay，不承诺直传、multipart 或后端自动搬迁。物理快照只支持默认五卷布局、相同镜像及明确隔离的恢复目标；外部数据库/桶需要各自的备份流程。

合并后再按仓库发布规则逐包发布；本 PR 不提前创建生产 tag。
