# 项目概览

## 用户模型

tool-bridge 将异构能力投影为带路径的树：目录负责组织，工具节点负责调用，上下文节点负责内容，设备节点承载反向连接，remote 节点联邦另一棵 HTBP 树。调用方先发现、再按同一权限模型访问。

主要入口：

- HTTP：`~help`、`~tree`、`~search`、节点调用与管理 builtin。
- CLI：`tb` 对常用数据面和管理面提供脚本友好的命令。
- Dashboard：消费同一 API，提供树、搜索、插件、集成和系统管理界面。
- MCP：`/~mcp` 将可见工具投影给 MCP 客户端。

## 能力面

- 树与权限：路径级 read/write/call/register/admin，deny 优先，可见性裁剪。
- Provider：MCP、HTTP、plugin tools/context、本地 SDK provider、R2/S3 context。
- 集成：编译期内置 catalog 与显式外部 plugin 注册。
- Search：从权威节点/工具描述派生索引，再按请求身份 hydrate 和裁剪。
- 设备：CLI/SDK 反向连接，将本地工具、文件或自定义节点挂到远端树。
- 运维：SK、SecretStore、registry、status、catalog、federation、annotation。

## 部署形态

| 形态 | 入口 | 适配器 |
|---|---|---|
| Cloudflare Workers | `packages/gateway/src/deployEntry.ts` | KV、R2、D1、Durable Objects、Static Assets |
| Node / Docker | `packages/server` | SQLite、文件对象存储、ws、静态 Dashboard |
| 嵌入式 SDK | `packages/sdk` | 调用方注入 StateStore、ObjectStore、SecretStore 与本地 provider |
| 应用层库 | `packages/app` | 不绑定具体运行时，由宿主注入依赖 |

三种宿主共享 app/core 的行为，但存储一致性、设备会话持久性和静态资源托管存在明确适配差异；详见 modules 与各宿主 guide。
