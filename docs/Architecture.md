# Architecture

> 本文定义 tool-bridge 的完整架构:分层、每个 Module 的职责与边界、Cloudflare 与 Docker 两种宿主上的落地映射,以及模块间的协作方式。所有接口的完整定义见 [Proto.md](./Proto.md);本文只列出每个模块**必要的接口面**。

## 0. 总览

```
 Agent / CLI / Dashboard(SK + BaseURL)
        │  GET /~help · /~tree        POST /<path> {"tool":...}
        ▼
┌─────────────────────────────────────────────────────────┐
│                     HTBP Tree(M1)                       │
│   每个节点:~help / ~skill;每级路径可发现;按 SK 裁剪      │
├──────────────┬──────────────┬───────────────────────────┤
│ Tool Layer   │ Context Layer│   Device Gateway(M4)      │
│    (M2)      │    (M3)      │   WS 反向注册的设备子树     │
└──────┬───────┴──────┬───────┴───────────┬───────────────┘
       │              │                   │ WebSocket(双向)
       ▼              ▼                   ▼
  上游 MCP/HTTP   R2 / S3 / File /    任意机器(CLI/SDK 承载:
   工具源         飞书 / Plugin        shell 工具 + fs context)

  横切:Auth(M5,所有调用点) · Registry(M1 内聚) · Observability(最小化:审计日志)
  外围:SDK(M6) · CLI(M7) · Plugin System(M8) · Dashboard(M9) · Server/部署(M10)
```

**分层原则**:每一层由一组**纯接口**定义(ToolProvider、ContextProvider、DeviceChannel(= Proto 的 DeviceTransport/DeviceConn)……);层内实现(内置或 Plugin)都只是接口的 Provider。层与层之间只通过接口交互,接口之外不存在旁路。

**两个全局模式**:

- **单一 HTBP 树**:工具、Context、设备的消费面全部收敛为一棵树上的节点。节点类型见 M1;`~help`/`~tree` 是唯一的发现机制,按调用者 SK 裁剪。
- **统一注册面**:一切"把东西挂上树"的动作(挂工具源、挂 Context namespace、设备反向注册、Plugin 注册)最终都落在 `NodeRegistry.Write`,受同一套 Auth 的 `register` 动作约束(含 SK 路径规则,Proto §2.4)。

**模块清单**:

| # | Module | 一句话职责 | Cloudflare 落地 | Docker 落地 |
|---|---|---|---|---|
| M1 | HTBP Tree | 树与节点的注册、发现(`~help`/`~skill`/`~tree`)、调用分发 | Worker + KV(树配置) | Hono(Node)+ SQLite |
| M2 | Tool Layer | 上游工具源(mcp/http/builtin)的聚合与调用代理 | Worker(MCP client 走 Streamable HTTP) | 同核心逻辑 |
| M3 | Context Layer | 多来源上下文的统一读写与检索面 | R2 + KV/D1 + Plugin | 本地 FS/SQLite + S3 |
| M4 | Device Gateway | 设备反向注册与调用转发 | Durable Object(WS hibernation) | ws(Node) |
| M5 | Auth | SK 的签发、作用域与访问判定 | KV(SK 哈希→记录)+ Worker 中间件 | SQLite |
| M6 | SDK | 嵌入式 TB Server、程序化注册、反向连接 | npm 包(与核心同构) | 同左 |
| M7 | CLI | 部署、管理、挂载、反向注册的命令行 | npm 包 `tb` | 同左 |
| M8 | Plugin System | 自定义 Tool/Context Provider 的注册与生命周期 | KV(manifest)+ 外部 HTTP/Worker | 同核心逻辑 |
| M9 | Dashboard | `~help` 的通用渲染器 + 管理表单 | 与 gateway 同 Worker(Static Assets,`/ui`) | 同一镜像静态托管 |
| M10 | Server/部署 | 一键部署与自部署 | wrangler(`tb init`) | Docker 镜像 |

---

## M1. HTBP Tree(核心)

**职责**:tool-bridge 的一切对外供给收敛为一棵自描述的树。M1 管:节点注册表(`NodeRegistry`)、路径路由、`~help`/`~skill`/`~tree` 的生成、内容协商、调用分发(把 `POST <path>` 派给节点背后的 Provider)。

### 节点类型

| kind | 含义 | 背后 |
|---|---|---|
| `directory` | 中间节点,只做归组与发现 | 无(由子节点推导 `~help`) |
| `mcp` | 上游 MCP server 整体作为叶子(内嵌全部工具 schema) | M2 mcp Provider(Streamable HTTP) |
| `http` | 自定义 HTTP endpoint 工具 | M2 http Provider |
| `builtin` | 平台内置能力(如 `system/sk` 管理) | 进程内实现 |
| `context` | 一个 Context namespace(cmd = 四动词 + 声明的可选能力) | M3 ContextProvider |
| `device` | 反向注册的设备子树(下挂 shell 工具节点与 fs context 节点) | M4 Device Gateway |
| `remote` | 联邦到任意 HTBP 服务("Add TB Server":另一个 tool-bridge 实例**或任何 Custom HTBP Server**) | HTTP 透传(白名单 + 环检测) |

### 关键设计

1. **每级可发现(TB.md 注意 4)**:注册路径 `a/b/c` 时,自动物化 `a`、`a/b` 两级 directory 节点;三级都响应 `~help`。卸载 `a/b/c` 后若中间节点再无子节点则回收。
2. **`/~tree?depth=N`(TB.md 注意 7)**:返回受限深度的树视图(默认 depth=2,上限 8;环检测、节点数上限),供 Agent 一次性建立地图、Dashboard 渲染导航。
3. **内容协商(TB.md 注意 6)**:默认返回 `text/markdown`(`~help` 为 HTBP Help DSL,`text/plain`);仅当请求声明 `Accept: application/json` 时返回结构化 JSON。两种表现语义等价。
4. **保留段**:`~help`/`~skill`/`~tree`/`~register`/`~describe` 为协议保留;根路径段 `system`(管理接口子树)与 `ui`(Dashboard 静态资源)为平台保留,不可被注册占用。

### 必要接口(详见 Proto §1/§3)

- HTBP 表面 — `GET <path>/~help` / `GET <path>/~skill` / `GET /~tree` / `POST <path>`(调用)。
- `NodeRegistry` — `List` / `Get` / `Write` / `Update` / `Delete` / `Resolve`:节点的挂载管理(Dashboard、CLI、SDK、反向注册都调它)。

---

## M2. Tool Layer

**职责**:上游聚合 MCP server(Streamable HTTP)、任意 HTTP API 与内置能力;下游以树节点形态供任何环境的 Agent 调用。

### 组成

| 组件 | 职责 | 落地 |
|---|---|---|
| **mcp Provider** | 连接上游 MCP server(`tools/list`→`~help`,`tools/call`→调用),会话与重连管理 | 官方 `@modelcontextprotocol/sdk` client,Streamable HTTP |
| **http Provider** | 把任意 HTTP endpoint 描述为工具(方法、参数 schema、认证头) | fetch 代理 + 凭证注入 |
| **builtin Provider** | 平台自身能力(`system/*` 子树) | 进程内直调 |
| **工具虚拟化** | namespace 前缀、rename、hide、description override | 节点配置(`virtualize`),对外只暴露虚拟名 |

### 关键设计

1. **凭证不出网关**:上游 API key / MCP 认证存在网关侧(SecretStore 引用),Agent 永远拿不到原始凭证。
2. **权限在调用点判定**:每次 `POST <path>` 携带 SK,先过 `Authorizer.Check(sk, node://<path>, call)`;`~help` 已裁剪,但裁剪不是判定——调用点必须再查。
3. **`~help` 从上游派生**:mcp 节点的 `~help` 由上游 `tools/list` 的 schema 生成(经虚拟化映射),缓存 + 失效策略;实现与文档不会漂移。

### 必要接口(详见 Proto §4)

- `ToolProvider` — `List` / `Get` / `Call`:工具源插件的全部义务(`Get` 返回单个工具的 schema/描述,即 `~help` 的数据源)。

---

## M3. Context Layer

**职责**:把多来源上下文(R2、S3、FileSystem、飞书、自定义 Provider)统一成**带 namespace 的读写与检索面**,挂载为树上的 context 节点。

### 组成

| 组件 | 职责 | 落地 |
|---|---|---|
| **内置 Provider: r2** | 对象存储(默认) | R2 绑定 |
| **内置 Provider: s3** | 任意 S3 兼容存储(AK/SK 配置,Case 2) | aws4fetch 签名直连 |
| **内置 Provider: file** | 本地文件系统(Docker 自部署 / 设备 fs 复用同一实现) | Node fs(仅 node 宿主) |
| **外部 Provider(Plugin)** | 飞书文档、内部系统…… | 实现 `ContextProvider` 的 HTTP 服务/Worker |
| **检索** | `Search` 可选能力,`mode: keyword | semantic`;keyword 为内置(名称/内容匹配),semantic 由声明该能力的 Provider 提供(如 Vectorize 后端) | capability 声明,调用方先探测 |

### 关键设计

1. **对 Agent 只有一个抽象**:Agent 不感知"这是 R2 还是飞书",只见 `context 节点 + 四动词`;换 Provider 不改 Agent。
2. **四动词封闭够用**:`List / Get / Update / Write` 是必须集;`Search / Watch / Delete` 是可选能力。语义与 Proto §0.4 的统一动词一致。
3. **大对象经 `$ref` 间接传递**:超限内容返回预签名 URL,不从网关过流量(R2 零出口费)。

### 必要接口(详见 Proto §5)

- `ContextProvider` — `List` / `Get` / `Update` / `Write`(+ 可选 `Search` / `Watch` / `Delete`)。
- namespace 挂载复用 `NodeRegistry.Write`(kind=`context`),无独立 Registry。

---

## M4. Device Gateway(反向注册)

**职责**:让任何机器主动接入。设备侧用 CLI/SDK 持 Register SK 建立 WebSocket;网关侧把设备声明的能力挂上树,并把针对这些节点的调用经 WS 转发给设备。

### 流程(Case 3)

```
设备:tb connect https://tb.example.com --sk <SK>
  1. WS 握手(Bearer SK)→ Authorizer.Check(sk, node://device/<id>, register)
  2. 设备发 hello 帧:{ deviceId, expose: { shell?, fs?, nodes? } }(Proto §6.2 DeviceExpose)
  3. 网关写入 NodeRegistry:device/<id>(directory)
     + device/<id>/shell(工具节点)+ device/<id>/fs(context 节点)
  4. 此后对这些节点的调用 → 帧转发(requestId 关联)→ 设备执行 → 结果回帧
  5. 断线:节点标记 offline(调用返回 unavailable, retryable);重连恢复;超时回收
```

### 关键设计

1. **SK 路径规则(TB.md 注意 2/3)**:Register SK 声明了允许注册的 path → 仅允许在该 path 下注册;未声明 → 允许注册除保留根路径(`system` 等)之外的任意路径。规范定义见 Proto §2.4。
2. **落地**:Cloudflare 上每个设备连接一个 Durable Object(WS hibernation,空闲零计费);Docker 宿主用 `ws`。调用转发协议(帧格式、超时、幂等)见 Proto §6。
3. **设备即普通节点**:Agent 访问 `device/<id>/shell` 与访问任何工具节点无差别——`~help` 同样生成、Auth 同样判定、审计同样留痕。

### 必要接口(详见 Proto §6)

- `DeviceTransport` / `DeviceConn` — 承载 WS 帧协议 `DeviceFrame`:`hello` / `ready` / `call` / `result` / `cancel` / `ping|pong`(Proto §6.2、§7);本文早前以 `DeviceChannel` 泛指该 WS 帧通道抽象。
- 设备的挂载/下线复用 `NodeRegistry`(由 Gateway 代写)。

---

## M5. Auth

**职责**:回答一个问题——**"这个 SK(代表这个 User/Agent/Device)能否对这个路径做这个动作(Read / Write / Call / Register / Admin)?"**(TB.md 注意 1)

### 核心概念

- **SecretKey(SK)**:唯一的凭证形态。opaque token,`sha256` 哈希后存储查找;每个 SK 记录 owner(`user:<id>` / `agent:<id>` / `device:<id>`)与 scopes。
- **Scope**:`(路径模式, 动作集)` 列表,如 `{ pattern: "docs/**", actions: ["read"] }`、`{ pattern: "device/build-01/**", actions: ["register"] }`。deny 优先、无匹配即拒。
- **Admin SK**:部署时自动生成(Case 1),scope = `**` 全动作;用于登录后签发更细粒度的 SK。

### 组成与落地

| 组件 | 落地 |
|---|---|
| SK 存储 | KV(`sha256(sk)` → 记录;吊销传播窗口 ≤60s,语义见 Proto §2.3)/ SQLite(Docker,即时) |
| 上游凭证(SecretStore) | 值经 AES-256-GCM 加密存 KV/SQLite,主密钥 `TB_SECRET_ENCRYPTION_KEY` env-only;builtin 节点 `system/secret`,只写不读(Proto §2.5) |
| 判定点(PEP) | M1 调用分发前的中间件:`~help`/`~tree`/`List` 走裁剪,`POST` 走 Check |
| 管理面 | `system/sk` builtin 节点(签发/列举/吊销),仅 admin 动作可达 |

### 必要接口(详见 Proto §2)

- `Authorizer` — `Check`:唯一判定入口,所有模块只依赖它。
- `SKRegistry` — `List` / `Get` / `Write` / `Update` / `Delete`(吊销)。
- `SecretStore` — `Set` / `List` / `Delete`(上游凭证,Proto §2.5;`authRef`/`skRef` 的来源)。

---

## M6. SDK

**职责**:tool-bridge 的能力以库的形式复用(TB.md 注意 8:从一开始就支持)。三件事:

1. **run TB Server**:`createToolBridge(config)` 在任意 Node/Workers 环境内嵌运行一个 TB 实例(核心逻辑与云上实例同构)。
2. **程序化注册**:`tb.registerTool(path, provider)` / `tb.registerContext(namespace, provider)`——本地代码直接实现 Provider 接口挂上树。
3. **反向连接(HTTP → WebSocket)**:`tb.connect(remoteBaseUrl, sk)` 把本实例注册的节点经 WS 反向挂到远程 TB 上——CLI 的 `tb connect` 与设备接入就是这个 API 的封装。

### 关键设计

- **CLI 与 Device Agent 都是 SDK 的消费者**:不存在 SDK 之外的私有通道;SDK 的公开面 = Proto 的接口面。
- 核心逻辑(树、Auth、协议编解码)在 `packages/core`,纯逻辑无宿主依赖;SDK/网关/CLI 都装配它。

### 必要接口(详见 Proto §7)

- `createToolBridge` / `registerTool` / `registerContext` / `connect`。

---

## M7. CLI

**职责**:命令行管理入口 + 本机能力的挂载器。**纯 API 客户端**——每条子命令一一映射到 Proto 接口,无专用端点;`--json` 输出供脚本消费,也使 CLI 成为 E2E 的默认驱动器(DOD §9)。

| 命令 | 背后接口 |
|---|---|
| `tb init` | 部署向导(Cloudflare;生成 Admin SK)——M10 |
| `tb login` / `tb whoami` / `tb use <server>` | SK + BaseURL 存 `~/.config/tool-bridge/config.json`(XDG,profile 结构,0600;Phase 1 定型回写,详见 Proto 附A 注记);多 server 配置切换 |
| `tb status` | `POST /system/status {"tool":"get"}`(登录态健康摘要);未登录/Phase 0 回退树外 `GET /healthz`(Proto §1.1) |
| `tb ls [path]` / `tb tree [--depth N]` / `tb help <path>` | `~help` / `~tree`(发现面) |
| `tb call <path> --tool <name> --args '{}'` | `POST <path>`(调用面,Case 7) |
| `tb tool mount/rm` | `NodeRegistry.Write/Delete`(kind=mcp/http) |
| `tb server add/ls/rm` | `NodeRegistry.Write/List/Delete`(kind=remote:联邦任意 HTBP 服务,TB.md "Add TB Server") |
| `tb ctx ls/cat/put/patch/search/mount/unmount` | `ContextProvider.*` + `NodeRegistry.*`(kind=context) |
| `tb device ls` / `tb connect <url> --sk <SK> [--path p]` | 设备列表 / M4 反向注册(长驻进程) |
| `tb mount fs <local-dir> --path <tree-path>` | SDK:file ContextProvider + `connect`(把本机目录挂成远程 context) |
| `tb sk list/create/rm` | `SKRegistry.*`(`create` 可签发带 `register` 作用域/`registerPaths` 的 SK,即 TB.md「Allow 反向注册」) |
| `tb secret set/ls/rm` | `SecretStore.Set/List/Delete`(Proto §2.5;挂载时 authRef 引用它) |
| `tb plugin register/list/health` | `PluginRegistry.*` |

---

## M8. Plugin System

**职责**:自定义扩展 = 实现某接口的可注册部署单元。编写指南单独成文:[Plugin.md](./Plugin.md)。

| Plugin 类型 | 实现的接口 | 例子 |
|---|---|---|
| Context Provider | `ContextProvider`(List/Get/Update/Write + 可选 Search) | 飞书文档、Notion、内部 Wiki |
| Tool Provider | `ToolProvider`(List/Get/Call) | 内部订单系统 API、聚合器 |

- **注册**:`PluginRegistry.Write` 提交 manifest(kind、interfaceVersion、endpoint、healthPath);平台验证契约(抓 `~help` + 探活)后即可被 `NodeRegistry` 引用挂载。
- **传输契约**:平台→Plugin 的调用形态与 HTBP 节点调用一致(`POST {base} {"tool":...}`),见 Proto §8.3。

### 必要接口(详见 Proto §8)

- `PluginRegistry` — `List` / `Get` / `Write` / `Update` / `Delete`。
- `PluginLifecycle` — `Health` / `Describe`。

---

## M9. Dashboard

**职责**:`~help` 的**通用渲染器**(Case 6)。给定 SK + BaseURL:拉 `~tree` 渲染导航、拉 `~help` 渲染每个节点的表单(cmd 的参数即表单字段)、`POST` 发送并展示返回值(markdown 渲染 / JSON 视图)。管理视图(SK 管理、节点挂载、Plugin 注册)同样是 `system/*` 子树 `~help` 的渲染,不存在专用后端。

落地:**与 gateway 同 Worker 部署,不额外增加 Pages/Worker**——Dashboard 构建产物作为 Workers Static Assets 挂在 `tb-gateway` 上,路径前缀 `/ui/*`(`ui` 为保留根路径,不与树路径冲突;浏览器 `GET /` 且 `Accept: text/html` 时 302 → `/ui/`)。**路由次序(Phase 6 前置核实)**:Worker 逻辑先行(`run_worker_first`)或将 assets 严格限定 `/ui` 前缀、SPA not_found 回退只在 `/ui` 内生效——静态资源回退不得吞掉根 `~help`、`POST /<path>` 与 `system/*` 路由。**技术栈用成熟前端框架**(Reference §5):React 19 + Vite + Ant Design v5(管理台组件)+ @rjsf(JSON Schema → 表单自动渲染——`~help` JSON 表现中 cmd 的 inputSchema 直接喂给它)+ TanStack Query(数据层)+ react-markdown(返回值渲染)。Docker 部署时由同一镜像在同一端口静态托管构建产物(同样挂 `/ui`)。

---

## M10. Server / 部署

**职责**:两条部署路径,产出同一棵树(Case 1 / Case 4)。

| 路径 | 形态 | 说明 |
|---|---|---|
| **Cloudflare(默认)** | `tb init` 向导:wrangler auth 检查 → 资源 provision(KV/R2/DO)→ 部署 `tb-gateway` 单 Worker(API + Dashboard 静态资源)→ 生成 Admin SK → 输出 BaseURL | 空闲近零成本;WS 走 DO hibernation;**server 与 dashboard 一体部署** |
| **Docker 自部署** | `docker run tool-bridge`:同一 `packages/core`,Hono Node adapter + SQLite + 本地 FS/S3 | 数据卷持久化;单容器含 Dashboard 静态资源 |

**宿主抽象**:核心只依赖两个接口——`StateStore`(树配置、SK、plugin manifest;CF=KV,Docker=SQLite)与 `ObjectStore`(context 对象;CF=R2,Docker=FS/S3)。WS 通道按宿主注入(DO / ws)。

---

## 附A. User Case → 模块调用链核对

| Case | 走通路径(模块序列) |
|---|---|
| 1 Admin 初始化 | M7(`tb init`)→ M10(provision+deploy)→ M5(生成 Admin SK)→ M7(`tb login` → `tb status`)→ M1(`system/status`) |
| 2 添加 Context | M9/M7(表单/命令:AK/SK/描述)→ M1(`NodeRegistry.Write` kind=context)→ M5(Check: register)→ M3(s3 Provider 验证连通)→ 三入口经 M1 读写 |
| 3 反向注册 | M7(`tb connect`)→ M4(WS 握手)→ M5(Check: register + 路径规则)→ M1(自动挂 `device/<id>` + `/shell` + `/fs`)→ Agent 经 M1 调用 → M4(帧转发)→ 设备执行回帧 |
| 4 自部署 | M10(CF:`tb init` / Docker:`docker run`)→ 同一套 E2E 冒烟(healthz、~help、mount、call) |
| 5 Agent 使用 | M5(SK 认证)→ M1(`/~help` 裁剪后渐进发现,markdown/json 协商)→ M2/M3(调用与读写) |
| 6 Dashboard 使用 | M9(拉 `~tree`/`~help` 渲染表单)→ M1(POST 调用)→ 展示返回 |
| 7 CLI 使用 | M7(`tb ls/tree/help/call --json`)→ M1 |

## 附B. 部署拓扑(Cloudflare 资源清单)

> 资源命名约定:云上资源统一 `tb-` 前缀(`TB_NAME_PREFIX` 派生);实际创建由幂等脚本 `pnpm provision`(或 `tb init` 内置的 TS 移植)负责。**作者部署**:账户 DJJ(Account ID 填在本地 `.env` 的 `CLOUDFLARE_ACCOUNT_ID`,不入库),生产 domain `tool-bridge.pdjjq.org`(zone `pdjjq.org`);操作经本地 wrangler OAuth。

```
workers:
  tb-gateway            # M1 树 + M2/M3 内置 Provider + M5 中间件 + system/* 子树
                        #   + M9 Dashboard 静态资源(Workers Static Assets,/ui)——一体部署
durable_objects:
  DeviceSession         # M4 每设备一个(WS hibernation)
storage:
  KV: tb-state          # M1 树配置 / M5 SK 哈希表 / M8 plugin manifest
                        #   key 布局(Phase 1 定型):sk:h:<sha256hex>→SecretKey(认证热路径)、
                        #   sk:i:<id>→hash 指针(管理面二级索引)、node:<path>→Node、
                        #   secret:<name>→{iv,ciphertext,updatedAt}、plugin:<id>→manifest、
                        #   toolcache:<path>→{tools,fetchedAt}(mcp ~help 缓存,TTL 默认
                        #   300s,Phase 2 定型,失效规则见 Proto §4.2)、
                        #   sys:bootstrapped→引导幂等标志。SQLite 宿主用同构表结构。
                        #   KV 的 list+get 存在最终一致窗口(刚删除的 key 可能仍出现
                        #   在 list 而 get 为 null),StateStore 实现须跳过 null 值
                        #   (Phase 1 定型回写)。
  R2: tb-context        # M3 r2 provider 默认 bucket
  D1: tb-audit          # M5 审计留痕(可选,Phase 后期)
cli:
  tb (npm)              # M7(纯 API 客户端 + init 向导 + connect 长驻)
sdk:
  @tool-bridge/sdk (npm)  # M6(核心同构)
docker:
  tool-bridge (image)   # M10 自部署:core + Hono node + SQLite + FS
```

**引导顺序(bootstrap,最终态清单)**:部署 Worker/DO → 生成 Admin SK(哈希入 KV,明文仅输出一次)→ 注册内置节点(`system/status`、`system/sk`、`system/secret`、`system/registry`;`system/plugin` 自 Phase 5 随 M8 落地后加入)→ Dashboard 可用 → 用户经 Admin SK 挂载第一批工具/Context。
