# Proto.md 检索地图

> 用途:实现轮次引用"精确 Proto 章节号"的主检索文档——先查这里定位章节,再翻 docs/Proto.md 原文核对签名。更新时机:docs/Proto.md 结构或关键契约变化时(行号漂移需同步修正)。行号基于 2026-07-06 的 docs/Proto.md(642 行)。

## 1. 章节地图(章节号 → 主题 → 关键接口/端点)

| 章节 | 行号 | 主题 | 关键接口 / 端点 / 类型 |
|---|---|---|---|
| §0.1 | 9–21 | 资源 URI | `node://` `sk://` `plugin://` `system://`;`node://` 是唯一消费/授权面(L21) |
| §0.2 | 23–55 | 通用类型 | `Page<T>` `ListOptions`(默认 50/上限 200)`TBError`(见 §3 下文)+ HTTP 映射 + 401/501/503 语义 |
| §0.3 | 57–69 | 调用上下文 | `CallContext{keyId,owner,scopes,traceId}`;隐式携带,禁止参数重传身份 |
| §0.4 | 71–83 | CRUD 动词语义 | List/Get/Write(upsert)/Update(patch)/Delete;Registry 类=四动词+Delete |
| §1.1 | 89–106 | 保留段与端点 | `GET /<path>/~help` `~skill`、`POST /<path>`、`GET /~tree?depth=N`、`POST /<path>/~register`;保留段 `~help/~skill/~tree/~register/~describe`,保留根 `system`/`ui` |
| §1.2 | 108–114 | 内容协商 | 见下文 §5 |
| §1.3 | 116–131 | Help DSL | 见下文 §4 |
| §1.4 | 133–146 | 调用形态 | `POST /<path>` body `{"tool","arguments"}`;`opts` 整体传不平铺(L146) |
| §1.5 | 148–152 | 版本化 | `~help` 首行 `htbp <ver>`;major 对齐 Plugin `interfaceVersion` |
| §2.1 | 157–171 | SecretKey | `SecretKey{id,hash,owner,scopes,registerPaths?,disabled?,expiresAt?}`;明文仅签发响应出现一次 |
| §2.2 | 173–195 | Scope 与动作 | `Scope{pattern,actions,effect?}`;`Action = read/write/call/register/admin`(L181–187);deny 优先/默认拒绝(L189–193);glob 语义(L195) |
| §2.3 | 197–225 | Authorizer + SKRegistry | `Authorizer.Check` 唯一入口(L200)、SKRegistry(builtin `system/sk`)、可见性裁剪(L221)、Admin SK 引导(L223)、吊销传播 ≤60s(L225) |
| §2.4 | 227–234 | 反向注册路径规则 | registerPaths 收紧规则 a–d;保留根 `system`/`ui` + 部署配置追加 |
| §2.5 | 236–252 | SecretStore | builtin `system/secret`;只写不读(L250);AES-256-GCM + `TB_SECRET_ENCRYPTION_KEY` env-only(L251);`resolve()` 内部专用(L245) |
| §3.1 | 258–279 | Node | `Node{path,kind,description,config?,virtualize?,registeredBy,online?}`;`Virtualize{prefix,rename,hide,describe}` |
| §3.2 | 281–304 | NodeConfig(按 kind) | mcp/http/builtin/context/device/remote 各形状;`HttpToolDef`(L295);authRef/skRef = SecretStore 引用名(L304) |
| §3.3 | 306–320 | NodeRegistry | builtin `system/registry`;List/Get/Write/Update/Delete/`Resolve`(最长前缀,L315);写面→register 动作+§2.4,读面→read(L320) |
| §3.4 | 322–330 | remote 节点 | 透传/白名单/`X-TB-Via` 环检测(maxHops 默认 4,L328)/两级权限 |
| §4.1 | 335–357 | ToolProvider | `List()/Get(name)/Call(name,args)`;`ToolDef.effect: read/write/destructive`(L351);`ToolResult` |
| §4.2 | 359–364 | 内置 Tool Provider 义务 | mcp(Streamable HTTP+会话重建+缓存失效)/http/builtin |
| §5.1 | 369–420 | ContextProvider | 必须四动词 `List/Get/Update/Write`(L374–383);可选 `Search/Watch/Delete`(L386–390,需 capability 声明);`ContextEntry`;乐观并发 `ifVersion`;大对象 `$ref`(L408) |
| §5.2 | 422–427 | 内置 Context Provider 义务 | r2(etag=version,presign 经 S3 兼容端点)/s3(aws4fetch)/file(路径穿越必拒);keyword Search 为内置三者基线,semantic 需声明 |
| §5.3 | 429–431 | Context 挂载 | 复用 `NodeRegistry.Write{kind:'context'}`;ttl 到期回收整节点;readOnly→write 拒绝 |
| §6.1 | 437–445 | Device 连接建立 | `WS /system/device/ws` + Bearer SK;mountPath 缺省 `device/<deviceId>`(L445) |
| §6.2 | 447–477 | Device 帧协议 | `DeviceFrame`:hello/ready/call/result/cancel/ping/pong;`DeviceExpose{shell?,fs?,nodes?}`(L454);超时 60s + 幂等(L477) |
| §6.3 | 479–485 | Device 生命周期 | ready 后代写 NodeRegistry;断线 offline;24h 未重连回收;shell 契约 `cmd exec`(effect destructive+confirm,L484);fs = file provider(L485) |
| §7 | 489–548 | SDK | `createToolBridge(config)`(L495);`ToolBridge.fetch/registerTool/registerContext/connect`;四注入点 `StateStore/ObjectStore/SecretStore/DeviceTransport`(L522);`DeviceConn` 承载 DeviceFrame(L541);`reservedRoots`(L503) |
| §8.1 | 554–579 | PluginRegistry | builtin `system/plugin`;`PluginManifest{id,kind,interfaceVersion,endpoint,auth,healthPath,enabled}`;`pluginToken` 仅一次(L576);注册自动探活+契约校验(L579) |
| §8.2 | 581–591 | PluginLifecycle | `GET {healthPath}` `GET /~describe` `GET /~help`;未声明的可选方法不会被调用 |
| §8.3 | 593–608 | 传输契约(平台→Plugin) | `POST {endpoint}` + `X-TB-Context`(base64url,唯一载体)+ `X-TB-Request-Id`(去重);≤1MiB / 超时 30s(L608) |
| 附A | 612–629 | CLI 命令↔接口矩阵 | 见下文 §6 |
| 附B | 631–643 | 接口↔User Case 追溯 | Case 1–7 到接口的映射 |

## 2. 核心数据模型与命名规则

- `Node`(Proto.md:261–271):主键 `path: TreePath`('/' 分隔,不含保留段);7 种 kind;`registeredBy=keyId`(device 由 Gateway 代写,L267)。树路径中间级自动物化 directory:注册 `a/b/c` → `a`、`a/b` 也成节点(Proto.md:104)。
- `SecretKey`(Proto.md:160–170):主键 `id`(可公开,审计用);`hash=sha256(明文)`;`owner: OwnerRef`(`user:`/`agent:`/`device:` 前缀)。
- `ContextEntry`(Proto.md:398–408):主键 `uri = node://<namespace-path>/<entry-path>`;`version` 乐观并发(r2 落地 etag=version,L424);`contentType` 决定表现。
- `PluginManifest`(Proto.md:565–573):主键 `id`;`interfaceVersion` 形如 `<kind>/v<major>`。
- 保留段 `~help/~skill/~tree/~register/~describe`(Proto.md:106);保留根 `system`/`ui` + 部署追加(Proto.md:232)。
- builtin 模块名集合:`sk | secret | registry | plugin | status`(Proto.md:287,= Architecture.md:304 引导注册顺序)。
- 存储落地:StateStore(CF=KV `tb-state` / Docker=SQLite / SDK=内存)、ObjectStore(CF=R2 `tb-context` / Docker=FS/S3)、SecretStore 值加密后进 StateStore(docs/Architecture.md:286-302)。

## 3. TBError 形状与 HTTP 映射(§0.2,Proto.md:41–55)

```ts
interface TBError {
  code: 'not_found' | 'permission_denied' | 'invalid_argument'
      | 'conflict' | 'unavailable' | 'rate_limited' | 'internal'
  message: string        // 面向 LLM/人类可读
  retryable: boolean
}
```

- HTTP 映射(Proto.md:49):not_found→404、permission_denied→403、invalid_argument→400、conflict→409、rate_limited→429、unavailable→503、internal→500。
- `retryable:true` 仅允许 `rate_limited`/`unavailable`/`internal`(Proto.md:49)。
- **401 未认证**(Proto.md:51):缺失/无法识别 SK(发生在 `Authorizer.Check` 之前)→ HTTP 401,body 复用 TBError 形状,`code:'permission_denied'`、`retryable:false`(7 码不为 401 扩容,401/403 由 HTTP 状态码区分)。
- **501 未实现占位**(Proto.md:53):`code:'unavailable'`、`retryable:false`。
- **503 设备离线**(Proto.md:55):`code:'unavailable'`、`retryable:true`。
- 超时常量勿混用:Device 调用转发默认 60s(Proto.md:477),平台→Plugin 调用默认 30s(Proto.md:608),Workers CPU 上限 30s/请求(docs/Reference.md:52)。建议分别命名常量。

## 4. Help DSL 格式(§1.3,Proto.md:116–131)

```
htbp 0.1                                       ← 首行:协议版本(§1.5)
node docs/context7 mcp "Context7 文档检索"      ← node 行:<path> <kind> <一句话描述>
cmd resolve-library-id POST /docs/context7      ← cmd 行:<name> <METHOD> <path>
  body { "tool":"resolve-library-id", "arguments": { "libraryName": string } }
  returns markdown 文档库列表
  scope call                                    ← 必须声明(对应 §2.2 动作)
```

约束(Proto.md:131,docs/Reference.md:15):

- 每个 cmd **必须**声明 `scope`;`effect`/`confirm` 可选。
- 属性全集:`q` / `h` / `body` / `returns` / `scope` / `effect` / `confirm`。
- 消费方对未知行**必须忽略**(向前兼容)。
- directory 节点的 `~help` 列子节点相对路径 + 一句话描述(Proto.md:94–95)。

## 5. 内容协商规则(§1.2,Proto.md:108–114)

- 默认(无 Accept):`~help` → `text/plain`(Help DSL,唯一非 JSON 表现,无 markdown 变体);`~skill` 与调用返回值 → `text/markdown`(IANA 注册类型;不用 `application/markdown`,L114)。
- `Accept: application/json` → 结构化 JSON;两种表现**语义等价**,JSON 不得多/少字段(L112)。
- `~help` 的 JSON 表现是 cmd 数组(inputSchema 供 Dashboard @rjsf 渲染表单)。

## 6. CLI 命令矩阵(附A,Proto.md:612–629)

CLI 是纯 API 客户端,子命令一一映射 Proto 接口,随各 Phase 增量生长(DOD.md:17)。全局开关 `--json`;读 `TB_BASE_URL`/`TB_SK`。

| 命令 | 对应 API / 接口 | 交付 Phase |
|---|---|---|
| `tb init` | M10 部署向导 + §2.3 Admin SK 引导(可重入) | 6(骨架 0) |
| `tb login` / `whoami` / `use` | 本地凭据管理,**无服务端接口** | 1(骨架 0) |
| `tb status` | builtin `system/status`;Phase 0 阶段打 `/healthz` | 0/1 |
| `tb ls` / `tree` / `help` | §1.1 `~help` / `GET /~tree?depth=N` | 1 |
| `tb call` | §1.4 `POST /<path>` body `{tool,arguments}` | 2 |
| `tb tool mount` / `rm` | §3.3 NodeRegistry.Write/Delete(kind=mcp/http) | 2 |
| `tb server add` / `ls` / `rm` | §3.3(kind=remote,§3.4 联邦) | 2 |
| `tb ctx ls/cat/put/patch/search` | §5.1 四动词 + Search | 3 |
| `tb ctx mount` / `unmount` | §3.3(kind=context) | 3 |
| `tb connect` / `tb mount fs` | §7 connect / §6 帧协议 | 4/5 |
| `tb device ls` | §3.3 `List(prefix="device")` | 4 |
| `tb sk list/create/rm` | §2.3 SKRegistry(create 可带 register scope + registerPaths) | 1 |
| `tb secret set/ls/rm` | §2.5 SecretStore(authRef/skRef 来源) | 1 |
| `tb plugin register/list/health` | §8.1/§8.2 | 5 |

## 7. Phase 0 契约(骨架实现须落地的最小面)

- **`/healthz`**:Proto **未定义**平台自身 healthz 的响应结构(Proto 中 healthz 仅是 Plugin 的健康端点,Proto.md:584)。唯一硬约束来自 DOD.md:40——200 + 版本号;`tb status --json` 可解析(DOD.md:41)。建议 `{"healthy":true,"version":"<x.y.z>"}`,**定型后须回写 docs**(见 [../memory/doc-gaps.md](../memory/doc-gaps.md) G3)。
- **根 `/~help` 占位**:200 + `Content-Type: text/plain`,首行 `htbp 0.1`;空树可只有 htbp 头无 cmd 行。`~skill`/`~tree`/`~register` 可返回 501(`code:'unavailable'`,`retryable:false`)。
- **内容协商**:Phase 0 可只做 `text/plain` 默认表现;`application/json` 分支属 Phase 1 单测项(DOD.md:53),若提前做必须遵守语义等价不变量。
- **TBError 中间件**:完整映射是 Phase 1 范围(DOD.md:48),但 501 占位已需最小版,Phase 0 骨架可先建。
