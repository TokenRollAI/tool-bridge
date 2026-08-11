# 协议契约参考(HTBP as implemented)

> 用途:引用接口契约、错误码、数据模型、CLI 命令矩阵时的查表文档。真源是代码(core `htbp/`/`types.ts` 与 gateway `tbApp.ts`);bootstrap 期规范原文见 `archive/docs/Proto.md`(历史,不再维护)。更新时机:契约变化时。

## 1. 端点面

| 端点 | 语义 |
|---|---|
| `GET /healthz` | 树外免认证运维端点,200 + `{"healthy":true,"version":"<x.y.z>"}` |
| `POST /~mcp` | **MCP consumer endpoint**:需 Bearer SK 的无状态 Streamable HTTP(JSON response)端点;支持 MCP `initialize`、`tools/list`、`tools/call`,并以稳定合成 tools 暴露 Search/Help/List;每次请求均按当前身份重新投影 HTBP 树,不依赖 isolate 内会话状态 |
| `POST /~search` | **root-only 全局工具搜索**:需 Bearer SK;仅宿主注入声明 `search` capability 的 `SearchIndex` 时存在,请求/返回/权限细则见 1b;`POST /<path>/~search` 一律 404 |
| `GET /<path>/~help` | 节点自描述;默认 `text/markdown` 可读表现,`Accept: application/json` 得等价 `HelpJson`,`Accept: text/plain` 得紧凑 Help DSL(面向 LLM 省 token)。**两级披露**:节点 `~help` 是索引,`GET /<node>/<tool>/~help` 给单工具全量 spec |
| `GET /~tree?depth=N` | 受限深度树视图(默认 2,上限 8 钳制;节点上限 500);子树根必须真实存在,非根不存在 → 404 |
| `GET /<path>/~skill` | 本地 501 占位(`unavailable`,retryable:false);remote 节点透传 |
| `GET /<path>/~describe` | 有可选能力的节点返回 `{ kind, capabilities }`;根 `GET /~describe` 仅在注入全局 SearchIndex 且声明 `search` 时返回 `{kind:'directory',capabilities:['search',...可选 'search:semantic']}`;其余 404 |
| `GET /<path>/~feedback` | Agent 反馈列表 `{items:[{id,title,by,at,up,down,score}]}`(净分降序、at 降序 tie-break;`?hidden=1` 含净分 ≤ -3 的隐藏条目;不含 detail);`GET /<path>/~feedback/<id>` 单条详情(含 detail)。read 判不过 → 404 不泄露存在性;根路径无此端点 |
| `POST /<path>/~feedback` | 提交反馈,body `{title(≤80), detail(≤500)}`,需 `call`(权限判定落目标 path,窄 scope SK 对够得着的路径天然可反馈);path 须 registry 最长前缀 resolve 命中(工具子路径合法);每 (path, owner) ≤ 10 条 → 429。`POST /<path>/~feedback/<id>` body `{vote:"up"\|"down"\|"clear"}` 投票(每身份一票、改票覆盖、clear 撤票);`DELETE /<path>/~feedback/<id>` 删除(admin)。头部条目(净分 > -3 前 5)由网关注入该 path 的 `~help` feedback 块 |
| `POST /<path>` | 数据面调用,body `{"tool","arguments"}`;`opts` 整体传不平铺 |
| `POST /<node>/<tool>` | **直连工具调用**(mcp/http/tool 节点,含 device 自定义 tool):tool 名取自 URL 末段(虚拟名),body 即 arguments 本体(可空 = `{}`;非对象 → 400)。`~help` 宣告的即此形态;信封入口仍受理。多余路径段/未知工具 → 404 |
| `POST /<path>/~register` | 自助反向注册(受限 SK 通道),等价 `NodeRegistry.Write`;body.path 必须等于 URL path,kind 必填 |
| `POST /<path>/~authorize` | mcp 托管 OAuth 发起(节点须 `config.auth:'oauth'`;需 read+register):有有效凭证(静默刷新成功)→ `{status:'authorized'}`;否则 `{status:'redirect', authorizationUrl}`(URL 内嵌 AES-GCM 加密 state,含 PKCE code_verifier)。可选 body `{redirectUri}`(仅 loopback):严格上游 DCR 只放行 localhost 回调时的本地回调通道,state 载荷带 r 供兑换复用 |
| `GET /~oauth/callback?code&state` | OAuth 授权回调,树外免认证(state 即凭证,解不开/过期/节点不符一律拒);兑换 code → token 落 StateStore,返回一次性 HTML 结果页 |
| `GET /~ref/<token>` | 大对象网关中转下载,树外免认证(HMAC token 即授权,有效期缺省 900s,篡改 → 404) |
| `WS /system/device/ws?deviceId=<id>` | 设备通道升级(Bearer SK);mountPath 缺省 `device/<deviceId>` |
| `GET /ui` | Dashboard 静态资源(免认证,SPA 回退严格限定 `/ui`) |

保留段:`~help / ~skill / ~tree / ~register / ~describe / ~authorize / ~feedback / ~mcp / ~search`;保留根:`system`、`ui`(部署配置可追加)。注册 `a/b/c` 时 `a`、`a/b`、`a/b/c` 三级 `~help` 都必须可达(中间 directory 自动物化)。**注意 `~skill`(保留段,节点使用指南,当前本地 501 占位)与 `skillhub`(节点 kind)是两个正交概念:前者是任意节点的一个 GET 保留路径段,后者是内容型 kind 的判别值,互不冲突。**

## 1a. MCP consumer endpoint 投影

- `POST /~mcp` 位于统一 Bearer 认证中间件之后。服务端使用 MCP SDK 的 Web-standard Streamable HTTP transport,每个 HTTP 请求创建独立 server/transport 并启用 JSON response;server identity = `tool-bridge` + 当前 gateway 版本,capabilities = `{tools:{}}`。
- MCP 仍只声明标准 `tools` capability;HTBP 发现面以三个稳定、只读的合成工具加入同一次 `tools/list`:
  - `tb_search`(仅 SearchIndex 声明 `search` 时存在):`{query,mode?,limit?,cursor?}` → 内部 `POST /~search`。
  - `tb_help`:`{path?,tool?,format?:'json'|'markdown'|'dsl'}` → 内部 `GET /<path>[/<tool>]/~help`;tool detail 要求 path 非根且 tool 为单路径段。
  - `tb_list_nodes`:`{path?,depth?:0..8}` → 内部 JSON `GET /<path>/~tree?depth=N`。
  三者携原请求 Bearer 重新进入 Hono 认证/授权路由;JSON 结果同时进入 MCP `structuredContent`,markdown/DSL 保持 text content,HTTP 业务错误映射为 `isError:true`。它们不是新的权限或存储实现。
- `tools/list` 每次从当前树动态生成,不缓存跨请求授权结果。本地节点先要求路径 `read`,再按命令声明的 `scope`(tool provider/device tool 为 `call`)调用 `Authorizer.Check`;因此只读 SK 看不到不可调用工具,context/builtin 等多命令节点只暴露该身份获准的命令。
- 覆盖面包括本地注册树中的 tool provider、device tool、builtin/context/skillhub 等 HelpModel 命令,以及 `remote` 挂载下递归发现的子树。本地 registry 最长前缀所有者优先:若 remote 后代路径已有本地节点覆盖,该分支不再从远端发现,而按本地节点投影。
- remote 路径必须同时通过本地挂载路径的 `read`、`call` 以及命令声明 `scope` 三重检查;路径、命令和详细 schema 重定位到本地挂载前缀,不向消费方泄露远端基址。远端 `~tree`/`~help` 的 node/child/command path 均须为 canonical 相对 TreePath、匹配请求路径和直接父子/节点归属;`.`/`..`、编码点段、空/保留/控制段一律在后续凭证化 fetch 前 fail closed。单次 MCP 请求的 remote discovery 上限为深度 8、节点 500、远端请求 32(包含 `~tree`/`~help`/详细 schema 请求);任一超限均以不可用错误 fail closed,不返回不完整工具集。
- `tools/call` 会以当前身份重新生成同一投影并按 MCP 工具名查找;不存在或已失权的名称返回 MCP `InvalidParams`。本地 `mcp/http/tool` Provider 重新校验 read+call、解析最新虚拟化映射后直接调用 typed `provider.call`,保留原生 MCP `isError`、content blocks 与 `structuredContent`;其余本地 HTBP 命令按 HelpModel 路径复用既有 Hono 分派,remote tool 重定位后仍走本地节点 `{tool,arguments}` 信封,不另开权限或转发旁路。
- 普通 HTBP MCP tool `name` 的 identity 是 `[invokePath,toolName,'envelope'|'flat']` JSON tuple,再做单射 UTF-8 字节编码并加 `tb_` 前缀;下划线双写,其余不在 `[A-Za-z0-9.-]` 的字节编码为 `_xx`。名称最长 128 字符;超长 identity 保留编码前缀并附完整 SHA-256 hex。三个控制工具例外使用保留稳定名 `tb_search`/`tb_help`/`tb_list_nodes`;重复 identity 或任何最终名称碰撞均 fail closed。
- MCP tool 字段约定:
  - `description`:原描述 + `HTBP <invokePath>`;缺描述时仅保留 HTBP 路径。
  - `inputSchema`:缺省为 `{type:'object',properties:{}}`;已有 schema 必须是 object 根,并强制根 `type:'object'`。投影先经 MCP `ToolSchema` 校验,再由 `CfWorkerJsonSchemaValidator` 编译;非法 tool/schema 以 MCP internal error fail closed。
  - `annotations`:HTBP `effect:read` → `readOnlyHint:true`;`write|destructive` → `readOnlyHint:false`;`destructive` 或 `confirm:true` → `destructiveHint:true`。
  - `_meta['io.tool-bridge/path']`:本地源节点路径;`_meta['io.tool-bridge/command']`:原 HTBP 命令/工具名。
- `tools/call` 在任何 Provider/Hono 调用前以已编译 schema 校验 `arguments`;失败返回 MCP `InvalidParams`,不触发下游。结果再经 MCP `CallToolResultSchema` 校验:typed Provider 的合法 content blocks 原样保留,普通字符串/JSON 转为 text content,显式 `structuredContent` 优先保留(否则顶层对象自动补入),业务错误保留 `isError:true`;非法结果以 internal error fail closed。

## 1b. root 全局工具搜索

- 请求固定为 `POST /~search` + JSON `{query,opts?:{mode?:'keyword'|'semantic',limit?:number,cursor?:string}}`;body 只接受 `query`/`opts`,opts 只接受 `mode`/`limit`/`cursor`,query 须为非空字符串并在传给索引前 trim。`limit` 与其它 List/Page 契约一致:缺省或 `<1` 为 50,整数上限钳到 200;非整数、非字符串 cursor、多余字段与未知 mode 均返回 400 `invalid_argument`。当前不接受 filter。
- `mode` 缺省为 `keyword`。宿主注入的 `SearchIndex.capabilities` 必须先声明基础 `search`;未注入或未声明时 `/~search` 与根 `/~describe` 都是 404。`semantic` 另须声明 `search:semantic`,否则 400;声明限定 capability 不能替代基础 `search`。
- 返回 JSON `Page<{path,tool}>` = `{items,cursor?}`。adapter 每批最多取 100 个轻量候选;网关在单请求最多扫描 400 个 raw candidates,批量回读 registry 后逐条做节点路径 `read` + `call`、kind/config=`mcp|http|tool` 与 virtualize hide 判定。通过后从 canonical HTTP/device config 或批量 tool cache 按 raw name 水合完整 `ToolSpec`,再应用 prefix/rename/description。单页完整 ToolSpec JSON 总量上限 4 MiB,因此结果可少于 limit 并以 cursor 续取;索引漂移候选直接丢弃,不会返回旧工具定义。
- cursor 是宿主 secret 下的 AES-GCM opaque token,绑定 trim 后 query、mode、索引 revision 与 raw offset;篡改、换 query/mode、索引发生 material change 或 offset 越界均返回 400。cursor 在权限/virtualize 后的实际消费边界生成;若本页 raw 命中全部不可见而返回空 items,必须省略 cursor,不泄露隐藏结果仍存在。
- 当前只支持**本地** `mcp`/`http`/`tool` 节点候选;`tool` 包括能提供 raw ToolSpec 的 plugin/进程内/device 自定义 tool。remote、device shell、builtin、context、skillhub、directory 均不进入结果。
- core 将只读 `SearchIndex` 与 `MutableSearchIndex` 写面分开;后者用完整节点 snapshot 的 `replace`/`remove`、subtree `removePrefix` 与全量 `rebuild`。StateStore/registry/provider cache 是 canonical,SearchIndex 是可重建派生状态:registry write/update/delete、动态 MCP/tool fresh list、device hello/reclaim 与 node-level feedback submit/vote/delete 都触发热同步;每次搜索前仍执行有界 canonical audit,同 digest 不 bump revision。
- 只有 owning node 的非隐藏 feedback top 5 进入搜索,投影 title+detail,合并文本经控制字符清理并限制为 256 UTF-8 bytes;工具子路径 feedback 不进入 owning node。keyword 排序权重固定为 name/description/feedback = 10/3/1。v3 source 只存 path、raw name、feedback 与最多 1024 UTF-8 bytes 的 description;完整、未虚拟化 `ToolSpec` 只参与 snapshot digest并留在 canonical state。
- 已内置 keyword adapter:Workers 使用可选 `TB_SEARCH` D1 binding,Node 使用同一 `state.sqlite3` 的独立连接与独立表;两者均使用 v3 lightweight source/FTS/meta/snapshot schema 与共享 contract。v2 full-row 表不迁入 v3,新 meta 初始 unseeded并由首次 canonical audit重建,旧 cursor 自然失效。query trim 后按 whitespace 切 term并按 Unicode code point 计数:长词(≥3)走 trigram FTS literal phrase,短词(<3)走参数化 escaped LIKE;混合查询对两侧 AND,最多 32 terms。当前仅实现 keyword;semantic 与 filter 留后续。共享开发环境已完成 v3 canonical 重建、飞书长描述目录与 CLI/Dashboard/MCP 对拍;外部 HTBP Draft 同步仍 PENDING。
- CLI `tb search <query> [--mode keyword|semantic] [--limit 1..200] [--cursor <opaque>]` 直接 `POST /~search`,请求体是上述 `{query,opts}` 而非 HTBP `{tool,arguments}` 信封。`--json` 原样输出完整 `Page<{path,tool}>`(含 cursor);人类模式分列输出 `NODE`/`TOOL`/效果/确认/描述,避免工具名含 `/` 时与节点路径混淆,有后页时打印 `next cursor`。CLI 可转发 semantic mode,但可用性仍由服务端 `search:semantic` capability 判定。
- Dashboard `/ui/search` 是独立消费页,当前只发 keyword 请求;按服务端 opaque cursor 续页,区分权限/未启用/空结果状态。结果链接到 `/ui/nodes/<TreePath>?tool=<tool-name>`,NodePage 预选该工具;TreePath 的每个 raw segment 在导航 URL 与所有节点 HTBP API 请求前分别编码。CommandPalette/Explorer 的本地已加载树过滤只用于导航,不替代 root 全局搜索。

## 1c. skillhub kind 数据面(与 context 同构的内容型 kind)

skillhub 存 Agent Skill:每 skill = 对象前缀 `<id>/`,含 `SKILL.md`(Claude 约定 YAML frontmatter,`name`/`description` 必填)+ 若干 UTF-8 文本文件。NodeConfig 与 context 同形(`provider` r2/s3、`providerConfig?`、`authRef?`、`readOnly?`、`ttl?`);底层 ObjectStore/objectProvider 与大对象 `$ref`/`~ref`、etag 版本、`skills/<nodePath>` 前缀隔离全部复用 context。`~describe` capabilities = `['search']`。数据面 `POST /<hub>` `{tool,arguments}`:

| cmd | scope | args → 返回 |
|---|---|---|
| `List` | read | `{opts?}` → `Page<SkillSummary{id,name,description,version?,updatedAt}>`(name/description 由服务端解析 SKILL.md frontmatter) |
| `Get` | read | `{id}` → `SkillDetail{...summary, content(SKILL.md 原文), files:[{path,contentType,size?,version}]}`;`{id,file}` → `SkillFile{path,contentType,size?,version,content}`(大/二进制文件 content = `{$ref}`) |
| `Search` | read | `{query,opts?}` → `Page<SkillSummary>`(keyword 命中 id/name/description) |
| `Publish` | write | `{id?,files:[{path,content,contentType?}]}` → `{id,name,description,fileCount}`;整体替换(未列文件删除);校验含 `SKILL.md` 且 frontmatter 有 name+description;缺 → invalid_argument。id 缺省取 frontmatter name 的 slug |
| `Remove` | write | `{id}` → void;不存在 → not_found |

readOnly 挂载在 `~help` 隐藏 Publish/Remove 并对写动词 403。本期不支持二进制上传(Publish content 须字符串)与 plugin/device provider。

## 2. 内容协商

- **默认一律 `text/markdown`**(无 Accept、`*/*`、未知类型):`~help` → 可读性表现(renderHelpMarkdown);`~tree` → code fence 包缩进文本树;`~skill` 与调用返回值 → markdown(IANA 注册类型,不用 `application/markdown`)。只有显式声明才拿到其它表现。
- `Accept: application/json` → 结构化 JSON;DSL/markdown 与 JSON 两种表现**语义等价**,JSON 不得多/少字段。
- `Accept: text/plain`(显式)→ 紧凑表现:`~help` → Help DSL;`~tree` → 裸缩进文本树。调用返回值无 plain 表现,仍渲染 markdown。
- markdown 可读性表现:同一 HelpModel 渲染,完整语句解释调用信封/scope/effect/confirm、每个下一步给可执行 GET/POST 路径、inputSchema 缩进 JSON。排版自定,消费方不应对其做结构化解析(机器可读用 JSON)。
- 优先级 json > markdown > plain(共存时取高优先)。归类逻辑在 core `htbp/negotiate.ts`(唯一入口)。
- `~tree` 的 JSON(`TreeJson`)才是规范形状;文本/markdown 树排版实现自定。

## 3. TBError 形状与 HTTP 映射

```ts
interface TBError {
  code: 'not_found' | 'permission_denied' | 'invalid_argument'
      | 'conflict' | 'unavailable' | 'rate_limited' | 'internal'
  message: string        // 面向 LLM/人类可读
  retryable: boolean
}
```

- HTTP 映射:not_found→404、permission_denied→403、invalid_argument→400、conflict→409、rate_limited→429、unavailable→503、internal→500。
- `retryable:true` 仅允许 `rate_limited`/`unavailable`/`internal`。
- **401 未认证**:缺失/无法识别 SK(发生在 `Authorizer.Check` 之前)→ HTTP 401,body 复用 TBError 形状(`code:'permission_denied'`、`retryable:false`);**disabled/过期 SK 视同无法识别,同样 401**。
- **501 未实现占位**:`code:'unavailable'`、`retryable:false`。
- **503 设备离线**:`code:'unavailable'`、`retryable:true`。
- 超时常量勿混用(分别命名):设备调用转发 60s、平台→Plugin 调用 30s、Workers CPU 上限 30s/请求。

## 4. Help DSL

```
htbp 0.1                                       ← 首行:协议版本
node docs/context7 mcp "Context7 文档检索"      ← node 行:<path> <kind> <一句话描述>(值恒单行)
hint this is an index; GET /docs/context7/<tool>/~help …   ← 可选:下一步指引(单行)
cmd resolve-library-id POST /docs/context7/resolve-library-id  ← cmd 行:<name> <METHOD> </path>(直连工具路径)
  body { "libraryName": string }               ← 直连 cmd 的 body 即 arguments 本体(裸 inputSchema)
  returns markdown 文档库列表
  scope call                                    ← 必须声明
```

约束:

- 每个 cmd **必须**声明 `scope`;`effect`(read/write/destructive)/`confirm`/`h`(工具级一句话)可选。
- 属性行输出顺序 `h → body → returns → scope → effect → confirm`,两空格缩进;多行 `h` 的续行 4 空格缩进(最小 parser 按未知行忽略,全文保留在单工具全量 `~help`)。
- **索引形态**(mcp/http/device-tool 节点级 `~help`):cmd 不含 inputSchema/returns,`h` 压缩为一句话摘要(summarizeOneLine,上限 160 字符);下钻指引在 `hint` 行/字段,不污染 description。
- cmd 命名:Provider 类节点 = 接口方法名**首字母大写**(context:`List/Get/Update/Write/Search`)或**工具原名**(mcp/http);仅 `system/*` builtin 用小写。
- **body 行两种形态**:mcp/http/tool 工具 cmd 宣告直连路径(`/<node>/<tool>`),body 即裸 inputSchema(CmdSpec `flatBody`);builtin/context/device-shell 等 cmd 仍宣告节点路径,body 为 `{tool,arguments}` 信封。消费方以 cmd path 为准(path 含工具段 ⇒ 扁平 body)。
- 消费方对未知行**必须忽略**(向前兼容;`hint`/`note`/`feedback` 行均以此扩展)。
- **note 行**(可选,hint 之后):`note "<text>"`——管理员对该 path 的补充说明(builtin `system/annotation` 写入,网关 `~help` 注入;text ≤ 2000 字符,折叠单行)。
- **feedback 块**(可选,置尾):头行 `feedback <count> GET /<path>/~feedback` + 缩进条目行 `<id> <score> "<title>"`(净分 > -3 的前 5,净分降序)+ 缩进 `use` 指引行(下钻/提交/投票的完整调用形态,由渲染器按 path 派生,属表现不属语义)。
- directory 节点的 `~help` 列子节点相对路径 + 一句话描述。
- JSON 等价形状 `HelpJson`/`TreeJson`:cmds 的 `inputSchema` 是真 JSON Schema(不含 `{tool,arguments}` 信封),供 Dashboard @rjsf 渲染;`hint`/`note` 为可选同名字段;feedback 块对应 `feedback?: [{id,title,score}]`(空则两侧都缺席)。

## 5. 核心数据模型

- `Node{path,kind,description,config?,virtualize?,registeredBy,online?}`:主键 `path`('/' 分隔,不含保留段);八种 kind(directory/mcp/http/builtin/context/device/remote/tool/skillhub);`registeredBy=keyId`(device 由网关代写;自动物化中间 directory 记 `system:auto`,引导节点记 `system:boot`)。config 存在时其 kind 必须与节点 kind 一致。
- mcp/http NodeConfig 上游认证(语义两 kind 一致,复用 `authHeaderFor`):`authRef` 指 SecretStore 凭证名,注入头名 `authHeader`(默认 `Authorization`)、前缀 `authScheme`(默认 `Bearer`,**空串 = secret 原样注入**)。管理客户端若暴露“自定义 scheme”模式,空前缀必须 fail closed,不能通过省略字段静默回退 Bearer;HTTP 的 `authHeader`/`authScheme` 必须与 `authRef` 同时使用。mcp 另有 `headers?: Record<string,string>`(静态明文请求头,非机密,如上游要求的工具白名单头),每趟上游请求(initialize/list/call)均携带;凭证头覆盖同名静态头。http `tools[]` 每项至少有非空 `name`/`description`/`method`/`pathTemplate`,method 仅 GET/POST/PUT/DELETE。kind:'tool'(plugin 挂载)NodeConfig 也有 `authRef?`:平台调用时 resolve 后经 `X-TB-Upstream-Auth` 注入 plugin(见第 8 节)。
- `SecretKey{id,hash,owner,scopes,registerPaths?,disabled?,expiresAt?}`:主键 `id`(可公开,审计用);`hash=sha256(明文)`,明文仅签发响应出现一次;`owner: OwnerRef`(`user:`/`agent:`/`device:` 前缀)。`expiresAt` 只接受带时区的 ISO 8601 timestamp,Write/Update 时规范为 UTC ISO;非法值 → invalid_argument 且不写入。
- `Scope{pattern,actions,effect?}`:动作 = read/write/call/register/admin;**deny 优先 → allow → 无匹配默认拒**;`*`/`**` glob 语义。
- `ContextEntry`:主键 `uri = node://<namespace-path>/<entry-path>`;`version` 乐观并发(`ifVersion` 不符 → conflict;r2 落地 etag=version);`contentType` 决定表现;>1 MiB 的 Get 返回 `$ref`。
- `PluginManifest{id,protocolVersion:'plugin/v2',endpoint,auth,healthPath,enabled}`:manifest 只描述部署与生命周期,不含 v1 的 `kind`/`interfaceVersion`;能力由 `~describe.exports[]` 的 `profile`/`methods` 声明。auth = `{kind:'platform-token'}` 或 `{kind:'bearer',secretRef}`。
- builtin 模块名集合:`sk | secret | registry | status | plugin | federation | annotation`(引导时全部物化)。
- `Annotation{path,text,updatedAt,updatedBy}`:key `annotation:<path>`,每 path 一条覆盖写;text trim 后 1..2000;path 须 resolve 命中(根 `''` 放行 = 全树公告);独立于 TreeNode,工具子路径可标注。
- `FeedbackEntry{id,title,detail,by,at,up[],down[]}`:key `feedback:<path>` 单 key 数组(KV last-write-wins,低频非关键数据接受并发窗口);`id = fb_ + 6 位 base36`;`by`/投票人 = `ctx.owner`;净分 = up-down(派生不落库);title ≤ 80、detail ≤ 500(trim 后)。
- 四动词语义:`Write` 幂等 upsert / `Update` patch(不存在 → not_found,path 不可改)/ `Get` 不存在 → not_found / `Delete` 幂等静默(SKRegistry)或 not_found(NodeRegistry)。
- Delete 动作归属随对象不同:context 条目删除 = `write` 动作;节点卸载 `NodeRegistry.Delete` = `register` 动作;Provider 层 `Delete` = capability 声明项。

## 6. SK 与注册路径规则

- `Authorizer.Check` 是唯一判定入口;判定次序 read→404(deny==not_found,不泄露存在性)再目标动作→403。
- **registerPaths 收紧**:SK 声明了 `registerPaths` → 仅允许在这些前缀下注册;未声明(但持 register scope)→ 允许保留根之外的任意路径;同路径已有他人节点 → conflict。每项是独立 TreePath pattern,逗号可作为合法路径字符,不能把字段内部的逗号误作列表分隔符;CLI 用可重复 `--register-path`,Dashboard 用每行一项并对 owner 与每条半填 scope fail closed。
- Admin SK:scope=`**` 全动作。Workers 首次引导必须预置 `TB_BOOTSTRAP_ADMIN_SK`,缺失时 fail closed且不得把随机明文写入日志。Node/Docker server默认同样在监听前 fail closed;仅显式 `TB_ALLOW_INSECURE_BOOTSTRAP=true` 才启用随机生成并打印一次的本地逃生阀。宿主中立 `runBootstrap` 与未传 `adminSk` 的 SDK仍提供随机兼容路径。
- 吊销/禁用经 StateStore 分发:KV 宿主最终一致,跨边缘通常约 60s、也可能更久(生产曾实测 0.3s,只作样本;`scripts/verify-revocation.ts` 可重跑);需要确定性即时失效须改强一致认证真源,短 `expiresAt` 可缩小暴露窗口。认证读取对历史非法 `expiresAt` **fail closed**(视同无效 SK),不会因 `Date.parse()` 的 `NaN` 比较而放行。

## 7. 设备帧协议要点

- 帧类型:`hello`(声明 `DeviceExpose{shell?,fs?,nodes?}` 与可选 cmds)/ `ready` / `call` / `result` / `cancel` / `ping` / `pong`;未 hello 先 call → 拒;`requestId` 幂等;调用超时 60s → `unavailable` + cancel 帧。
- ready 后网关代写 NodeRegistry(`device/<id>/shell|fs` 等);断线节点 `online:false`,调用 → 503 retryable;24h 未重连回收。DO hibernation 恢复及每次 invoke、Node DeviceHub 每次 invoke都会调用 `identify`,复核 keyId与当前 scope/registerPaths,并在异步认证后再次比较 active connection generation;disabled/delete/expiry、权限收紧和同 ID 替换均按失效处理。Node 的 replacement TOCTOU已有 barrier + mutation回归;Workers DO 的生产 hibernation/驱逐/stale-meta仍须真实环境验证。
- **shell 白名单**:默认拒一切命令;声明 list 精确放行或 `*` 通配;含元字符拒。shell 契约 `cmd exec`(effect destructive + confirm)。
- fs = file provider(FsObjectStore,realpath 防路径逃逸)。
- ping/pong 是稳定字面量(网关 `setWebSocketAutoResponse` 精确匹配,不唤醒 DO);客户端 30s 心跳保活,见 [../guides/do-websocket-hibernation.md](../guides/do-websocket-hibernation.md)。

## 8. Plugin 传输契约(平台 → Plugin)

- `POST {endpoint}`,上下文唯一载体 `X-TB-Context`(base64url 信封);`X-TB-Request-Id` 重试去重;载荷 ≤1 MiB(超限走 `$ref`);超时 30s。
- `X-TB-Upstream-Auth`(可选):挂载节点配置 `authRef` 时,平台每次调用经 SecretStore resolve 后以 base64url 编码注入该头(明文形状由 plugin 约定,如 JSON);plugin 不自持上游凭证,轮换只需 `tb secret set`。resolve 失败 → unavailable 快速失败;无 authRef 则不发该头。常量:core `plugin/envelope.ts`(`HEADER_TB_UPSTREAM_AUTH`)。
- `pluginToken`(Plugin 回调平台的令牌)注册时签发仅一次。
- 生命周期:注册时自动探活(`GET {healthPath}`)+ 抓取 `~describe` 并校验 plugin/v2 exports;不再抓 `~help`。endpoint 可为 `binding:<name>`(宿主装配的进程内插件,探活/契约/调用直调 handler,零网络;`system/plugin` 的 `catalog` cmd 列目录)。endpoint/healthPath/protocolVersion 更新时重探活并刷新 contract,auth/enabled 等本地字段变化不触发 contract refresh;未声明的可选方法不会被调用;周期探活反映健康态但不自动注销。

## 9. CLI 命令族矩阵

CLI 是纯 API 客户端,无专用端点。全局参数为 `--json` / `--base-url` / `--sk` / `--timeout <seconds>`;均可放在根、命令组或叶子命令位置,组级 help 展示 `Global Options`,也读 `TB_BASE_URL`/`TB_SK` 与 `~/.config/tool-bridge/config.json`(XDG,多 profile)。`--timeout` 是单次 HTTP 请求等待上限(默认 120s;超时报 retryable 错误),status、login 与 tool auth 本地回调兑换均走统一超时客户端;长驻 `tb connect` 明确拒绝该参数,避免被误解为进程总寿命。错误呈现:TBError 的 `retryable:true` 在人类模式加 `(retryable — try again)` 尾注,`--json` 错误对象含 `retryable`(及 call 失败时的结构化 `feedback`);Commander 的未知参数、缺值、多余 positional 等解析错误在真正解析到 `--json` option 时也输出 `{ok:false,error,code}` 并非零退出,`--` 后仅作为 positional value 的同名文本不切换输出通道。

所有返回 `Page<T>` 的 CLI list/search 命令统一接受 `--limit 1..200` / `--cursor`;HTBP 数据面请求把分页参数置于 `arguments.opts`,root `tb search` 则按自身契约置于 body `opts`。JSON 保留 page 形状,人类模式打印 `next cursor`。当前覆盖 root Tool Search、SK/Secret/Plugin 列表、Context/Skill List+Search,以及基于 Registry 页过滤的 Server/Device 列表;过滤当前页时仍保留原始 cursor,当前页无匹配不等于全集为空。

| 命令 | 对应接口面 |
|---|---|
| `tb status` | 树外 `GET /healthz`;遵守 `--timeout` |
| `tb login` / `whoami` / `use` | 本地凭据管理,无服务端接口(whoami = 本地配置态 + `~help` 探测 + status 摘要) |
| `tb ls` / `tree` / `help` | `~help` / `GET /~tree?depth=N`;CLI 显式 `--depth` 严格为 1..8(缺省由网关取 2);`tb help` 默认 Markdown 表现(TTY 下经 marked-terminal 渲染 ANSI 富文本,管道/非 TTY/NO_COLOR 输出裸 markdown),`--md` 强制裸 markdown,`--dsl` 请求紧凑 DSL(Accept: text/plain),`--json` 结构化 |
| `tb search <query>` | 直连 root-only `POST /~search` + `{query,opts:{mode?,limit?,cursor?}}`;`--json` 保留完整 Page/cursor,人类模式打印工具表与 `next cursor` |
| `tb call` | 直连 `POST /<path>`(path 即工具路径,body 为 arguments 本体);`--tool` 给出时信封 `POST /<path>` + `{tool,arguments}`(builtin/context 等通用)。arguments 三种给法互斥:第二 positional 裸 JSON(`tb call <path> '{...}'`)/ `--args` / `--args-file`。调用失败(unavailable/internal/invalid_argument/rate_limited)时尽力拉取该 path `~feedback` 注入提示(有条目列 top 3,无条目引导 submit;拉取限时 5s、失败静默) |
| `tb tool mount` / `rm` | NodeRegistry.Write/Delete(kind=mcp/http/tool);`--kind tool --provider <plugin-id> [--auth-ref]` 挂 tool-provider Plugin;mcp/http 含 virtualize prefix/rename/hide/describe,条件 flag 在本地严格拒绝串用;缺 `--description` 时派生非空描述 |
| `tb tool auth <path>` | mcp 托管 OAuth 发起(POST `/<path>/~authorize`):authorized → 直接完成;redirect → 打印授权 URL 并尝试开浏览器(`--no-open` 只打印)。`--local`:本机 127.0.0.1 临时端口收 AS 回跳,code+state 转交网关 `/~oauth/callback` 兑换(适配 Bytebase 等只放行 loopback 回调的严格上游;默认流程遇 redirect 类报错会提示) |
| `tb server add` / `ls` / `rm` | NodeRegistry(kind=remote 联邦);远端地址用 `--remote-url`,`--base-url` 始终表示当前网关(旧脚本须迁移,help 与缺参错误均提示);add 缺描述时派生非空描述,ls 支持分页;无 Registry 可见性时退到 `~tree`,该 fallback 不支持 `--limit/--cursor` 并明确报错 |
| `tb ctx ls/cat/put/patch/rm/search` | Context List/Get/Write/Update/Delete + Search;内容 `--content`/`--file` 互斥,交互式 stdin 无输入源立即报错,List/Search 支持分页 |
| `tb ctx mount` / `unmount` | NodeRegistry(kind=context,provider=r2/s3 或 context-provider Plugin id);provider 条件 flag 本地严格校验,缺描述时派生非空描述 |
| `tb skill ls/get/search/publish/rm` | skillhub 数据面(List/Get/Search/Publish/Remove;`get --out` 落本地目录、`publish <dir>` 递归读文本文件) |
| `tb skill mount` / `unmount` | NodeRegistry(kind=skillhub,provider 默认 r2 无需凭证 / s3 opt-in) |
| `tb connect` | 设备长驻(WS 反向注册,partysocket 重连 + 心跳) |
| `tb device ls` | NodeRegistry `List(prefix="device")` |
| `tb mount fs` | 设备 fs 挂载 |
| `tb sk list/get/create/update/enable/disable/rm` | SKRegistry 全管理面(create/update 可带 scope、registerPaths、带时区 `expiresAt`;CLI 与 core 双层校验,规范为 UTC;list 支持分页) |
| `tb secret set/ls/rm` | SecretStore(authRef/skRef 来源;ls 只见 name+updatedAt,不回显明文且支持分页) |
| `tb federation ls/add/rm` | builtin `system/federation`:remote 联邦 host 白名单(list 合并 env 基线 ∪ 运行时;add/rm 只动运行时叠加层,env 基线条目 removable=false 不可删) |
| `tb note ls/get/set/rm` | builtin `system/annotation`:Path 补充说明(set/rm 需 admin;path `'/'` = 根空串 = 全树公告) |
| `tb feedback ls/get/submit/vote/rm` | `~feedback` 保留段端点(ls 可 `--hidden`;submit 须 `--title`/`--detail`;rm 走 DELETE 需 admin) |
| `tb plugin register/list/get/update/health/catalog/rm` | PluginRegistry + 探活;list 支持分页;catalog 列宿主装配的进程内插件目录(`binding:<name>`,可用≠已激活) |

`tool rm`/`server rm` 前有 kind 校验,防止命令名误删其它节点。`tb init`(部署向导)未实现,见 [../must/current-state.md](../must/current-state.md) 未竟事项。
