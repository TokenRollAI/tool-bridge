# Proto

> 本文是 tool-bridge 各层接口的**规范性定义**。所有接口都是**纯粹的 Interface 描述**(契约),不含实现约束——同一接口可以由网关内置模块实现,也可以由 Plugin(Worker 或外部 HTTP 服务)或 SDK 嵌入实例实现。章节编号与 [Architecture.md](./Architecture.md) 中各模块的引用对应。
>
> 记法约定:使用 TypeScript 风格描述形状;`?` 表示可选;所有接口方法都是异步的(返回 `Promise<T>`,为简洁省略)。分页、错误、URI 等通用约定见 §0。

## §0. 通用约定

### 0.1 资源 URI

平台中一切可授权的资源使用统一 URI:

```
node://<tree-path>          # 树上任意节点(工具 / 目录 / context / device / remote)
                            #   例:node://docs/context7、node://device/build-01/shell
sk://<key-id>               # 一把 Secret Key(管理面授权用)
plugin://<plugin-id>        # 一个 Plugin
system://<module>           # 平台管理接口本身(sk / registry / plugin / status)
```

树路径是主资源空间:工具、Context、设备统一以 `node://<path>` 授权,不为三者各设 scheme——树是唯一的消费面,权限也只对树表达。

### 0.2 通用类型

```ts
type URI = string                       // §0.1 定义的资源 URI
type TreePath = string                  // 树上路径,'/'分隔,不含保留段;如 "docs/context7"
type Timestamp = string                 // ISO 8601, UTC

interface Page<T> {
  items: T[]
  cursor?: string                       // 存在则表示还有下一页;传回 List 继续
}

interface ListOptions {
  cursor?: string
  limit?: number                        // 规范默认 50、上限 200,超上限静默钳制
  filter?: Record<string, string>       // 键集合由各接口 ~help 声明;未声明的键 → invalid_argument
}

interface TBError {
  code: 'not_found' | 'permission_denied' | 'invalid_argument'
      | 'conflict' | 'unavailable' | 'rate_limited' | 'internal'
  message: string                       // 面向 LLM/人类可读
  retryable: boolean
}
```

**TBError ↔ HTTP 映射(规范性)**:`not_found`→404、`permission_denied`→403、`invalid_argument`→400、`conflict`→409、`rate_limited`→429、`unavailable`→503、`internal`→500。`retryable=true` 仅允许出现在 `rate_limited` / `unavailable` / `internal` 上;调用方对 429 与 5xx 且 `retryable=true` 的响应按指数退避重试。

**未认证**:缺失或无法识别的 SK 属认证层失败,发生在进入 `Authorizer.Check` 之前——返回 HTTP **401**,body 复用 `TBError` 形状且 `code: 'permission_denied'`、`retryable: false`(7 码集合不为此扩容:401/403 的区分由 HTTP 状态码承担)。**disabled 或已过期(`expiresAt`)的 SK 视同无法识别**,同样返回 401——能否查到记录是实现细节,对外语义一致(Phase 1 定型回写)。

**未实现占位**:尚未落地的路由/能力返回 HTTP **501**,body `code: 'unavailable'`、`retryable: false`。

**设备离线**:device 节点的宿主连接断开时,对其子节点的调用返回 HTTP **503**,`code: 'unavailable'`、`retryable: true`(重连后即恢复)。

### 0.3 调用上下文(所有接口隐式携带)

每个调用在传输层携带 `CallContext`,实现方**不得**要求调用方在参数中重复传递身份:

```ts
interface CallContext {
  keyId: string                         // 本次调用使用的 SK 的 id(非明文)
  owner: OwnerRef                       // SK 的持有者
  scopes: Scope[]                       // SK 的作用域(§2.2)
  traceId: string                       // 全链路观测
}
type OwnerRef = string                  // "user:alice" | "agent:researcher" | "device:build-01"
```

### 0.4 CRUD 动词的统一语义

**Registry 类**接口(NodeRegistry、SKRegistry、PluginRegistry)统一四动词 + Delete;**Provider 类**接口的动词由领域语义决定(ContextProvider = 完整四动词;ToolProvider = List/Get/Call,工具源天然只读+可调用):

| 动词 | 语义 |
|---|---|
| `List` | 枚举集合,分页,结果按调用者权限裁剪 |
| `Get` | 按 id/path 取单个完整对象;不存在 → `not_found` |
| `Write` | 创建**或整体替换**(幂等 upsert,以调用方给定的 id/path 为准) |
| `Update` | 部分更新(patch 语义);不存在 → `not_found` |
| `Delete` | 删除/卸载;Provider 类接口中为可选能力,须在 capability 中声明 |

---

## §1. HTBP 表面(规范性)

tool-bridge 的对外线上形态遵循 HTBP(Reference §1):控制面 = 保留段端点,数据面 = 节点调用。

### 1.1 保留段与端点

对树上**每一个路径级**(含根、含自动物化的中间 directory):

```
GET  /<path>/~help          # 必须:该节点全部 cmd 的 Help DSL(text/plain);
                            #   directory 节点列出子节点相对路径与一句话描述
GET  /<path>/~skill         # 推荐:text/markdown 操作指南(多步流程、危险操作、错误恢复)
GET  /<path>/~describe      # context/remote 等有可选能力的节点:返回 { kind, capabilities }
                            #   (JSON;capability 探测的树面落点——如 Search/Watch/Delete、
                            #   "search:semantic";无可选能力的节点可 404)
POST /<path>                # 数据面调用:body {"tool":"<cmd>","arguments":{...}}
GET  /~tree?depth=N         # 根级:受限深度树视图(默认 depth=2,上限 8;
                            #   环检测、节点上限 500;亦可 GET /<path>/~tree 取子树)
POST /<path>/~register      # 可选:HTTP 形态的注册入口(等价 NodeRegistry.Write,
                            #   受同一 register 判定;两条注册通道的定位见 §3.3;
                            #   WS 反向注册见 §6)
```

**`~tree` 判定与 depth 钳制(规范性,Phase 1 定型回写)**:`GET /~tree` 的根入口不做(根, 'read')判定,子节点逐个按可见性裁剪(§2.3);`GET /<path>/~tree` 对 `path` 做 `read` 判定,不通过 → 404。`depth` 非法值(非整数或 <1)按默认 2 处理,大于 8 钳为 8——不支持 `depth=0`。

**`~describe`(规范性,Phase 3 定型)**:`GET /<path>/~describe` 返回 `{ kind, capabilities: string[] }`;capabilities 词表按能力命名——Phase 3 的 context 节点返回 `["search","delete"]`,将来的 semantic 插件声明 `"search:semantic"`;无可选能力的节点(其他 kind)→ 404。

**注册路径 `a/b/c` 时,`a`、`a/b`、`a/b/c` 三级都必须响应 `~help`**(TB.md 注意 4)——中间级由 NodeRegistry 自动物化为 directory。

保留段 `~help / ~skill / ~tree / ~register / ~describe` 不可作为普通路径段;根路径段 `system`(平台管理子树)与 `ui`(Dashboard 静态资源,Architecture M9)为平台保留。

**平台运维端点 `GET /healthz`(树外,免认证)**:返回 `200` + `{"healthy":true,"version":"<x.y.z>"}`——形状与 Plugin 健康端点(§8)对齐并加 `version` 字段,满足 DOD "200 + 版本号" 与 `tb status --json` 可解析(Phase 0 实现定型,2026-07-06 回写)。

### 1.2 内容协商(规范性)

- 默认(无 `Accept` 或 `Accept: text/markdown`):`~help` 返回 HTBP Help DSL(`text/plain`——DSL 即 `~help` 的唯一非 JSON 表现,不提供 markdown 变体),`~skill` 返回 `text/markdown`,调用返回值渲染为 `text/markdown`。
- 声明 `Accept: application/json`:`~help` 返回结构化 JSON(cmd 数组,字段与 DSL 等价),调用返回值为原始 JSON。
- 两种表现**语义必须等价**——JSON 是 DSL 的机器可读形态,不得多字段、少字段。

> **与 TB.md 注意 6 的对账**:原文为"返回 format 默认为 application/markdown"。`application/markdown` 未在 IANA 注册,本规范采用注册类型 **`text/markdown`** 承载同一语义;`~help` 的默认表现遵循 HTBP(Reference §1)为 `text/plain` Help DSL——二者同属"默认非 JSON 的 LLM 可读表现",JSON 仅在显式声明时返回,与注意 6 的意图一致。

### 1.3 Help DSL(节选约定)

沿用 HTBP RFC-0001 的紧凑格式,每个 cmd 一行起:

```
htbp 0.1
node docs/context7 mcp "Context7 文档检索"
cmd resolve-library-id POST /docs/context7
  body { "tool":"resolve-library-id", "arguments": { "libraryName": string } }
  returns markdown 文档库列表
  scope call
cmd get-library-docs POST /docs/context7
  ...
```

约束:每个 cmd 必须声明 `scope`(对应 §2.2 的动作,供调用方预判权限);`effect`(是否有副作用)、`confirm`(危险操作)与 `h`(工具级一句话描述,Phase 2 定型)按 HTBP 属性表可选携带——mcp/http 工具的上游 description 落在 `h` 行;消费方对未知行必须忽略(向前兼容)。

**DSL 渲染细节(规范性,Phase 1 定型回写)**:cmd 行的路径带前导 `/`(如 `POST /docs/context7`);根节点的 DSL `node` 行路径显示为 `/`,JSON 表现中 `node.path` 为空串;cmd 属性行按 `h → body → returns → scope → effect → confirm` 顺序输出(`h` 为 Phase 2 定型新增),两空格缩进,`body` 为单行紧凑 JSON;`confirm` 仅以属性行的存在表示真值,不携带值。`~tree` 的默认(非 JSON)表现为缩进文本树,具体排版由实现自定——JSON(`TreeJson`)才是规范形状。

**cmd 命名(规范性)**:Provider 类节点的 cmd 名 = 其接口方法名,**首字母大写**(context 节点:`List` / `Get` / `Update` / `Write` / `Search`;tool 节点的 cmd 为**工具原名**,如 mcp·http 工具名、device shell 的 `exec`——`ToolProvider.Call` 是内部派发方法,不成为树 cmd);仅 `system/*` builtin 用小写 cmd 名(§4.2)——同类 Provider 节点无论内置还是 Plugin,cmd 名一致,保证"换 Provider 不改 Agent"。

**JSON 等价形状(规范性,Phase 1 定型回写)**——`Accept: application/json` 时,`~help` 与 `~tree` 返回以下结构,字段与 DSL 一一对应、不得多/少字段:

```ts
interface HelpJson {
  htbp: string                          // "0.1"
  node: { path: TreePath, kind: Node['kind'], description: string }
  cmds: Array<{ name: string, method: 'POST', path: string,
                h?: string,            // 工具级一句话描述(= DSL 的 h 行;Phase 2 定型)
                inputSchema?: unknown, // 该 cmd arguments 的 JSON Schema(= provider 的
                                       //   inputSchema,不含 {tool,arguments} 信封;
                                       //   DSL 的 body 行是请求信封示意,二者语义等价、
                                       //   结构表现不同——Dashboard 表单直接消费本字段)
                returns?: string, scope: Action,
                effect?: string, confirm?: boolean }>
  children?: Array<{ path: TreePath, kind: Node['kind'], description: string }>  // directory 节点
}
interface TreeJson {                    // ~tree;递归
  path: TreePath, kind: Node['kind'], description: string
  online?: boolean, truncated?: boolean // truncated:深度/节点上限或环检测截断
  children?: TreeJson[]
}
```

### 1.4 调用形态

```
POST /<path>
Authorization: Bearer <SK>
Content-Type: application/json

{"tool": "<cmd>", "arguments": { ... }}

→ 200 <返回值>(按 1.2 协商)
→ 4xx/5xx TBError(§0.2 映射)
```

`arguments` 的字段名与本文各接口签名一致;可选的 `opts?: ListOptions` 作为整体对象传递,不平铺。

**判定次序(规范性,Phase 1 定型回写)**:`POST /<path>` 先做 (path, 'read') 可见性判定——不通过 → 404 `not_found`(与 §2.3 的"deny 即不存在"一致);通过后再按该 cmd 在 `~help` 声明的 `scope` 动作过 `Check`——不通过 → 403 `permission_denied`。

### 1.5 版本化

- 协议版本随 `~help` 首行 `htbp <ver>` 声明;接口破坏性变更升 major,Plugin 的 `interfaceVersion`(§8.1)与之对齐。
- 消费方(Agent/CLI/Dashboard)以渐进发现自动适配,不硬编码树结构。

---

## §2. Auth

### 2.1 SecretKey

```ts
interface SecretKey {
  id: string                            // key id(可公开,审计用)
  hash: string                          // sha256(明文);明文仅在签发响应中出现一次
  owner: OwnerRef                       // "user:alice" | "agent:researcher" | "device:build-01"
  description?: string
  scopes: Scope[]                       // §2.2;空数组 = 无任何权限
  registerPaths?: TreePath[]            // 反向注册路径约束(§2.4);缺省见规则 b
  disabled?: boolean                    // 吊销 = Update{disabled:true} 或 Delete
  createdAt: Timestamp
  expiresAt?: Timestamp                 // 过期视同 disabled
}
```

### 2.2 Scope 与动作

```ts
interface Scope {
  pattern: string                       // 树路径 glob:"**" | "docs/**" | "device/build-01/**"
  actions: Action[]
  effect?: 'allow' | 'deny'             // 默认 allow;deny 优先于一切 allow
}
type Action =
  | 'read'                              // ~help / ~skill / ~tree / List / Get / Search
  | 'write'                             // Write / Update / Delete(context 数据面)
  | 'call'                              // 工具调用(含 device shell)
  | 'register'                          // 在该路径下挂载/卸载节点(NodeRegistry 写面)
  | 'admin'                             // system/* 管理面(SK 签发、plugin 注册、全局配置)
```

判定规则(规范性,按序):

1. 任一 `deny` scope 匹配 (path, action) → **deny**;
2. 任一 `allow` scope 匹配 → **allow**;
3. 无匹配 → **deny**(默认拒绝)。

glob 语义:`*` 匹配单段,`**` 匹配任意层级(含零段);匹配对象是不含保留段的树路径。

### 2.3 Authorizer 与 SKRegistry

```ts
interface Authorizer {
  /** 唯一判定入口;所有模块只依赖它 */
  Check(ctx: CallContext, resource: URI, action: Action): { allow: boolean, reason?: string }
}

interface SKRegistry {                   // 挂载为 builtin 节点 system/sk;需 admin 动作
  List(opts?: ListOptions): Page<Omit<SecretKey,'hash'>>
  Get(id: string): Omit<SecretKey,'hash'>
  Write(input: SecretKeyInput): { key: Omit<SecretKey,'hash'>, secret: string }  // secret 仅此一次
  Update(id: string, patch: Partial<SecretKeyInput> & { disabled?: boolean }): Omit<SecretKey,'hash'>
  Delete(id: string): void               // 吊销;目标不存在时幂等静默
}
interface SecretKeyInput {
  owner: OwnerRef
  description?: string
  scopes: Scope[]
  registerPaths?: TreePath[]
  expiresAt?: Timestamp
}
```

`Write`/`Update` 落库的 `createdAt`/`updatedAt` 由宿主注入的时钟生成,核心逻辑不直接读系统时间(Phase 1 定型回写)。

**可见性裁剪(规范性)**:`~help`/`~tree`/各 `List` 的结果必须按调用者裁剪——对 (path, 'read') 判 deny 的节点不出现在结果中。裁剪是体验,不是判定:数据面每次调用仍必须过 `Check`。**deny 即不存在(Phase 1 定型回写)**:对 (path, 'read') 判 deny 的节点,`~help`/`~tree`/数据面一律返回 404 `not_found`,不泄露其存在性;可见(read 通过)但目标动作被 deny 的调用才返回 403 `permission_denied`。

**Admin SK 引导(Case 1)**:部署过程(`tb init` / Docker 首次启动)生成一把 `owner: "user:admin"`、`scopes: [{pattern:"**", actions:[read,write,call,register,admin]}]` 的 SK,明文只输出一次;后续更细粒度的 SK 由 admin 经 `system/sk` 签发。

**吊销传播(规范性)**:Cloudflare 宿主下 SK 记录经 KV 分发(最终一致),吊销/禁用在全球边缘的传播窗口上限 **60s**(KV 官方上限);窗口内个别边缘可能仍放行旧 SK。需要即时失效的场景应使用短 `expiresAt` 或主动轮换;Docker/单机宿主(SQLite)吊销即时生效。可脚本化验收见 DOD Phase 1。

### 2.4 反向注册的路径规则(规范性,TB.md 注意 2/3)

对 `NodeRegistry.Write/Delete`(含 `~register`、WS 反向注册)的判定,在 §2.2 通用规则之上叠加:

a. SK 声明了 `registerPaths` → 目标路径必须落在其中某个前缀之下,否则 `permission_denied`;
b. SK 未声明 `registerPaths` → 允许注册**保留根路径之外**的任意路径(保留根路径 = `system`、`ui` + 部署配置声明的追加列表);
c. 两种情形都仍需 (path, 'register') 的 scope 判定通过——`registerPaths` 是收紧,不是授权来源;
d. 目标路径已存在且非本 SK 所注册 → `conflict`(不允许静默覆盖他人节点);同 SK 重复注册同路径 = 幂等 upsert。

### 2.5 SecretStore(上游凭证,规范性)

`authRef` / `skRef` / `secretRef` 的解析后端:上游凭证(S3 AK/SK、MCP Bearer、remote 出站 SK……)**只进不出**。

```ts
interface SecretStore {                  // 节点面挂载为 builtin 节点 system/secret;需 admin 动作
  Set(name: string, value: string): void          // 写入/替换;明文仅在此请求中出现
  List(opts?: ListOptions): Page<{ name: string, updatedAt: Timestamp }>
  Delete(name: string): void
  /** 仅供网关内部 Provider 解析引用名;不暴露为节点 cmd */
  resolve(name: string): string | undefined
}
```

- **只写不读**:节点面只有 `Set/List/Delete`;任何接口(含 `~help`、返回值、审计留痕)不得回显明文。
- **落地**:值经 AES-256-GCM 加密后存 StateStore;主密钥 `TB_SECRET_ENCRYPTION_KEY` 为部署期 env-only(CF `wrangler secret` / Docker env)——信任根不自举存储。
- Case 2 的实际流程:Dashboard/CLI 先 `Set("s3-main", <SK>)`,再 `NodeRegistry.Write{kind:'context', config:{provider:'s3', authRef:'s3-main'}}`。

---

## §3. Tree 与 NodeRegistry

### 3.1 Node

```ts
interface Node {
  path: TreePath                        // 唯一键
  kind: 'directory' | 'mcp' | 'http' | 'builtin' | 'context' | 'device' | 'remote'
  description: string                   // 一句话;上级 ~help 列子节点时展示
  config?: NodeConfig                   // 按 kind 区分(§3.2)
  virtualize?: Virtualize               // 工具虚拟化(mcp/http 适用)
  registeredBy: string                  // keyId;device 节点由 Gateway 代写
  online?: boolean                      // 仅 device:连接状态
  createdAt: Timestamp
  updatedAt: Timestamp
}

interface Virtualize {
  prefix?: string                       // 工具名统一加前缀:纯字符串拼接,平台不注入分隔符,
                                        //   分隔符由配置者自带(惯例 "ns__");在 rename 之后
                                        //   应用——先 rename 再加 prefix(Phase 2 定型)
  rename?: Record<string, string>       // 原名 → 虚拟名
  hide?: string[]                       // 隐藏的工具名
  describe?: Record<string, string>     // description override
}
```

### 3.2 NodeConfig(按 kind)

```ts
type NodeConfig =
  | { kind: 'mcp',     url: string, authRef?: string }        // Streamable HTTP;authRef → SecretStore
  | { kind: 'http',    endpoint: string, tools: HttpToolDef[], authRef?: string,
      authHeader?: string,                                     // 认证头名;默认 "Authorization"(Phase 2 定型)
      authScheme?: string }                                    // 头值 scheme 前缀;默认 "Bearer",
                                                               //   空串 = 原样注入 secret 值
  | { kind: 'builtin', module: string }                        // "sk" | "secret" | "registry" | "plugin" | "status"
  | { kind: 'context', provider: string,                       // "r2"|"s3"|"file"|plugin id
      providerConfig?: Record<string, unknown>,                // bucket/AK 引用/根目录……密钥走 authRef
      authRef?: string, readOnly?: boolean, ttl?: number }     // ttl 秒:到期整节点回收(临时 namespace)
  | { kind: 'device',  deviceId: string, expose: DeviceExpose } // §6
  | { kind: 'remote',  baseUrl: string, skRef?: string }       // 联邦到任意 HTBP 服务(不限 tool-bridge
                                                               //   实例);baseUrl 白名单 + 环检测见 §3.4

interface HttpToolDef {
  name: string
  description: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  pathTemplate: string                  // 相对 endpoint;支持 {param} 占位
  inputSchema?: unknown                 // JSON Schema;~help 的数据源
  effect?: 'read' | 'write' | 'destructive'   // 与 §4.1 ToolDef.effect 同词汇;进 ~help 的
                                        //   effect 行;缺省派生:GET→read,其余→write
                                        //   (Phase 2 定型)
}
```

`authRef` / `skRef` 一律是 **SecretStore 引用名**(§2.5),不是明文——上游凭证只存网关侧,永不进 `~help`、不进返回值。

**context `providerConfig`(规范性,Phase 3 定型)**:r2 = `{ prefix?: string }`(bucket 即部署绑定,不入 config);s3 = `{ endpoint: string, bucket: string, region?: string /* 缺省 "auto" */, prefix?: string }` 且 `authRef` 必填;未知字段忽略。

### 3.3 NodeRegistry

```ts
interface NodeRegistry {                 // 挂载为 builtin 节点 system/registry
  List(prefix?: TreePath, opts?: ListOptions): Page<Node>
  Get(path: TreePath): Node
  Write(node: NodeInput): Node          // 挂载或整体替换;自动物化中间 directory(§1.1)
  Update(path: TreePath, patch: Partial<NodeInput>): Node
  Delete(path: TreePath): void          // 卸载;级联回收再无子节点的自动 directory
  Resolve(path: TreePath): { node: Node, rest: string }   // 最长前缀匹配;网关内部与调试用
}
type NodeInput = Omit<Node, 'registeredBy' | 'online' | 'createdAt' | 'updatedAt'>
```

判定:`Write/Update/Delete` → (path, 'register') + §2.4 路径规则;`List/Get/Resolve` → (path, 'read')。

**两条注册通道(规范性,Phase 1 定型回写)**:`POST <path>/~register`(§1.1)是**受限 SK 的注册通道**——判定只依赖 URL path 上的 (path, 'register') 动作 + §2.4 路径规则,不要求对 `system/registry` 可见;body 中的 `path` 必须等于 URL path,不一致 → `invalid_argument`(规范要求;当前实现未强制相等,该差距记为 TODO 留待下轮)。`system/registry` 数据面是**管理通道**——调用者须对 `system/registry` 可见(read)且持有 register/admin 动作。无 `system` 子树可见性的受限 SK 走 `~register`,不经 `system/registry`。

**自动物化 directory(规范性,Phase 1 定型回写)**:注册 `a/b/c` 时自动物化的中间 directory(`a`、`a/b`)记 `registeredBy: 'system:auto'`;§2.4d 的 conflict 判定对 `system:auto` 的 directory 不生效(任何 SK 都可在其下继续挂载,也可用显式 directory 覆盖其 description);`Delete` 级联回收仅回收 `system:auto` 且再无子节点的 directory,显式注册的 directory 不自动回收。

### 3.4 remote 节点语义(规范性)

`remote` 节点承载 TB.md 的 "Custom HTBP Server" / "Add TB Server":把**任意实现了 HTBP 控制面的服务**(不必是 tool-bridge)联邦为本树的一棵子树。

- **透传**:对 `<path>` 及其后代的 `~help`/`~skill`/`~tree`/`POST` 请求,改写为对 `baseUrl` 下相对路径的同形请求;`skRef` 解析出的凭证作为出站 `Authorization: Bearer`(本地调用者的 SK **不**外传)。
- **白名单**:`baseUrl` 必须匹配部署配置的 remote 白名单(§7 `remoteAllowlist`,host 后缀白名单;空/缺省 = 拒绝一切 remote 注册,Phase 2 定型),否则 `Write` 时即拒(`invalid_argument`)。
- **环检测**:出站请求携带 `X-TB-Via: <本实例标识>` 并追加既有链;收到含自身标识的入站 `X-TB-Via` → `unavailable(retryable:false)`。透传另设**跳数上限**:`X-TB-Via` 链段数超过 maxHops(默认 4,§7 `maxHops`)→ `unavailable(retryable:false)`;`~tree` 聚合时对 remote 子树计入 §1.1 的深度/节点上限。**已知局限**:环检测依赖链路各方转发 `X-TB-Via`——夹带不转发该头的第三方 HTBP 服务时,环不可被协议检出;`baseUrl` 白名单是主要防线,跳数上限是兜底。
- **权限**:本地 Auth 先判(path, action),通过后才透传;远端的再次判定属远端职责——两级都可拒。

---

## §4. Tool Layer

### 4.1 ToolProvider(Plugin 接口)

```ts
interface ToolProvider {
  /** 枚举该源的全部工具(虚拟化前的原始名;网关做映射)。
   *  工具源集合天然小(≤数百),返回全量数组,豁免 §0.4 的分页要求 */
  List(): ToolMeta[]
  /** 单个工具的完整 schema/描述 —— ~help 的数据源 */
  Get(name: string): ToolDef
  /** 调用 */
  Call(name: string, args: Record<string, unknown>): ToolResult
}

interface ToolMeta { name: string, description: string }
interface ToolDef extends ToolMeta {
  inputSchema?: unknown                 // JSON Schema
  effect?: 'read' | 'write' | 'destructive'   // ~help 的 effect/confirm 属性来源
}
interface ToolResult {
  content: string | unknown             // markdown 文本或结构化 JSON(按 §1.2 协商输出)
  isError?: boolean
}
```

### 4.2 内置 Provider 义务

- **mcp**:经官方 MCP SDK(Streamable HTTP)连接 `config.url`;`List/Get` 映射 `tools/list`,`Call` 映射 `tools/call`。**会话一次性(Phase 2 定型)**:每次调用完整握手(initialize → initialized → 操作 → finally DELETE session),不跨请求复用;上游返回 404(会话失效)时重建会话重试一次(与 Reference §3 对齐);跨请求会话复用留待未来(若需要,sessionId 落 StateStore)。**`~help` 缓存(Phase 2 定型)**:上游 `tools/list` 结果缓存于 StateStore,key `toolcache:<path>` → `{ tools, fetchedAt }`,TTL 默认 300s(env `TB_TOOL_CACHE_TTL`,秒);失效触发三者:TTL 到期、该节点的 `NodeRegistry` Write/Update/Delete、`GET <path>/~help?refresh=1`(需 read 权限)。
- **http**:按 `HttpToolDef` 拼请求(`{param}` 从 args 取,剩余 args 按 method 入 query/body);`authRef` 解析后注入认证头(头名/scheme 见 §3.2 `authHeader`/`authScheme`);响应透传为 `ToolResult`。
- **builtin**:`system/*` 模块的进程内直调;`~help` 由模块静态声明。**cmd 命名(规范性,Phase 1 定型回写)**:builtin 的 cmd 名与接口方法名对齐(小写:`list` / `get` / `write` / `update` / `delete` / `set`……);CLI 层的 `create`/`rm` 等人性化别名由 CLI 翻译,不进入 `~help`。`system/status` 模块的 cmd 集合:`get`(scope read,免 admin——返回 `{ healthy, version, nodeCount, uptime? }` 健康摘要,`tb status` 登录态下的数据源)。

**上游错误归一(规范性,Phase 2 定型)**:mcp/http Provider 在单一 choke point 把上游传输/协议错误归一为 TBError(§0.2)——上游网络失败 / 5xx / 超时 / 会话重建仍失败 → `unavailable`(retryable: true);上游 4xx(我方拼装错误或上游拒绝)→ `internal`(retryable: false,message 携带上游状态码与摘要,不透传上游 body 原文以防泄漏);MCP RPC 业务错误(`result.isError` / JSON-RPC error)不是 TBError——正常 HTTP 200,落 `ToolResult.isError: true`(§4.1),按 §1.2 协商渲染。

**上游 https 强制(规范性,Phase 2 定型)**:mcp / http / remote 的上游 endpoint(`url` / `endpoint` / `baseUrl`)强制 `https://`;仅当 env `TB_ALLOW_INSECURE_HTTP=true` 时放行 `http://`(仅限本地开发);remote 另叠加 §3.4 白名单。

---

## §5. Context Layer

### 5.1 ContextProvider(Plugin 接口——核心四动词)

**每个 Context Provider 必须实现以下四个核心接口(可选能力见其后 `ContextProviderOptional`,须在 `~describe` 的 capabilities 中声明)**:

```ts
interface ContextProvider {
  /** 枚举条目(浅层列表 + 分页)。path 为 namespace 内相对路径前缀 */
  List(path: string, opts?: ListOptions): Page<ContextEntryMeta>
  /** 读取单个条目(含内容) */
  Get(path: string): ContextEntry
  /** 部分更新:patch 已存在条目的内容或 metadata;不存在 → not_found */
  Update(path: string, patch: ContextPatch): ContextEntryMeta
  /** 创建或整体替换条目(幂等 upsert) */
  Write(path: string, entry: ContextEntryInput): ContextEntryMeta
}

/** 可选能力(capability 声明于 ~describe;调用方先探测再用) */
interface ContextProviderOptional {
  Search?(query: string, opts?: SearchOptions): Page<ContextEntryMeta>
  Watch?(path: string): { watchId: string }
  Delete?(path: string): void
}
interface SearchOptions extends ListOptions {
  mode?: 'keyword' | 'semantic'         // 缺省 keyword;semantic 需在 capabilities
                                        //   声明 "search:semantic",未声明 → invalid_argument
}
```

```ts
interface ContextEntryMeta {
  uri: string                           // node://<namespace-path>/<entry-path>
  contentType: string                   // "text/markdown" | "application/json" | ...
  size?: number
  version: string                       // 乐观并发:Update/Write 可携带 ifVersion
  updatedAt: Timestamp
  metadata: Record<string, string>
}
interface ContextEntry extends ContextEntryMeta {
  content: string | unknown             // 文本或 JSON;大对象返回 { $ref: <URL> }
                                        //   (阈值与 URL 形态见 §5.2,Phase 3 定型)
}
interface ContextEntryInput {
  contentType: string
  content: string | unknown
  metadata?: Record<string, string>
  ifVersion?: string                    // 不匹配 → conflict
}
interface ContextPatch {
  content?: string | unknown
  metadata?: Record<string, string>     // 浅合并
  ifVersion?: string
}
```

**List 浅层目录表示(规范性,Phase 3 定型)**:`List` 是以 `/` 为分隔的浅层列举;子目录以 `ContextEntryMeta` 形式返回——`uri` 尾带 `/`、`contentType: "application/x-directory"`、无 `size`、`version: ""`。

### 5.2 内置 Provider 义务

- **r2**:R2 绑定读写;`List` = 前缀列举,`version` = etag。**预签名注意**:R2 binding 本身不支持 presign——`$ref` 预签名统一经 R2 的 S3 兼容端点生成(aws4fetch + R2 Access Key,`tb init` provision 时创建并 `SecretStore.Set`);未配置该凭证时退化为网关中转下载路由(带鉴权代理,牺牲直连带宽不牺牲功能)。
- **s3**:任意 S3 兼容端点(Case 2 的 AK/SK 经 `authRef` 引用);义务同 r2。
- **file**:本地目录(仅 node 宿主:Docker 部署与设备 fs 复用);`List` = readdir,`Search(keyword)` = 名称/内容 grep,路径穿越必须拒绝(规范性:解析后必须仍在根内)。
- 三者的 `Search(keyword)` 为内置基线能力;`semantic` 由声明了 `search:semantic` 的 Provider(如 Vectorize 后端 Plugin)提供。

**$ref 阈值与内联类型(规范性,Phase 3 定型)**:`Get` 内联返回仅限 `contentType` 为 `text/*` 或 `application/json` 且 size ≤ 阈值(缺省 1 MiB,部署配置 `TB_REF_THRESHOLD_BYTES` 可调)的条目;其余(超限或二进制类型)`Get` 返回 `{ $ref: <URL> }`。

**中转下载路由(规范性,Phase 3 定型)**:presign 凭证空缺时,`$ref` 指向网关**树外免认证端点** `GET /~ref/<token>`(与 `/healthz` 同级树外);token 为 HMAC-SHA256(密钥派生自 `TB_SECRET_ENCRYPTION_KEY`)签名的 `{key, exp}` 载荷,base64url 编码;验签失败或过期 → 404;有效期与 presign 相同(缺省 900s,`TB_REF_TTL_SEC` 可调)。语义与预签名 URL 对齐:限时、免 SK、不可伪造。

**r2 presign 凭证链(规范性,Phase 3 定型)**:按序解析 SecretStore 保留引用名 `r2-presign` → env `TB_R2_ACCESS_KEY_ID`/`TB_R2_SECRET_ACCESS_KEY` → 均无则 `$ref` 走 `/~ref` 中转。S3 兼容端点与 bucket 经部署配置 `TB_R2_S3_ENDPOINT`(provision 从 `CLOUDFLARE_ACCOUNT_ID` 派生 `https://<account>.r2.cloudflarestorage.com`)与 `TB_R2_BUCKET`;Phase 6 `tb init` 自动创建凭证并 `SecretStore.Set`,Phase 3 为手动路径。

**S3 类 authRef 凭证值形状(规范性,Phase 3 定型)**:secret 值为 JSON `{"accessKeyId":"...","secretAccessKey":"..."}`;解析失败 → `invalid_argument`(message 不含值)。

**Search(keyword) 基线范围(规范性,Phase 3 定型)**:r2/s3 的 keyword 匹配 entry 路径名与 metadata 值(子串,大小写不敏感),不拉取对象内容(Workers 子请求上限约束);file provider(node 宿主)才做名称+内容 grep。

### 5.3 挂载

namespace 挂载 = `NodeRegistry.Write{kind:'context'}`(§3.2),无独立 Registry。`ttl` 到期由网关回收整个节点(临时 namespace);`readOnly` 挂载对 `write` 动作直接 `permission_denied`。

**ttl 懒回收(规范性,Phase 3 定型)**:回收时机为**下次访问**——`~help`/`~describe`/`POST` 调用/`~tree` 列举命中该节点时判定 `createdAt + ttl` 过期 → 网关删除节点并返回 `not_found`;无后台定时任务。

**readOnly 的 `~help` 表现(规范性,Phase 3 定型)**:readOnly 挂载的 `~help` 不列出 `Write`/`Update`/`Delete` cmd(隐藏),对写动词调用仍返回 `permission_denied`(双保险)。

**s3 挂载连通探测(规范性,Phase 3 定型)**:`kind:'context'` 且 `provider:'s3'` 的节点在 `Write`(挂载)时做一次浅 `List` 探测,失败 → `unavailable(retryable:true)` 拒挂;r2/file 不需。

**entry 非 Node(规范性,Phase 3 定型)**:context entry 不是树节点——`/<ns>/<entry>` 的 `~help`/`~tree`/`POST` 一律 `not_found`;entry 仅经 namespace 节点四动词的 `arguments.path` 访问;`~tree` 不列 entries。

---

## §6. Device Gateway(反向注册)

### 6.1 连接建立

```
WS wss://<base>/system/device/ws
  握手头:Authorization: Bearer <SK>
  判定:Check(sk, node://<mountPath>, register) + §2.4 路径规则
```

`mountPath` 缺省为 `device/<deviceId>`;SK 的 `registerPaths` 可将其约束到指定前缀之下。未声明 `registerPaths` 的 SK 因 `device` 非保留根路径而默认可挂(§2.4b)——仍需 (mountPath, 'register') 的 scope 判定通过。

### 6.2 帧协议(规范性)

JSON 文本帧,`type` 区分;以下帧类型合称 **`DeviceFrame`**(即 §7 `DeviceConn` 的传输单元)。所有请求/响应帧带 `id`(requestId)做关联与幂等:

```ts
// 设备 → 网关(连接后第一帧)
{ type: 'hello', deviceId: string, expose: DeviceExpose }
interface DeviceExpose {
  shell?: { description?: string }                 // 挂 <mountPath>/shell(工具节点)
  fs?:    { roots: string[], readOnly?: boolean }  // 挂 <mountPath>/fs(context 节点,file provider)
  nodes?: NodeInput[]                              // SDK 自定义节点(路径相对 mountPath)
}

// 网关 → 设备:hello 确认(含挂载结果)或拒绝(TBError 后关闭)
{ type: 'ready', mountPath: string }

// 网关 → 设备:调用转发
{ type: 'call', id: string, path: string,          // 相对 mountPath,如 "shell"
  tool: string, arguments: Record<string, unknown> }

// 设备 → 网关:调用结果(与 call 的 id 对应)
{ type: 'result', id: string, ok: true,  value: unknown }
{ type: 'result', id: string, ok: false, error: TBError }

// 双向心跳
{ type: 'ping' } / { type: 'pong' }
```

`DeviceExpose` 与 TB.md「Device > Tool / Context / File」的对应(追溯):**Tool** → `shell`(及 `nodes` 中的工具节点)、**File** → `fs`、**Context** → `nodes` 中的 context 节点(设备侧任意 ContextProvider,不限于文件——如设备本地 DB、内存缓存)。

义务:网关侧调用默认超时 60s(shell 可在节点配置放宽),超时向调用方返回 `unavailable(retryable)` 并向设备发送取消提示帧 `{type:'cancel', id}`;设备对重复 `id` 的 `call` 必须幂等(以首次执行的结果应答)。

### 6.3 生命周期

- `ready` 后,网关代写 NodeRegistry:`<mountPath>`(directory,`online:true`)+ expose 声明的子节点。
- 断线:节点保留、标记 `online:false`,调用返回 §0.2 的设备离线错误;重连(同 deviceId + 同 SK)恢复 `online:true`。
- 超过回收期(默认 24h,可配)未重连 → 自动 `Delete` 该子树。
- `shell` 工具契约:`cmd exec`,args `{ command: string, cwd?: string, timeoutMs?: number }`,返回 `{ stdout, stderr, exitCode }`;`~help` 必须标注 `effect destructive` + `confirm`。
- `fs` context 契约:即 §5 的 file provider 语义,root 为 expose 声明的 roots。

---

## §7. SDK

SDK 是核心逻辑的库形态;公开面与本文接口一一对应,不存在私有通道。

```ts
/** 嵌入式运行一个 TB 实例(Node / Workers 均可) */
function createToolBridge(config: {
  state: StateStore                     // 树配置 / SK / manifest 的存取(宿主注入)
  objects?: ObjectStore                 // context 对象(宿主注入)
  secrets?: SecretStore                 // §2.5 上游凭证(宿主注入;缺省实现 = 基于 state 的加密存储,
                                        //   同样要求主密钥——env TB_SECRET_ENCRYPTION_KEY 或
                                        //   config 显式传入;两者皆无 → secret 能力禁用,Set 返回
                                        //   unavailable,与 §2.5 一致)
  deviceTransport?: DeviceTransport     // §6 设备 WS 的网关侧宿主(未注入则 device 能力禁用)
  reservedRoots?: string[]              // §2.4 b 的追加保留根路径
  remoteAllowlist?: string[]            // §3.4 remote baseUrl 的 host 后缀白名单;空/缺省 =
                                        //   拒绝一切 remote 注册(Phase 2 定型;CF 宿主经
                                        //   env TB_REMOTE_ALLOWLIST 逗号分隔注入)
  maxHops?: number                      // §3.4 X-TB-Via 跳数上限;默认 4(Phase 2 定型;
                                        //   CF 宿主经 env TB_MAX_HOPS 注入)
}): ToolBridge

interface ToolBridge {
  /** Hono 实例:挂到任意宿主(Workers export / @hono/node-server / 已有 app.route) */
  fetch(req: Request): Response

  /** 程序化注册:本地实现 Provider 挂上树(等价 NodeRegistry.Write) */
  registerTool(path: TreePath, provider: ToolProvider, meta?: Partial<NodeInput>): void
  registerContext(path: TreePath, provider: ContextProvider, meta?: Partial<NodeInput>): void

  /** 反向连接(HTTP → WebSocket):把本实例的节点挂到远程 TB(§6 的设备侧实现) */
  connect(remoteBaseUrl: string, sk: string, opts?: {
    deviceId?: string, mountPath?: TreePath, expose?: DeviceExpose
  }): Connection
}
interface Connection { close(): void, readonly state: 'connecting'|'ready'|'reconnecting'|'closed' }
```

宿主抽象(M10)——**共四个注入点:StateStore / ObjectStore / SecretStore(§2.5)/ DeviceTransport**,核心业务逻辑零分叉:

```ts
interface StateStore {                  // CF=KV / Docker=SQLite / SDK 内嵌=内存或自供
  get(key: string): unknown | null
  put(key: string, value: unknown): void
  delete(key: string): void
  list(prefix: string, opts?: ListOptions): Page<{ key: string, value: unknown }>
}
interface ObjectMeta {                  // Phase 3 定型:签名修订——R2/S3 宿主均为异步 API,
                                        //   Context 四动词需要 etag 条件写与用户 metadata,
                                        //   Workers 无同步 I/O,故显式 Promise + 完整 meta
  key: string
  etag: string                    // = ContextEntryMeta.version
  size: number
  contentType?: string
  updatedAt: Timestamp
  metadata: Record<string, string>
}
interface ObjectStore {                 // CF=R2 / Docker=FS 或 S3
  head(key: string): Promise<ObjectMeta | null>
  get(key: string): Promise<{ meta: ObjectMeta, body: ReadableStream } | null>
  put(key: string, body: BodyInit, opts?: {
    contentType?: string, metadata?: Record<string, string>,
    ifMatchEtag?: string          // 不匹配 → conflict(乐观并发落点)
  }): Promise<ObjectMeta>
  delete(key: string): Promise<void>
  list(prefix: string, opts?: ListOptions & { delimiter?: string }):
    Promise<Page<ObjectMeta | { prefix: string }>>   // delimiter 时返回子前缀
  presign?(key: string, ttlSec: number): Promise<string>   // 可选:$ref 大对象路径
}
interface DeviceTransport {             // 网关侧 WS 宿主:CF = DeviceSession DO(hibernation)/ Docker = ws
  onConnection(handler: (conn: DeviceConn) => void): void
}
interface DeviceConn {                  // 承载 §6.2 的 DeviceFrame
  readonly authorization?: string       // 握手 Authorization 头(Bearer SK)
  send(frame: DeviceFrame): void
  onFrame(handler: (frame: DeviceFrame) => void): void
  onClose(handler: () => void): void
  close(code?: number): void
}
```

---

## §8. Plugin System

### 8.1 PluginRegistry

```ts
interface PluginRegistry {              // 挂载为 builtin 节点 system/plugin;需 admin
  List(opts?: ListOptions): Page<PluginManifest>
  Get(id: string): PluginManifest
  Write(manifest: PluginManifest): PluginRegistration
  Update(id: string, patch: Partial<PluginManifest>): PluginManifest
  Delete(id: string): void
}

interface PluginManifest {
  id: string
  kind: 'tool-provider' | 'context-provider'
  interfaceVersion: string              // "tool-provider/v1" | "context-provider/v1"
  endpoint: string                      // https:// 或 binding:<name>(平台内 service binding)
  auth: { kind: 'platform-token' } | { kind: 'bearer', secretRef: string }
  healthPath: string                    // 如 "/healthz"
  enabled: boolean
}
interface PluginRegistration extends PluginManifest {
  pluginToken?: string                  // Plugin 回调平台用(scope 按需);仅注册响应出现一次
}
```

注册时平台自动:探活(`healthPath`)→ 抓 `~help`/`~describe` 做契约校验(方法集合与 `interfaceVersion` 不符则拒绝)→ 可被 `NodeRegistry.Write` 以 `provider: <plugin-id>` 引用挂载。

### 8.2 PluginLifecycle(每个 Plugin 必须实现)

```
GET {endpoint}{healthPath}   → { "healthy": true }
GET {endpoint}/~describe     → { "kind": "context-provider",
                                 "interfaceVersion": "context-provider/v1",
                                 "capabilities": ["search", "search:semantic"] }
GET {endpoint}/~help         → 方法集合的 Help DSL(注册时契约校验)
```

未声明的可选方法平台永远不会调用;平台周期性探活,连续失败标记 unhealthy 并在 Dashboard 告警,不自动注销。

### 8.3 传输契约(平台 → Plugin,规范性)

与 §1.4 的节点调用形态完全一致:

```
POST {endpoint}
Authorization: Bearer <见 manifest.auth>
X-TB-Context: <CallContext JSON,base64url>   # 平台透传调用上下文(唯一载体,body 不重复)
X-TB-Request-Id: <每次逻辑调用唯一;重试时不变,Plugin 以此去重实现幂等>

{"tool": "<Method>", "arguments": { ...方法参数按名传递,opts 整体传不平铺... }}

→ 200 <返回值> | 4xx/5xx TBError
```

大载荷:单次请求/响应 ≤ 1 MiB,更大内容经 `{ "$ref": <URL> }` 间接传递。超时:默认 30s;Plugin 需在超时内响应或返回 `retryable` 错误。

---

## 附A. CLI 命令 ↔ 接口矩阵

| 命令 | 背后接口 |
|---|---|
| `tb init` | M10 部署向导 + §2.3 Admin SK 引导 |
| `tb login/whoami/use` | 本地凭据管理(无服务端接口;实现注记见表后) |
| `tb status` | builtin `system/status`(§4.2 `get`;登录态)/ 树外 `GET /healthz`(§1.1;未登录与 Phase 0 回退) |
| `tb ls/tree/help` | §1.1 `~help`/`~tree` |
| `tb call` | §1.4 节点调用 |
| `tb tool mount/rm` | §3.3 `NodeRegistry.Write/Delete`(kind=mcp/http) |
| `tb server add/ls/rm` | §3.3 `NodeRegistry.*`(kind=remote,§3.4) |
| `tb ctx ls/cat/put/patch/search` | §5.1 四动词 + Search |
| `tb ctx mount/unmount` | §3.3(kind=context) |
| `tb connect` / `tb mount fs` | §7 `connect` / §6 帧协议 |
| `tb device ls` | §3.3 `List(prefix="device")` |
| `tb sk list/create/rm` | §2.3 `SKRegistry.*`(`create` 含签发带 `register` 作用域 + `registerPaths` 的 SK——即 TB.md「Allow 反向注册」的管理动作) |
| `tb secret set/ls/rm` | §2.5 `SecretStore.Set/List/Delete`(authRef/skRef 的来源) |
| `tb plugin register/list/health` | §8.1/§8.2 |

> **CLI 实现注记(Phase 1 定型回写)**:① `tb whoami` 语义 = 本地配置态 + 网关可达性——显示 baseUrl 与打码后的 SK,经 `~help` 探测认证有效性,可用时附 `system/status` 健康摘要(网关无自省端点);② CLI 配置文件为 `~/.config/tool-bridge/config.json`(XDG 布局,多 profile 结构);③ 交互输入用 Node readline,`@clack/prompts` 留待 `tb init` 向导(Phase 6)——Reference §5 的选型陈述以本注记为准,不回改 Reference。

## 附B. 接口 ↔ User Case 追溯矩阵

| 接口/机制 | 支撑的 Case |
|---|---|
| §2.3 Admin SK 引导 + `system/status` | 1(初始化) |
| §3.3 `NodeRegistry.Write{kind:'context'}` + §5.2 s3 | 2(添加 Context,AK/SK 配置) |
| §6 帧协议 + §2.4 路径规则 + shell/fs 契约 | 3(反向注册) |
| §3.4 remote 节点(联邦透传、白名单、环检测) | 5④(Custom HTBP Server / "Add TB Server") |
| §7 StateStore/ObjectStore 宿主抽象 | 4(CF/Docker 双部署) |
| §1.1 `~help` 每级可发现 + §1.2 内容协商 + §2.3 可见性裁剪 | 5(Agent)、6(Dashboard)、7(CLI) |
| §1.1 `/~tree?depth=N` | 6(Dashboard 导航)、5(Agent 建图) |
| §2.2 Scope(pattern×actions) | 全部(TB.md 注意 1) |
