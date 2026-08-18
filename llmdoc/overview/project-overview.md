# 项目概览

## 用户模型

tool-bridge 将异构能力投影为带路径的树：目录负责组织，工具节点负责调用，上下文节点负责内容，设备节点承载反向连接，remote 节点联邦另一棵 HTBP 树。调用方先发现、再按同一权限模型访问。

主要入口：

- HTTP：`~help`、`~tree`、`~describe`、可选的 `~search`、节点调用与管理 builtin。
- CLI：`tb` 对常用数据面和管理面提供脚本友好的命令。
- Dashboard：消费同一 API，提供树、搜索、插件、集成和系统管理界面。
- MCP：`/~mcp` 将可见工具投影给 MCP 客户端。
- Agent Skill：独立仓库 `TokenRollAI/tool-bridge-skill` 教 Agent 经 `tb` 做运行时发现、调用与 feedback 闭环；不静态复制实例工具目录。

## 能力面

- 树与权限：路径级 read/write/call/register/admin，deny 优先，可见性裁剪。
- Provider：MCP、HTTP、plugin tools/context、本地 SDK provider、R2/S3 context。
- 集成：编译期内置 catalog 与显式外部 plugin 注册。
- Search：从权威节点/工具描述派生索引，再按请求身份 hydrate 和裁剪。
- Feedback：使用经验附着在具体节点或工具路径；高分条目进入 `~help` 与 Search 投影，CLI 与 Dashboard 均可读写和投票。
- 设备：CLI/SDK 反向连接，将本地工具、文件或自定义节点挂到远端树。
- 运维：SK、SecretStore、registry、status、catalog、federation、annotation。

## 部署形态

| 形态 | 入口 | 适配器 |
|---|---|---|
| Cloudflare Deploy Button 模板 | `template/src/index.ts` | KV、R2、Durable Objects、Static Assets；不含 D1 Search |
| Cloudflare Workers | `packages/gateway/src/deployEntry.ts` | KV、R2、D1、Durable Objects、Static Assets |
| Node / Docker | `packages/server` | SQLite、文件对象存储、ws、静态 Dashboard |
| 嵌入式 SDK | `packages/sdk` | Node 22+；调用方注入 StateStore、ObjectStore、SecretStore 与本地 provider；当前不提供 SearchIndex 注入 |
| 应用层库 | `packages/app` | 不绑定具体运行时，由宿主注入依赖 |

宿主共享 app/core 的行为，但存储一致性、设备会话持久性、Search 和静态资源托管存在明确适配差异。Deploy Button 是轻量模板，不能写成与完整源码 gateway 等价；详见 modules 与各宿主 guide。

## 公共文档边界

产品首页和面向用户的公开文档由独立仓库 `TokenRollAI/tool-bridge-site` 维护，已通过 Cloudflare Pages 上线；正式入口是 [toolbridge.tokenroll.ai](https://toolbridge.tokenroll.ai/)，文档从 [/docs/](https://toolbridge.tokenroll.ai/docs/) 进入。本仓库继续拥有实现、发布产物与面向开发 agent 的 llmdoc。不要把 llmdoc 整体复制到公共站点，它包含工程工作流、内部边界和会随实现收敛的维护知识。

Agent 使用入口由独立仓库 [`TokenRollAI/tool-bridge-skill`](https://github.com/TokenRollAI/tool-bridge-skill) 维护，可用 `npx skills add TokenRollAI/tool-bridge-skill` 安装。Skill 只固化 Agent 的发现、schema 下钻、安全调用和 feedback 消费/贡献流程；目标实例的 URL、SK、动态工具清单和运行结果不进入仓库。维护与验收见 [Agent Skill 接入与验收](../guides/agent-skill-integration.md)。

公共站点按“开始使用 → 核心概念 → 部署 → 接入能力 → 使用与治理 → 参考排障”组织任务型页面。每篇操作指南应交代适用边界、前置权限、可复制步骤、成功证据、安全与 SecretStore、常见失败、回滚和下一步；参考页负责把读者送回任务流，而不是成为孤立终点。

公共站点解释稳定的产品模型、上手路径和部署方式，不维护某个实例动态生成的完整工具目录。动态事实要区分入口：`~tree` 是当前可见树；Provider 节点级 `~help` 是工具索引，工具级 `~help` 才给完整 schema；`~describe` 是 Search/Context capability 真源；`~search` 只在宿主装配后存在。发生差异时，真源优先级是：目标实例在当前身份下返回的运行时描述、对应版本的代码与发布说明、公共教程。用户可感知的契约或部署入口变化要同轮评估是否更新公共文档。

站点仓库的 `pnpm verify` 同时检查格式、Astro 类型与内容、生产构建和构建产物站内链接。站点使用 Cloudflare Pages Git Integration：`main` 构建生产站点，其他分支与 PR 使用预览部署；Git 连接、构建和上传由 Cloudflare 管理，不要求在 GitHub Actions 中保存 Cloudflare API token。发布验收以 Pages 构建结果、生产 URL 和对应预览 URL 为准。

公共文档当前是 Starlight 静态多页站点：切换页面会读取新的 HTML，哈希 `_astro` 资产长期缓存，Starlight 默认在 hover 后预取站内链接。遇到“文档切页慢”时，先用 canonical 自定义域名区分 HTML TTFB、渲染时间和资产缓存；不要只按页面内容量猜测，也不要重复开启已经存在的 hover prefetch。短 HTML TTL、更激进的预取或 ClientRouter 都属于有陈旧窗口、带宽或兼容性取舍的后续优化。
