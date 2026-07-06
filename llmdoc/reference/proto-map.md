# Proto.md 检索地图

> 用途:实现轮次引用"精确 Proto 章节号"的主检索文档——先查这里定位章节,再翻 docs/Proto.md 原文核对签名。更新时机:docs/Proto.md 结构或关键契约变化时(行号漂移需同步修正)。行号基于 2026-07-06 Phase 1/2 决策回写后的 docs/Proto.md(703 行,commits 5a78566/03a538c)。

## 1. 章节地图(章节号 → 行号 → 关键接口/端点)

| 章节 | 行号 | 主题 | 关键接口 / 端点 / 类型 |
|---|---|---|---|
| §0.1 | 9–21 | 资源 URI | `node://` `sk://` `plugin://` `system://`;`node://` 是唯一消费/授权面(L21) |
| §0.2 | 23–55 | 通用类型 | `Page<T>` `ListOptions`(默认 50/上限 200)`TBError`(见 §3 下文)+ HTTP 映射 + 401/501/503 语义 |
| §0.3 | 57–69 | 调用上下文 | `CallContext{keyId,owner,scopes,traceId}`;隐式携带,禁止参数重传身份 |
| §0.4 | 71–83 | CRUD 动词语义 | List/Get/Write(upsert)/Update(patch)/Delete;Registry 类=四动词+Delete |
| §1.1 | 89–114 | 保留段与端点 | `GET /<path>/~help` `~skill`、`POST /<path>`、`GET /~tree?depth=N`(判定与钳制 L108)、`POST /<path>/~register`;三级自动物化 L110;保留段/保留根 L112;**`/healthz` 树外免认证 L114** |
| §1.2 | 116–122 | 内容协商 | 见下文 §5 |
| §1.3 | 124–166 | Help DSL + JSON 等价形状 | DSL 格式;渲染细节 L141;cmd 命名 L143;`HelpJson`/`TreeJson` L145–166(inputSchema L153) |
| §1.4 | 168–183 | 调用形态 | `POST /<path>` body `{"tool","arguments"}`;`opts` 整体传不平铺(L181);判定次序 read→404 / scope→403(L183) |
| §1.5 | 185–190 | 版本化 | `~help` 首行 `htbp <ver>`;major 对齐 Plugin `interfaceVersion`(L187) |
| §2.1 | 194–208 | SecretKey | `SecretKey{id,hash,owner,scopes,registerPaths?,disabled?,expiresAt?}`(L197);明文仅签发响应出现一次(L199) |
| §2.2 | 210–232 | Scope 与动作 | `Scope{pattern,actions,effect?}`;deny 优先(L216);无匹配默认拒(L230);glob 语义(L232) |
| §2.3 | 234–264 | Authorizer + SKRegistry | `Authorizer.Check` 唯一入口(L238)、SKRegistry(builtin `system/sk`,Delete 幂等静默 L247)、可见性裁剪 + deny==not_found(L260)、Admin SK 引导(L262)、吊销传播 ≤60s(L264) |
| §2.4 | 266–273 | 反向注册路径规则 | registerPaths 收紧规则 a–d(L270–273);保留根 `system`/`ui` + 部署配置追加 |
| §2.5 | 275–293 | SecretStore | builtin `system/secret`;Set/List/Delete(L281–282);`resolve()` 内部专用(L285);AES-256-GCM + `TB_SECRET_ENCRYPTION_KEY` env-only(L290) |
| §3.1 | 297–320 | Node | `Node{path,kind,description,config?,virtualize?,registeredBy,online?}`(L300);`registeredBy=keyId`,device 由 Gateway 代写(L306) |
| §3.2 | 322–350 | NodeConfig(按 kind) | mcp/http/builtin/context/device/remote 各形状(L326–336);`HttpToolDef`(L339,effect 派生 L345);authRef/skRef = SecretStore 引用名(L350) |
| §3.3 | 352–370 | NodeRegistry | builtin `system/registry`;List/Get/Write/Update/Delete/`Resolve`(最长前缀,L361);判定(L366);**两条注册通道:~register=受限 SK 通道 / registry 数据面=管理通道**(L368);自动物化 directory 规则(system:auto,L370) |
| §3.4 | 372–381 | remote 节点 | 透传 + skRef 换发、调用者 SK 不外传(L376)/白名单/`X-TB-Via` 环检测(maxHops 默认 4,L378)/两级权限 |
| §4.1 | 385–407 | ToolProvider | `List()/Get(name)/Call(name,args)`;`ToolDef.inputSchema`(L400)`effect: read/write/destructive`(L401);`ToolResult` |
| §4.2 | 409–419 | 内置 Tool Provider 义务 | mcp:**会话一次性 + toolcache TTL 300s + refresh=1**(Phase 2 定型,L411);http:HttpToolDef 拼装(L412);builtin:cmd 小写命名 + `system/status` 的 `get`(L413) |
| §5.1 | 423–474 | ContextProvider | 必须四动词 `List/Get/Update/Write`(L430–435);可选 `Search/Watch/Delete`(L439,capability 声明);`ContextEntry`(L460);乐观并发 `ifVersion`;大对象 `$ref`(L461) |
| §5.2 | 476–481 | 内置 Context Provider 义务 | r2(etag=version,presign 经 S3 兼容端点,无凭证退化网关中转,L478)/s3(aws4fetch,L479)/file(路径穿越必拒) |
| §5.3 | 483–487 | Context 挂载 | 复用 `NodeRegistry.Write{kind:'context'}`;ttl 到期回收整节点;readOnly→write 拒绝 |
| §6.1 | 491–499 | Device 连接建立 | `WS /system/device/ws` + Bearer SK;判定(L496);mountPath 缺省 `device/<deviceId>`(L499) |
| §6.2 | 501–531 | Device 帧协议 | `DeviceFrame`:hello/ready/call/result/cancel/ping/pong(L503–);`DeviceExpose{shell?,fs?,nodes?}`(L508);超时 60s + 幂等(L531) |
| §6.3 | 533–541 | Device 生命周期 | ready 后代写 NodeRegistry(L535);断线 offline(L536);24h 未重连回收(L537);shell 契约 `cmd exec`(effect destructive+confirm,L538);fs = file provider |
| §7 | 543–609 | SDK | `createToolBridge(config)`(L549);`reservedRoots`(L557);`maxHops`(L561);四注入点 StateStore/ObjectStore/SecretStore/DeviceTransport(L581–600);`ObjectStore.presign?`(L595);`DeviceConn`(L600) |
| §8.1 | 613–638 | PluginRegistry | builtin `system/plugin`;`PluginManifest{id,kind,interfaceVersion,endpoint,auth,healthPath,enabled}`(L624);`pluginToken` 仅一次(L634);注册自动探活+契约校验(L638) |
| §8.2 | 640–650 | PluginLifecycle | `GET {healthPath}`(L643)`GET /~describe` `GET /~help`;未声明的可选方法不会被调用;周期探活不自动注销(L650) |
| §8.3 | 652–669 | 传输契约(平台→Plugin) | `POST {endpoint}` + `X-TB-Context`(base64url,唯一载体,L659)+ `X-TB-Request-Id`(去重,L660);≤1MiB / 超时 30s(L667) |
| 附A | 671–689 | CLI 命令↔接口矩阵 | 见下文 §6;CLI 实现注记(whoami 语义/config 路径/readline,L689) |
| 附B | 692–703 | 接口↔User Case 追溯 | Case 1–7 到接口的映射 |

## 2. 核心数据模型与命名规则

- `Node`(Proto.md:300–308):主键 `path: TreePath`('/' 分隔,不含保留段);7 种 kind;`registeredBy=keyId`(device 由 Gateway 代写;自动物化中间 directory 记 `system:auto`,引导节点记 `system:boot`)。树路径中间级自动物化 directory:注册 `a/b/c` → `a`、`a/b` 也成节点(Proto.md:110);回收/conflict 规则见 Proto.md:370。
- `SecretKey`(Proto.md:197–208):主键 `id`(可公开,审计用);`hash=sha256(明文)`;`owner: OwnerRef`(`user:`/`agent:`/`device:` 前缀)。
- `ContextEntry`(Proto.md:452–463):主键 `uri = node://<namespace-path>/<entry-path>`;`version` 乐观并发(r2 落地 etag=version,L478);`contentType` 决定表现。
- `PluginManifest`(Proto.md:624–634):主键 `id`;`interfaceVersion` 形如 `<kind>/v<major>`。
- 保留段 `~help/~skill/~tree/~register/~describe`(Proto.md:112);保留根 `system`/`ui` + 部署追加(Proto.md:271)。
- builtin 模块名集合:`sk | secret | registry | plugin | status`(Proto.md:331,= Architecture.md 引导注册顺序;Phase 1 已物化前四个,plugin 在 Phase 5)。
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
- **401 未认证**(Proto.md:51):缺失/无法识别 SK(发生在 `Authorizer.Check` 之前)→ HTTP 401,body 复用 TBError 形状,`code:'permission_denied'`、`retryable:false`;**disabled/过期 SK 视同无法识别,同样 401**(Phase 1 定型)。
- **501 未实现占位**(Proto.md:53):`code:'unavailable'`、`retryable:false`。
- **503 设备离线**(Proto.md:55):`code:'unavailable'`、`retryable:true`。
- 超时常量勿混用:Device 调用转发默认 60s(Proto.md:531),平台→Plugin 调用默认 30s(Proto.md:667),Workers CPU 上限 30s/请求(docs/Reference.md:52)。建议分别命名常量。

## 4. Help DSL 格式(§1.3,Proto.md:124–166)

```
htbp 0.1                                       ← 首行:协议版本(§1.5)
node docs/context7 mcp "Context7 文档检索"      ← node 行:<path> <kind> <一句话描述>
cmd resolve-library-id POST /docs/context7      ← cmd 行:<name> <METHOD> </path>(带前导 /)
  body { "tool":"resolve-library-id", "arguments": { "libraryName": string } }
  returns markdown 文档库列表
  scope call                                    ← 必须声明(对应 §2.2 动作)
```

约束(Proto.md:139–143,docs/Reference.md:15):

- 每个 cmd **必须**声明 `scope`;`effect`/`confirm`/`h`(工具级描述,Phase 2 定型)可选。
- 属性行输出顺序 `h → body → returns → scope → effect → confirm`,两空格缩进(Proto.md:141)。
- cmd 命名(Proto.md:143):Provider 类节点 = 接口方法名**首字母大写**(context:`List/Get/Update/Write/Search`)或**工具原名**(mcp/http);仅 `system/*` builtin 用小写。
- 消费方对未知行**必须忽略**(向前兼容)。
- directory 节点的 `~help` 列子节点相对路径 + 一句话描述(Proto.md:95)。
- JSON 等价形状 `HelpJson`/`TreeJson`(Proto.md:145–166):cmds 的 `inputSchema` 是真 JSON Schema(不含 {tool,arguments} 信封),供 Dashboard @rjsf 渲染。

## 5. 内容协商规则(§1.2,Proto.md:116–122)

- 默认(无 Accept):`~help` → `text/plain`(Help DSL,唯一非 JSON 表现,无 markdown 变体);`~skill` 与调用返回值 → `text/markdown`(IANA 注册类型;不用 `application/markdown`,L122)。
- `Accept: application/json` → 结构化 JSON;两种表现**语义等价**,JSON 不得多/少字段(L145)。
- `~tree` 的非 JSON 表现是缩进文本树(排版实现自定);JSON(`TreeJson`)才是规范形状(Proto.md:141)。

## 6. CLI 命令矩阵(附A,Proto.md:671–689)

CLI 是纯 API 客户端,子命令一一映射 Proto 接口,随各 Phase 增量生长(DOD.md:17)。全局开关 `--json`;读 `TB_BASE_URL`/`TB_SK`。

| 命令 | 对应 API / 接口 | 交付 Phase |
|---|---|---|
| `tb init` | M10 部署向导 + §2.3 Admin SK 引导(可重入) | 6(骨架 0) |
| `tb login` / `whoami` / `use` | 本地凭据管理,**无服务端接口**(whoami = 本地配置态 + `~help` 探测 + status 摘要,注记 L689) | 1 ✅ |
| `tb status` | builtin `system/status` 的 `get`(登录态)/ 树外 `/healthz`(未登录回退) | 0/1 ✅ |
| `tb ls` / `tree` / `help` | §1.1 `~help` / `GET /~tree?depth=N` | 1 ✅ |
| `tb call` | §1.4 `POST /<path>` body `{tool,arguments}` | 2 |
| `tb tool mount` / `rm` | §3.3 NodeRegistry.Write/Delete(kind=mcp/http) | 2 |
| `tb server add` / `ls` / `rm` | §3.3(kind=remote,§3.4 联邦) | 2 |
| `tb ctx ls/cat/put/patch/search` | §5.1 四动词 + Search | 3 |
| `tb ctx mount` / `unmount` | §3.3(kind=context) | 3 |
| `tb connect` / `tb mount fs` | §7 connect / §6 帧协议 | 4/5 |
| `tb device ls` | §3.3 `List(prefix="device")` | 4 |
| `tb sk list/create/rm` | §2.3 SKRegistry(create 可带 register scope + registerPaths) | 1 ✅ |
| `tb secret set/ls/rm` | §2.5 SecretStore(authRef/skRef 来源) | 1 ✅ |
| `tb plugin register/list/health` | §8.1/§8.2 | 5 |

CLI 实现注记(Proto.md:689,Phase 1 定型):配置文件 `~/.config/tool-bridge/config.json`(XDG,多 profile);交互输入用 Node readline,`@clack/prompts` 留待 `tb init`(Phase 6)。

## 7. 已定型的实现契约(Phase 0/1 落地,原"Phase 0 契约"节)

- **`/healthz`**:已定型并回写 Proto.md:114——树外免认证,200 + `{"healthy":true,"version":"<x.y.z>"}`;`tb status --json` 可解析(原 doc-gaps G3 已闭环)。
- **401/可见性语义**:无 SK / 错 SK / disabled / 过期 → 401 裸 TBError(Proto.md:51);deny==not_found(Proto.md:260);判定次序 read→404 再 scope→403(Proto.md:183)。
- **内容协商**:DSL 与 JSON 语义等价已实现并有单测(DOD P1);`~skill` 仍 501 占位(Phase 1 范围外)。
- **Phase 1 网关落地的文件级映射**见 [../architecture/modules-and-boundaries.md](../architecture/modules-and-boundaries.md) "Phase 1 落地"节。
