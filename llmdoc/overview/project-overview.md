# 项目总览

> 用途:理解 tool-bridge 的产品形态、模块全景与部署形态的入口文档;比 [../must/project-brief.md](../must/project-brief.md) 更展开,比 [../architecture/modules-and-boundaries.md](../architecture/modules-and-boundaries.md) 更浅。更新时机:产品定位或模块划分变化时。

## 要解决的五个痛点(docs/Vision.md:7-13)

1. **工具接入受限于运行环境**:边缘函数/浏览器/受限 sandbox 等 Agent 环境跑不了 MCP client。
2. **上下文碎片化**:知识散落 R2/S3、文件系统、飞书、内部系统,无统一读写检索面。
3. **机器能力够不着**:内网服务器的 shell 与 fs 对云上 Agent 不可见。
4. **发现即文档**:每接一个工具写一份说明,说明与实现漂移。
5. **权限缺失**:key 要么全能要么不能,缺少"只能读 `docs/`、只能调 `search/`"的表达。

## 核心主张(docs/Vision.md:35-44)

一棵树一个入口 / 自描述(每级 `~help`)/ 上游开放供给 / Context 统一读写面 / 设备反向注册 / SK 即权限 / 廉价云上运行(CF)+ 易拓展(SDK+Plugin)。

**非目标**(docs/Vision.md:114-119):不做 Agent Runtime(那是 Watt 等上层职责)、不做事件总线、不做模型托管计量、初期不做多云抽象(仅 CF + Docker 两条路径)。

## 模块总览 M1-M10(docs/Architecture.md)

| # | 模块 | 一句话职责 |
|---|---|---|
| M1 | HTBP Tree(核心) | 节点注册表、路由、`~help`/`~skill`/`~tree`、内容协商、调用分发 |
| M2 | Tool Layer | mcp/http/builtin ToolProvider 聚合与调用代理 |
| M3 | Context Layer | 多来源上下文统一读写检索面(四动词 + Search) |
| M4 | Device Gateway | 设备 WebSocket 反向注册 + 调用转发 |
| M5 | Auth(横切) | SK 签发/作用域/访问判定(`Authorizer.Check` 唯一入口) |
| M6 | SDK | 内嵌 TB Server / 程序化注册 / 反向连接 |
| M7 | CLI | 纯 API 客户端 `tb`,子命令一一映射 Proto 接口 |
| M8 | Plugin System | 自定义 Provider 注册与生命周期 |
| M9 | Dashboard | `~help` 通用渲染器 + 管理表单(无专用后端) |
| M10 | Server/部署 | CF 与 Docker 两条部署路径产出同一棵树 |

职责边界、依赖方向与 Phase 映射详见 [../architecture/modules-and-boundaries.md](../architecture/modules-and-boundaries.md)。

## 部署形态(docs/Architecture.md:257-266,docs/Reference.md §4/§6)

- **Cloudflare(默认宿主)**:单 Worker `tb-gateway`(Hono 路由,API + Dashboard 静态资源一体,Dashboard 挂 `/ui`);KV `tb-state`(树配置/SK 哈希/manifest);R2 `tb-context`(context + 大对象);每设备一个 Durable Object `DeviceSession`(WS hibernation);D1 `tb-audit` 后期可选。云上资源统一 `tb-` 前缀(`TB_NAME_PREFIX` 派生,docs/Architecture.md:284)。
- **Docker(自部署)**:单镜像 `node:22-slim`,core + @hono/node-server + SQLite + FS,`/data` 卷持久化。
- 两条路径的差异全部收敛在四个宿主注入点 StateStore/ObjectStore/SecretStore/DeviceTransport(docs/Proto.md:522),业务代码零分叉。

## 三入口对等原则

Agent(直接 HTTP)、CLI(`tb`)、Dashboard 三个入口对同一棵树的操作行为一致(DOD.md P6-5、E2E-2/E2E-6 逐条验收)。CLI 做不到而 Dashboard/API 做得到 = "管理旁路" = 缺陷(DOD.md:17);Dashboard 无专用后端,只渲染 `~help`(docs/Architecture.md:249-253)。
