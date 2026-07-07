# 协议契约参考(HTBP as implemented)

> 用途:引用接口契约、错误码、数据模型、CLI 命令矩阵时的查表文档。真源是代码(core `htbp/`/`types.ts` 与 gateway `tbApp.ts`);bootstrap 期规范原文见 `archive/docs/Proto.md`(历史,不再维护)。更新时机:契约变化时。

## 1. 端点面

| 端点 | 语义 |
|---|---|
| `GET /healthz` | 树外免认证运维端点,200 + `{"healthy":true,"version":"<x.y.z>"}` |
| `GET /<path>/~help` | 节点自描述;默认 `text/plain` Help DSL,`Accept: application/json` 得等价 `HelpJson`。**两级披露**:节点 `~help` 是索引,`GET /<node>/<tool>/~help` 给单工具全量 spec |
| `GET /~tree?depth=N` | 受限深度树视图(默认 2,上限 8 钳制;节点上限 500);子树根必须真实存在,非根不存在 → 404 |
| `GET /<path>/~skill` | 本地 501 占位(`unavailable`,retryable:false);remote 节点透传 |
| `GET /<path>/~describe` | 有可选能力的节点返回 `{ kind, capabilities }`;其余 404 |
| `POST /<path>` | 数据面调用,body `{"tool","arguments"}`;`opts` 整体传不平铺 |
| `POST /<path>/~register` | 自助反向注册(受限 SK 通道),等价 `NodeRegistry.Write`;body.path 必须等于 URL path,kind 必填 |
| `GET /~ref/<token>` | 大对象网关中转下载,树外免认证(HMAC token 即授权,有效期缺省 900s,篡改 → 404) |
| `WS /system/device/ws?deviceId=<id>` | 设备通道升级(Bearer SK);mountPath 缺省 `device/<deviceId>` |
| `GET /ui` | Dashboard 静态资源(免认证,SPA 回退严格限定 `/ui`) |

保留段:`~help / ~skill / ~tree / ~register / ~describe`;保留根:`system`、`ui`(部署配置可追加)。注册 `a/b/c` 时 `a`、`a/b`、`a/b/c` 三级 `~help` 都必须可达(中间 directory 自动物化)。

## 2. 内容协商

- 默认(无 Accept):`~help` → `text/plain`(Help DSL,唯一非 JSON 表现,无 markdown 变体);`~skill` 与调用返回值 → `text/markdown`(IANA 注册类型,不用 `application/markdown`)。
- `Accept: application/json` → 结构化 JSON;两种表现**语义等价**,JSON 不得多/少字段。
- `~tree` 的非 JSON 表现是缩进文本树(排版实现自定);JSON(`TreeJson`)才是规范形状。

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
node docs/context7 mcp "Context7 文档检索"      ← node 行:<path> <kind> <一句话描述>
cmd resolve-library-id POST /docs/context7      ← cmd 行:<name> <METHOD> </path>(带前导 /)
  body { "tool":"resolve-library-id", "arguments": { "libraryName": string } }
  returns markdown 文档库列表
  scope call                                    ← 必须声明
```

约束:

- 每个 cmd **必须**声明 `scope`;`effect`(read/write/destructive)/`confirm`/`h`(工具级一句话)可选。
- 属性行输出顺序 `h → body → returns → scope → effect → confirm`,两空格缩进。
- cmd 命名:Provider 类节点 = 接口方法名**首字母大写**(context:`List/Get/Update/Write/Search`)或**工具原名**(mcp/http);仅 `system/*` builtin 用小写。
- 消费方对未知行**必须忽略**(向前兼容)。
- directory 节点的 `~help` 列子节点相对路径 + 一句话描述。
- JSON 等价形状 `HelpJson`/`TreeJson`:cmds 的 `inputSchema` 是真 JSON Schema(不含 `{tool,arguments}` 信封),供 Dashboard @rjsf 渲染。

## 5. 核心数据模型

- `Node{path,kind,description,config?,virtualize?,registeredBy,online?}`:主键 `path`('/' 分隔,不含保留段);七种 kind(directory/mcp/http/builtin/context/device/remote);`registeredBy=keyId`(device 由网关代写;自动物化中间 directory 记 `system:auto`,引导节点记 `system:boot`)。config 存在时其 kind 必须与节点 kind 一致。
- `SecretKey{id,hash,owner,scopes,registerPaths?,disabled?,expiresAt?}`:主键 `id`(可公开,审计用);`hash=sha256(明文)`,明文仅签发响应出现一次;`owner: OwnerRef`(`user:`/`agent:`/`device:` 前缀)。
- `Scope{pattern,actions,effect?}`:动作 = read/write/call/register/admin;**deny 优先 → allow → 无匹配默认拒**;`*`/`**` glob 语义。
- `ContextEntry`:主键 `uri = node://<namespace-path>/<entry-path>`;`version` 乐观并发(`ifVersion` 不符 → conflict;r2 落地 etag=version);`contentType` 决定表现;>1 MiB 的 Get 返回 `$ref`。
- `PluginManifest{id,kind,interfaceVersion,endpoint,auth,healthPath,enabled}`:主键 `id`;`interfaceVersion` 形如 `<kind>/v<major>`,与方法集合不符 → 拒。
- builtin 模块名集合:`sk | secret | registry | status | plugin`(引导时全部物化)。
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
- `pluginToken`(Plugin 回调平台的令牌)注册时签发仅一次。
- 生命周期:注册时自动探活(`GET {healthPath}`)+ `~describe`/`~help` 契约校验;未声明的可选方法不会被调用;周期探活反映健康态但不自动注销。

## 9. CLI 命令矩阵(17 命令)

CLI 是纯 API 客户端,无专用端点;全局 `--json`;读 `TB_BASE_URL`/`TB_SK`,配置 `~/.config/tool-bridge/config.json`(XDG,多 profile)。

| 命令 | 对应接口面 |
|---|---|
| `tb status` | builtin `system/status` 的 `get`(登录态)/ 树外 `/healthz`(未登录回退) |
| `tb login` / `whoami` / `use` | 本地凭据管理,无服务端接口(whoami = 本地配置态 + `~help` 探测 + status 摘要) |
| `tb ls` / `tree` / `help` | `~help` / `GET /~tree?depth=N` |
| `tb call` | `POST /<path>` body `{tool,arguments}` |
| `tb tool mount` / `rm` | NodeRegistry.Write/Delete(kind=mcp/http;含 virtualize prefix/rename/hide/describe、http authHeader/authScheme) |
| `tb server add` / `ls` / `rm` | NodeRegistry(kind=remote 联邦) |
| `tb ctx ls/cat/put/patch/search` | Context 四动词 + Search |
| `tb ctx mount` / `unmount` | NodeRegistry(kind=context,provider=r2/s3) |
| `tb connect` | 设备长驻(WS 反向注册,partysocket 重连 + 心跳) |
| `tb device ls` | NodeRegistry `List(prefix="device")` |
| `tb mount fs` | 设备 fs 挂载 |
| `tb sk list/create/rm` | SKRegistry(create 可带 register scope + registerPaths) |
| `tb secret set/ls/rm` | SecretStore(authRef/skRef 来源;ls 只见 name+updatedAt,不回显明文) |
| `tb plugin register/list/get/health/rm` | PluginRegistry + 探活 |

`tool rm`/`server rm` 前有 kind 校验,防止命令名误删其它节点。`tb init`(部署向导)未实现,见 [../must/current-state.md](../must/current-state.md) 未竟事项。
