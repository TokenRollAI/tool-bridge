# 项目简报

## 是什么

tool-bridge 把工具、上下文、设备与远端服务组织成一棵受权限约束的 HTBP 树。调用方通过统一的 `~help`、`~tree`、`~search` 发现能力,并以唯一形态 `POST /<nodePath>/<command>`(body 即 arguments 本体,无信封)调用;命令是节点下的虚拟叶子。标识符大小写不敏感、规范化为小写。CLI、Dashboard 与直接 API 是同一控制面的三个入口。

项目当前处于 pre-launch 开发期，尚无正式生产环境。共享或临时部署只用于验证，不能写成“产品已上线”，也不能把其中的域名、账户、资源 ID 或测试凭据固化进长期文档。

## 核心原则

- 代码与生成产物是行为真源；llmdoc 解释当前边界和可复用流程。
- deny 优先，权限不足对不可见路径返回 404；密钥值不进入节点记录、日志或只读管理响应。
- 宿主中立业务集中在 `@tool-bridge/app`；Cloudflare、Node 与 SDK 只装配运行时适配器。
- 内置插件由编译期 catalog 描述并直接挂载；外部 HTTP(S) plugin 与宿主显式装配的自定义 binding 才进入运行时注册表。
- 新增管理能力必须同轮核对 API、`tb` 子命令和 Dashboard，避免管理旁路。
- 派生索引、缓存和健康状态不是权威数据；读路径不得偷偷修写权威状态。
- 项目自己的旧预览状态不作为兼容目标；外部协议互操作、安全下界和真实上游差异仍须保留。

## 技术选型

| 需求 | 选型 | 约束 |
|---|---|---|
| HTTP 路由 | Hono | 路由与中间件集中在 app，不手写另一套路由器 |
| 输入校验 | Zod / 既有 core validator | 不以类型断言代替运行时校验 |
| CLI | Commander | 全局参数、错误通道和严格解析保持统一 |
| S3/R2 签名 | aws4fetch | 不手写签名协议 |
| Cloudflare CLI | Wrangler | 资源创建与部署经现有 provision/deploy 流程 |
| Node 状态 | better-sqlite3 / postgres.js | SQLite 为默认权威 StateStore；设 `TB_DATABASE_URL` 则改用 PostgreSQL，切换不迁移既有数据 |
| 测试 | Vitest + Node test | 宿主专属行为才进入重型运行时测试 |
| Monorepo | pnpm + Turborepo | 根验收命令是 `pnpm verify` |

表外基础设施先调研成熟库；确无合适方案时才自研，并把理由写入对应架构文档。

## 非目标

- 不在 llmdoc 维护发布流水、测试计数、源码行数或当前 npm latest。
- 不为尚未实现的 marketplace、设备宿主注入等概念预先承诺公共 API。
- 不把 Cloudflare 适配细节泄漏到 core/app 的通用契约。
- 不通过保留隐藏 flag、旧字段 fallback 或旧 KV 快照来延长 pre-launch 内部兼容。
