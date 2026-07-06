# Plugin

> 本文是 tool-bridge Plugin 的编写指南:一个 Plugin 是什么、能提供什么能力、必须实现哪些契约、如何注册与调试。接口的规范性定义在 [Proto.md](./Proto.md)(本文引用其章节号);Plugin 在整体架构中的位置见 [Architecture.md](./Architecture.md) M8。

## 1. 一句话定义

**tool-bridge Plugin = 实现了某个 Provider 纯接口的、可注册的部署单元。**

你不需要理解 tool-bridge 的内部实现,只需要:

1. 挑一个 Plugin 类型(即挑一个接口);
2. 用任意语言/托管方式实现该接口的 HTTP 契约;
3. 向 `PluginRegistry` 注册一份 manifest,再把它挂到树上。

## 2. Plugin 能提供什么能力

| 类型(`kind`) | 实现的接口 | 给平台带来什么 | 典型例子 |
|---|---|---|---|
| `context-provider` | `ContextProvider`:**List / Get / Update / Write**(+ 可选 Search / Watch / Delete),Proto §5.1 | 一种新的上下文来源,挂载为树上一个 context 节点 | 飞书文档、Notion、内部 Wiki、mem0 |
| `tool-provider` | `ToolProvider`:**List / Get / Call**,Proto §4.1 | 一批新工具,挂载到树上任意路径 | 内部订单系统 API、聚合网关 |

> 上游 MCP server **不需要写 Plugin**——那是 `NodeRegistry.Write{kind:'mcp'}` 的一条配置数据(Proto §3.2);简单的 HTTP endpoint 同理(kind=`http`)。只有当来源需要自定义逻辑(协议转换、聚合、缓存)时才写 Plugin。

**能力边界**:Plugin 只能做两件事——(a) 响应平台对上述接口的调用;(b) 若注册响应签发了 `pluginToken`,可用它回调平台接口。Plugin 拿不到 manifest 之外的任何权限。

## 3. 通用契约(所有类型必须实现)

> 规范性传输契约(请求 envelope、`X-TB-Context` 上下文头、重试/超时/大载荷规则)以 Proto §8.3 为准。

```
GET  {endpoint}{healthPath}   → { "healthy": true }
GET  {endpoint}/~describe     → { "kind": "...", "interfaceVersion": "...", "capabilities": [...] }
GET  {endpoint}/~help         → 方法集合的 Help DSL(注册时做契约校验)
GET  {endpoint}/~skill        → 推荐:markdown 使用指南
POST {endpoint}               → {"tool":"<Method>","arguments":{...}} 方法调用
```

- `~describe.capabilities` 声明可选能力(如 `search`、`search:semantic`、`delete`);未声明的可选方法平台永远不会调用。
- 写好 `~help`,你的 Plugin 就同时对人类(Dashboard 展示)和 LLM(Agent 理解)自解释。

## 4. 编写步骤(以"飞书文档 Context Provider"为例)

**Step 1 — 实现四动词 + 元端点。** 任意语言、任意托管(推荐 Cloudflare Worker,也可以是内网的一个 HTTP 服务):

```
POST /            {"tool":"List",  "arguments":{"path":"", "opts":{"cursor":null}}}
                  → {"items":[{"uri":"...","contentType":"text/markdown",...}], "cursor":null}
POST /            {"tool":"Get",   "arguments":{"path":"doccnX8..."}}
                  → {"uri":"...","content":"# 会议纪要 ...","version":"7","metadata":{...}}
POST /            {"tool":"Write", "arguments":{"path":"doccnY2...","entry":{...}}}
POST /            {"tool":"Update","arguments":{"path":"doccnY2...","patch":{...}}}
GET  /~help       → Help DSL(四条 cmd + search)
GET  /~describe   → {"kind":"context-provider","interfaceVersion":"context-provider/v1",
                     "capabilities":["search"]}      # 飞书支持全文检索 → 声明 search
GET  /healthz     → {"healthy":true}
```

动词映射由你决定,语义合理即可:`List`=列举知识库节点、`Get`=读文档转 markdown、`Write`=新建文档、`Update`=追加/改写块。飞书 app 凭证保存在 Plugin 自己一侧——平台永远不经手。

**Step 2 — 注册。** 调用 `PluginRegistry.Write`(Proto §8.1),CLI 一条命令或 Dashboard 表单:

```jsonc
{
  "id": "feishu-docs",
  "kind": "context-provider",
  "interfaceVersion": "context-provider/v1",
  "endpoint": "https://feishu-docs-provider.example.workers.dev",
  "auth": { "kind": "platform-token" },
  "healthPath": "/healthz",
  "enabled": true
}
```

平台自动执行:探活 → 抓 `~help`/`~describe` 契约校验 → 可被挂载。

**Step 3 — 挂载。** `NodeRegistry.Write`(Proto §3.3)把 Provider 绑定到树上一个路径:

```jsonc
{ "path": "docs/feishu", "kind": "context", "description": "飞书知识库",
  "config": { "kind": "context", "provider": "feishu-docs" } }
```

从此任何 Agent(含纯 HTTP Agent)都能:

```
GET  /docs/feishu/~help
POST /docs/feishu   {"tool":"Get","arguments":{"path":"doccnX8..."}}
```

**Step 4 — 授权。** 默认没有任何 SK 能访问新节点;由 admin 签发或更新 SK 的 scope(Proto §2.2):

```jsonc
{ "pattern": "docs/feishu/**", "actions": ["read"] }
```

`tool-provider` 的差异仅在 Step 1 的方法集合(List/Get/Call)与挂载 kind。

## 5. 部署形态

| 形态 | 适用 | 说明 |
|---|---|---|
| **平台内 Worker(推荐)** | 大多数 Provider | 与平台同帐号部署,`endpoint` 可用 `binding:<name>` 走 service binding;冷启动毫秒级、空闲零成本 |
| **外部 HTTP 服务** | 依赖内网资源、非 JS 技术栈 | 任何能被平台 HTTPS 访问的服务;自带重试幂等(平台按 `X-TB-Request-Id` 重试) |
| **SDK 内嵌(免注册)** | 本机/私有部署 | 直接 `tb.registerContext(path, provider)`(Proto §7)——Plugin 契约的进程内形态;再经 `tb.connect` 反向挂到远程实例 |

## 6. 版本与兼容

- `interfaceVersion` 形如 `<kind>/v<major>`;平台对同一 major 保证向后兼容(只增可选字段/可选方法)。
- 破坏性变更 → 新 major 并行提供,旧版本进入弃用期;Plugin 升级 = 更新实现 + `PluginRegistry.Update`。
- Plugin 对未知字段必须忽略(与 HTBP 的"忽略未知行"一致)。

## 7. 调试清单(发布前自查)

1. `curl {endpoint}/~help` —— Help DSL 是否列全了接口方法、每个 cmd 的参数/返回/scope 是否可读;
2. `curl {endpoint}/~describe` —— kind / interfaceVersion / capabilities 与实现一致;
3. 四动词幂等性:`Write` 重放同一 path 结果一致;`Update` 对不存在的 path 返回 `not_found`;
4. 错误形状:所有失败路径返回 `TBError`(Proto §0.2),`retryable` 标注正确;
5. 分页:`List` 超过一页时 `cursor` 往返可用;
6. 鉴权:不带(或带错)凭证的请求必须被拒;
7. 挂载到 staging 后,让一个 LLM Agent 只靠 `~help`/`~skill` 正确调用一遍——接口自解释质量的最终验收。
