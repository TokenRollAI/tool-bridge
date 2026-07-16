# 协议契约参考(HTBP as implemented)

> 用途:引用接口契约、错误码、数据模型、CLI 命令矩阵时的查表文档。真源是代码(core `htbp/`/`types.ts` 与 gateway `tbApp.ts`);bootstrap 期规范原文见 `archive/docs/Proto.md`(历史,不再维护)。更新时机:契约变化时。

## 1. 端点面

| 端点 | 语义 |
|---|---|
| `GET /healthz` | 树外免认证运维端点,200 + `{"healthy":true,"version":"<x.y.z>"}` |
| `GET /<path>/~help` | 节点自描述;默认 `text/markdown` 可读表现,`Accept: application/json` 得等价 `HelpJson`,`Accept: text/plain` 得紧凑 Help DSL(面向 LLM 省 token)。**两级披露**:节点 `~help` 是索引,`GET /<node>/<tool>/~help` 给单工具全量 spec |
| `GET /~tree?depth=N` | 受限深度树视图(默认 2,上限 8 钳制;节点上限 500);子树根必须真实存在,非根不存在 → 404 |
| `GET /<path>/~skill` | 本地 501 占位(`unavailable`,retryable:false);remote 节点透传 |
| `GET /<path>/~describe` | 有可选能力的节点返回 `{ kind, capabilities }`;其余 404 |
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

保留段:`~help / ~skill / ~tree / ~register / ~describe / ~authorize / ~feedback`;保留根:`system`、`ui`(部署配置可追加)。注册 `a/b/c` 时 `a`、`a/b`、`a/b/c` 三级 `~help` 都必须可达(中间 directory 自动物化)。**注意 `~skill`(保留段,节点使用指南,当前本地 501 占位)与 `skillhub`(节点 kind)是两个正交概念:前者是任意节点的一个 GET 保留路径段,后者是内容型 kind 的判别值,互不冲突。**

## 1b. skillhub kind 数据面(与 context 同构的内容型 kind)

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
- mcp/http NodeConfig 上游认证(语义两 kind 一致,复用 `authHeaderFor`):`authRef` 指 SecretStore 凭证名,注入头名 `authHeader`(默认 `Authorization`)、前缀 `authScheme`(默认 `Bearer`,**空串 = secret 原样注入**)。mcp 另有 `headers?: Record<string,string>`(静态明文请求头,非机密,如上游要求的工具白名单头),每趟上游请求(initialize/list/call)均携带;凭证头覆盖同名静态头。kind:'tool'(plugin 挂载)NodeConfig 也有 `authRef?`:平台调用时 resolve 后经 `X-TB-Upstream-Auth` 注入 plugin(见第 8 节)。
- `SecretKey{id,hash,owner,scopes,registerPaths?,disabled?,expiresAt?}`:主键 `id`(可公开,审计用);`hash=sha256(明文)`,明文仅签发响应出现一次;`owner: OwnerRef`(`user:`/`agent:`/`device:` 前缀)。
- `Scope{pattern,actions,effect?}`:动作 = read/write/call/register/admin;**deny 优先 → allow → 无匹配默认拒**;`*`/`**` glob 语义。
- `ContextEntry`:主键 `uri = node://<namespace-path>/<entry-path>`;`version` 乐观并发(`ifVersion` 不符 → conflict;r2 落地 etag=version);`contentType` 决定表现;>1 MiB 的 Get 返回 `$ref`。
- `PluginManifest{id,kind,interfaceVersion,endpoint,auth,healthPath,enabled}`:主键 `id`;`interfaceVersion` 形如 `<kind>/v<major>`,与方法集合不符 → 拒。
- builtin 模块名集合:`sk | secret | registry | status | plugin | federation | annotation`(引导时全部物化)。
- `Annotation{path,text,updatedAt,updatedBy}`:key `annotation:<path>`,每 path 一条覆盖写;text trim 后 1..2000;path 须 resolve 命中(根 `''` 放行 = 全树公告);独立于 TreeNode,工具子路径可标注。
- `FeedbackEntry{id,title,detail,by,at,up[],down[]}`:key `feedback:<path>` 单 key 数组(KV last-write-wins,低频非关键数据接受并发窗口);`id = fb_ + 6 位 base36`;`by`/投票人 = `ctx.owner`;净分 = up-down(派生不落库);title ≤ 80、detail ≤ 500(trim 后)。
- 四动词语义:`Write` 幂等 upsert / `Update` patch(不存在 → not_found,path 不可改)/ `Get` 不存在 → not_found / `Delete` 幂等静默(SKRegistry)或 not_found(NodeRegistry)。
- Delete 动作归属随对象不同:context 条目删除 = `write` 动作;节点卸载 `NodeRegistry.Delete` = `register` 动作;Provider 层 `Delete` = capability 声明项。

## 6. SK 与注册路径规则

- `Authorizer.Check` 是唯一判定入口;判定次序 read→404(deny==not_found,不泄露存在性)再目标动作→403。
- **registerPaths 收紧**:SK 声明了 `registerPaths` → 仅允许在这些前缀下注册;未声明(但持 register scope)→ 允许保留根之外的任意路径;同路径已有他人节点 → conflict。
- Admin SK:部署时生成,scope=`**` 全动作;`TB_BOOTSTRAP_ADMIN_SK` 可预置明文(自动化),否则随机生成仅输出一次。
- 吊销/禁用经 StateStore 分发:KV 宿主传播窗口上限 60s(生产实测 0.3s,`scripts/verify-revocation.ts` 可重跑);需要即时失效用短 `expiresAt`。

## 7. 设备帧协议要点

- 帧类型:`hello`(声明 `DeviceExpose{shell?,fs?,nodes?}` 与可选 cmds)/ `ready` / `call` / `result` / `cancel` / `ping` / `pong`;未 hello 先 call → 拒;`requestId` 幂等;调用超时 60s → `unavailable` + cancel 帧。
- ready 后网关代写 NodeRegistry(`device/<id>/shell|fs` 等);断线节点 `online:false`,调用 → 503 retryable;24h 未重连回收。
- **shell 白名单**:默认拒一切命令;声明 list 精确放行或 `*` 通配;含元字符拒。shell 契约 `cmd exec`(effect destructive + confirm)。
- fs = file provider(FsObjectStore,realpath 防路径逃逸)。
- ping/pong 是稳定字面量(网关 `setWebSocketAutoResponse` 精确匹配,不唤醒 DO);客户端 30s 心跳保活,见 [../guides/do-websocket-hibernation.md](../guides/do-websocket-hibernation.md)。

## 8. Plugin 传输契约(平台 → Plugin)

- `POST {endpoint}`,上下文唯一载体 `X-TB-Context`(base64url 信封);`X-TB-Request-Id` 重试去重;载荷 ≤1 MiB(超限走 `$ref`);超时 30s。
- `X-TB-Upstream-Auth`(可选):挂载节点配置 `authRef` 时,平台每次调用经 SecretStore resolve 后以 base64url 编码注入该头(明文形状由 plugin 约定,如 JSON);plugin 不自持上游凭证,轮换只需 `tb secret set`。resolve 失败 → unavailable 快速失败;无 authRef 则不发该头。常量:core `plugin/envelope.ts`(`HEADER_TB_UPSTREAM_AUTH`)。
- `pluginToken`(Plugin 回调平台的令牌)注册时签发仅一次。
- 生命周期:注册时自动探活(`GET {healthPath}`)+ `~describe`/`~help` 契约校验;未声明的可选方法不会被调用;周期探活反映健康态但不自动注销。

## 9. CLI 命令矩阵(21 命令)

CLI 是纯 API 客户端,无专用端点;全局 `--json` / `--timeout <seconds>`(单请求等待上限,默认 120s;超时报 retryable 错误);读 `TB_BASE_URL`/`TB_SK`,配置 `~/.config/tool-bridge/config.json`(XDG,多 profile)。错误呈现:TBError 的 `retryable:true` 在人类模式加 `(retryable — try again)` 尾注,`--json` 错误对象含 `retryable`(及 call 失败时的结构化 `feedback`)。

| 命令 | 对应接口面 |
|---|---|
| `tb status` | builtin `system/status` 的 `get`(登录态)/ 树外 `/healthz`(未登录回退) |
| `tb login` / `whoami` / `use` | 本地凭据管理,无服务端接口(whoami = 本地配置态 + `~help` 探测 + status 摘要) |
| `tb ls` / `tree` / `help` | `~help` / `GET /~tree?depth=N`;`tb help` 默认 Markdown 表现(TTY 下经 marked-terminal 渲染 ANSI 富文本,管道/非 TTY/NO_COLOR 输出裸 markdown),`--md` 强制裸 markdown,`--dsl` 请求紧凑 DSL(Accept: text/plain),`--json` 结构化 |
| `tb call` | 直连 `POST /<path>`(path 即工具路径,body 为 arguments 本体);`--tool` 给出时信封 `POST /<path>` + `{tool,arguments}`(builtin/context 等通用)。arguments 三种给法互斥:第二 positional 裸 JSON(`tb call <path> '{...}'`)/ `--args` / `--args-file`。调用失败(unavailable/internal/invalid_argument/rate_limited)时尽力拉取该 path `~feedback` 注入提示(有条目列 top 3,无条目引导 submit;拉取限时 5s、失败静默) |
| `tb tool mount` / `rm` | NodeRegistry.Write/Delete(kind=mcp/http;含 virtualize prefix/rename/hide/describe;`--auth-header`/`--auth-scheme` mcp/http 共用;可重复 `--header <Name=value>` 静态头仅 mcp,http 用报错;mcp 另有 `--auth oauth`,与 `--auth-ref` 互斥) |
| `tb tool auth <path>` | mcp 托管 OAuth 发起(POST `/<path>/~authorize`):authorized → 直接完成;redirect → 打印授权 URL 并尝试开浏览器(`--no-open` 只打印)。`--local`:本机 127.0.0.1 临时端口收 AS 回跳,code+state 转交网关 `/~oauth/callback` 兑换(适配 Bytebase 等只放行 loopback 回调的严格上游;默认流程遇 redirect 类报错会提示) |
| `tb server add` / `ls` / `rm` | NodeRegistry(kind=remote 联邦) |
| `tb ctx ls/cat/put/patch/search` | Context 四动词 + Search |
| `tb ctx mount` / `unmount` | NodeRegistry(kind=context,provider=r2/s3) |
| `tb skill ls/get/search/publish/rm` | skillhub 数据面(List/Get/Search/Publish/Remove;`get --out` 落本地目录、`publish <dir>` 递归读文本文件) |
| `tb skill mount` / `unmount` | NodeRegistry(kind=skillhub,provider 默认 r2 无需凭证 / s3 opt-in) |
| `tb connect` | 设备长驻(WS 反向注册,partysocket 重连 + 心跳) |
| `tb device ls` | NodeRegistry `List(prefix="device")` |
| `tb mount fs` | 设备 fs 挂载 |
| `tb sk list/create/rm` | SKRegistry(create 可带 register scope + registerPaths) |
| `tb secret set/ls/rm` | SecretStore(authRef/skRef 来源;ls 只见 name+updatedAt,不回显明文) |
| `tb federation ls/add/rm` | builtin `system/federation`:remote 联邦 host 白名单(list 合并 env 基线 ∪ 运行时;add/rm 只动运行时叠加层,env 基线条目 removable=false 不可删) |
| `tb note ls/get/set/rm` | builtin `system/annotation`:Path 补充说明(set/rm 需 admin;path `'/'` = 根空串 = 全树公告) |
| `tb feedback ls/get/submit/vote/rm` | `~feedback` 保留段端点(ls 可 `--hidden`;submit 须 `--title`/`--detail`;rm 走 DELETE 需 admin) |
| `tb plugin register/list/get/health/rm` | PluginRegistry + 探活 |

`tool rm`/`server rm` 前有 kind 校验,防止命令名误删其它节点。`tb init`(部署向导)未实现,见 [../must/current-state.md](../must/current-state.md) 未竟事项。
