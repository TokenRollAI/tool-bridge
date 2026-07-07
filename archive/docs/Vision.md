# Vision

> tool-bridge 是一个**自描述、可反向注册、协议开放的工具与上下文网关**。它让任何"会 HTTP fetch"的 Agent,凭一个 Secret Key + 一个 BaseURL,发现并使用一个组织的全部工具、上下文与设备。

## 1. 我们要解决的问题

今天想让 Agent 用上"组织里已有的能力"(工具、文档、机器),必须逐个打通:

1. **工具接入受限于运行环境**:MCP 生态丰富,但很多 Agent 运行环境(边缘函数、浏览器、受限 sandbox、只会 fetch 的极简 harness)跑不了 MCP client。
2. **上下文碎片化**:知识散落在 R2/S3、文件系统、飞书文档、内部系统里,Agent 没有统一的读写与检索面。
3. **机器能力够不着**:一台内网服务器上的 shell 与文件系统,对云上的 Agent 完全不可见——没有安全、统一的"把设备接进来"的方式。
4. **发现即文档**:每接一个工具就要为 Agent 写一份使用说明;说明和实现总是漂移。
5. **权限缺失**:一把 key 要么全能、要么不能;"这个 Agent 只能读 `docs/` 下的 context、只能调 `search/` 下的工具"没有现成表达。

## 2. tool-bridge 是什么

tool-bridge = **一棵自描述的 HTBP 树** + 围绕它的注册、鉴权、SDK 与管理面:

```
┌──────────────────────────────────────────────────────┐
│  任意 Agent / CLI / Dashboard(只需 SK + BaseURL)      │  ← GET /~help 渐进发现
├──────────────────────────────────────────────────────┤
│                    tool-bridge                        │
│   HTBP Tree · Tool Layer · Context Layer              │
│   Device Gateway(反向注册) · Auth(SK 作用域)          │
├──────────────────────────────────────────────────────┤
│  上游:MCP server(Streamable HTTP) · HTTP API         │
│  来源:R2 / S3 / File / 飞书 / 自定义 Provider          │
│  设备:任何跑得动 CLI/SDK 的机器(WebSocket 反向接入)    │
└──────────────────────────────────────────────────────┘
```

### 2.1 核心主张

| 主张 | 含义 |
|---|---|
| **一棵树,一个入口** | 工具、Context、设备全部是同一棵 HTBP 树上的节点;Agent 只需要一个 HTTP 入口,从根 `~help` 渐进发现一切 |
| **自描述** | 树上每一级路径(`a/b/c` 的 `a`、`a/b`、`a/b/c`)都提供 `~help`;`~help` 即文档、即契约、即权限裁剪后的可见面 |
| **上游开放供给** | 工具来源 = MCP(Streamable HTTP)、任意 HTTP API、内置能力、**任意 HTBP 服务(remote 联邦,"Add TB Server")**;Context 来源 = R2、S3、FileSystem、飞书、任意自定义 Provider |
| **Context 统一读写面** | 每个 Context 来源实现 `List / Get / Update / Write`(+ 可选 `Search`,关键词与语义两种模式),挂载为树上一个 namespace 节点 |
| **设备反向注册** | 内网/本地机器用 CLI+SK 主动建立 WebSocket,把自己的 shell(工具)与 fs(Context)挂上树——云上 Agent 从此够得着任何机器 |
| **SK 即权限** | 每个 Secret Key 有明确作用域:哪个 User/Agent、能对哪些路径做 R/W/Call/Register;`~help`/`List` 按 SK 裁剪,无权节点不可见 |
| **廉价的云上运行** | 默认 Cloudflare(Workers + DO + KV + R2):空闲近零成本、WS hibernation、零出口费;同一套核心亦可 Docker 自部署 |
| **易于拓展** | 从第一天就支持 SDK(嵌入式运行 TB Server、程序化注册)与 Plugin(自定义 Tool/Context Provider) |

### 2.2 设计原则

1. **参考 HTBP 协议构建**:控制面(`~help` / `~skill` / `~tree` / `~register`)+ 数据面(节点调用)遵循 HTBP;tool-bridge 就是 HTBP 的参考实现。
2. **不手造轮子**:优先使用现代成熟框架(Hono、官方 MCP SDK、zod、DO WebSocket hibernation……);没有现成方案时先调研再动手(选型清单见 LOOP.md)。
3. **接口优先**:ToolProvider(List/Get/Call)、ContextProvider(List/Get/Update/Write + 可选 Search)是纯接口;内置实现与 Plugin 地位对等。
4. **默认 markdown**:除 `~help`(遵循 HTBP,固定为 `text/plain` Help DSL)外,一切返回默认 `text/markdown`(面向 LLM 可读);只有调用方显式声明 `application/json` 时才返回 JSON(与 TB.md 注意 6 的对账见 Proto §1.2)。
5. **可见性即权限**:`~help`/`~tree`/`List` 按调用者 SK 裁剪;无权限的子树对该调用者根本不存在。
6. **每级可发现**:注册路径为 `a/b/c` 时,`a`、`a/b`、`a/b/c` 三级都必须响应 `~help`;`/~tree?depth=N` 提供受限深度的整树视图。

## 3. User Cases(验收基准)

以下七个场景来自 TB.md 的原始设计,是 tool-bridge 架构必须完整覆盖的验收基准。每个 Case 标注了所依赖的模块(详见 [Architecture.md](./Architecture.md))。

### Case 1:Admin 初始化

1. 用户本地使用 CLI 一键部署一个跑在 Cloudflare 上的实例(`tb init`)。
2. 部署过程自动产生一个 **Admin Secret Key**。
3. 用户使用 Admin SK 登录(`tb login`),查看当前系统运行状态(`tb status`)。

覆盖模块:CLI、Server(部署)、Auth(SK 引导)。

### Case 2:添加 Context

1. 用户登录 Dashboard(或用 CLI)。
2. 填写来源配置:AK、SK、bucket、Description……
3. 挂载为一个 namespace;此后 **CLI / Agent / Dashboard 三个入口都能查看与使用**这个 Context。

覆盖模块:Context Layer、Registry、Auth、Management(Dashboard/CLI)。

### Case 3:反向注册(Device)

1. 在一台服务器上使用 CLI + 远程 Domain + Register SK:`tb connect https://tb.example.com --sk <SK>`。
2. 服务器与远程 tool-bridge 建立**双向通信(WebSocket)**。
3. 自动注册 Device 路径;自动挂载 `device/<id>/shell`(工具)与 `device/<id>/fs`(Context)。
4. Agent / CLI / Dashboard 可以像访问任何节点一样访问这台设备。

覆盖模块:Device Gateway、Register、Auth(SK 的 register 作用域与路径规则)、CLI。

### Case 4:自部署

1. 默认部署到 Cloudflare(默认 Domain 形如 `tool-bridge.example.com`)。
2. 支持 Docker 自部署:同一套核心逻辑,存储与 WS 换用本地适配。

覆盖模块:Server、CLI(init)。

### Case 5:Agent 使用

1. 给 Agent 一个 SK + BaseURL。
2. Agent 自动获取 `BaseURL/~help`,获得**所有可访问资源及其描述**(已按 SK 裁剪)。
3. 支持 `application/json` 与默认的 Help DSL / markdown 两种表现。
4. Agent 按 `~help` 渐进下钻并调用工具、读写 Context。

覆盖模块:HTBP 树、Auth、Tool Layer、Context Layer。

### Case 6:Dashboard 使用

1. 提供 SK + BaseURL,Dashboard 自动获取 `~help`,渲染所有可访问资源及描述。
2. 用户在表单上填写参数,点击发送,获取返回值——**Dashboard 是 `~help` 的通用渲染器**,不为任何具体工具写专用界面。

覆盖模块:Management(Dashboard)、HTBP 树、Auth。

### Case 7:CLI 使用

1. 提供 SK + BaseURL,CLI 自动获取 `~help`,列出所有可访问资源及描述。
2. `tb call <path> --tool <name> --args '{...}'` 发送调用并获取返回值;`--json` 输出供脚本消费。

覆盖模块:CLI、HTBP 树、Auth。

## 4. 非目标(Non-Goals)

- **不做 Agent Runtime**:不派生、不调度、不托管 Agent;那是上层平台(如 Watt)的职责,tool-bridge 只做供给面。
- **不做事件总线**:不维护订阅/投递;设备 WS 通道只服务于节点调用的转发。
- **不做模型托管与计量**:与 LLM 流量无关。
- **初期不做多云抽象**:默认 Cloudflare + Docker 自部署两条路径;核心逻辑保持运行时中立(Hono + 存储接口),迁移路径保留。

## 5. 成功标准

1. 上述七个 User Case 在架构与协议层面全部走通,无需任何"接口之外"的旁路。
2. 一个完全没有 SDK 的 Agent(只会 HTTP fetch)能通过 `~help` 发现并正确使用全部工具与 Context——**`~help` 的自解释质量以"LLM 只读 `~help` 就能调对"为最终验收**。
3. 新增一种工具来源 / Context 来源 = 实现一个 Provider 接口 + 注册,不改网关核心;从第一天起 SDK 与 Plugin 可用。
4. 每个 SK 的作用域精确到(路径模式 × 动作);越权访问被拒且不可见;反向注册严格遵守 SK 的路径约束。
5. 空闲状态下平台月成本接近零;Docker 自部署可在 30 分钟内从零拉起。
6. 管理面三入口对等:CLI、Dashboard、直接 API 调用的是同一套接口。
