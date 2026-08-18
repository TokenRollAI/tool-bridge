# 项目概览

## 用户模型

tool-bridge 将异构能力投影为带路径的树：目录负责组织，工具节点负责调用，上下文节点负责内容，设备节点承载反向连接，remote 节点联邦另一棵 HTBP 树。调用方先发现、再按同一权限模型访问。

主要入口：

- HTTP：`~help`、`~tree`、`~describe`、可选的 `~search`、节点调用与管理 builtin。
- CLI：`tb` 对常用数据面和管理面提供脚本友好的命令。
- Dashboard：消费同一 API，提供树、搜索、插件、集成和系统管理界面。
- MCP：`/~mcp` 将可见工具投影给 MCP 客户端。

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

产品首页和面向用户的公开文档由独立仓库 `TokenRollAI/tool-bridge-site` 维护；本仓库继续拥有实现、发布产物与面向开发 agent 的 llmdoc。不要把 llmdoc 整体复制到公共站点，它包含工程工作流、内部边界和会随实现收敛的维护知识。

公共站点按“开始使用 → 核心概念 → 部署 → 接入能力 → 使用与治理 → 参考排障”组织任务型页面。每篇操作指南应交代适用边界、前置权限、可复制步骤、成功证据、安全与 SecretStore、常见失败、回滚和下一步；参考页负责把读者送回任务流，而不是成为孤立终点。

公共站点解释稳定的产品模型、上手路径和部署方式，不维护某个实例动态生成的完整工具目录。动态事实要区分入口：`~tree` 是当前可见树；Provider 节点级 `~help` 是工具索引，工具级 `~help` 才给完整 schema；`~describe` 是 Search/Context capability 真源；`~search` 只在宿主装配后存在。发生差异时，真源优先级是：目标实例在当前身份下返回的运行时描述、对应版本的代码与发布说明、公共教程。用户可感知的契约或部署入口变化要同轮评估是否更新公共文档。

站点仓库的 `pnpm verify` 同时检查格式、Astro 类型与内容、生产构建和构建产物站内链接。验证通过后由 `main` 自动发布到 Cloudflare Pages，PR 使用预览部署。Cloudflare account、API token、项目和域名绑定由平台侧配置，不回填到本仓库或公共站点源码。
