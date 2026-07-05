# Tool Bridge SDK（单包多入口）— API 与 curl 等价表

SPEC-001 §8.1 不变量：wire contract 是产品本体，SDK 只是便利层——**不存在只有 SDK
能做的事**。下表给出每个 SDK 方法对应的公开 API 与 curl 复现方式。conformance
测试（`src/sdk/host/host.test.ts`、`src/worker/tb/provider-api.test.ts`）对 SDK 与
原始请求跑同一断言集。

约定：`$TB` = bridge base URL；`$ADMIN` = admin key；`$HOST` = 宿主 S2S key
（`tbk_`）；`$TBP` = provider key（`tbp_`）。所有 token 一律走 `Authorization:
Bearer`，绝不进 query string（§8.2）。

## 错误契约（M0）

所有错误统一信封：`{"error":{"code":"...","message":"...","details":...}}`。

| code | HTTP | retryable |
| --- | --- | --- |
| `UpstreamError`（上游传输/供给方失败） | 502 | ✅ |
| `EndpointUnavailable`（保留给 Tunnel/Device） | 503 | ✅ |
| `Forbidden`（已认证但无权限） | 403 | ❌ |
| `not_found` / `bad_request` / `unauthorized` / `method_not_allowed` / `internal_error` | 404/400/401/405/500 | ❌ |

retryable 语义按 code 判定（`RETRYABLE_CODES`），wire 信封不变；SDK 侧暴露为
`TBApiError.retryable`。

## 发布形态：一个包，多个入口

当前 SDK 作为同一个 npm 包发布/接入，不拆成 `tb-host`、`tb-admin`、
`tb-tunnel-agent` 三个包。npm 包名为 `@tokenroll/tool-bridge`，不同角色通过 subpath exports 选择入口：

| 入口 | 用途 |
| --- | --- |
| `@tokenroll/tool-bridge/host` | Host SDK：宿主嵌入、builtin 注入、mounts.sync、树调用 |
| `@tokenroll/tool-bridge/admin` | Admin SDK：provider、host、endpoint、audit 等管理面 |
| `@tokenroll/tool-bridge/tunnel-agent` | Tunnel Agent Kit skeleton |
| `@tokenroll/tool-bridge/transport` | `https` / `serviceBinding` transport |
| `@tokenroll/tool-bridge/worker` | Worker bridge embedding surface |

这样保持一个版本号和一个安装包，同时避免 API 混在同一个顶层 namespace 里。

## Host SDK（M1）

```ts
import { createToolBridgeHost, https, serviceBinding } from '@tokenroll/tool-bridge/host';

const tb = createToolBridgeHost({
  transport: serviceBinding(env.TOOLBRIDGE), // 或 https('https://bridge.example.com')
  credential: env.TB_HOST_KEY,               // 浅档 S2S key（principal=host）
  hostId: 'watt',
});
```

| SDK 调用 | 等价请求 |
| --- | --- |
| `tb.tree.help('watt/websearch')` | `curl -H "Authorization: Bearer $HOST" -H "Accept: application/json" $TB/htbp/watt/websearch/~help` |
| `tb.tree.help(path, {accept:'text'})` | 同上，`Accept: text/plain` |
| `tb.tree.call('watt/websearch/search', {arguments:{q:'x'}}, {as:'user-42'})` | `curl -X POST -H "Authorization: Bearer $HOST" -H "X-TB-On-Behalf-Of: user-42" -H "Content-Type: application/json" -d '{"arguments":{"q":"x"}}' $TB/htbp/watt/websearch/search` |
| `tb.mounts.sync(mounts)` | `curl -X POST -H "Authorization: Bearer $HOST" -H "Content-Type: application/json" -d '{"mounts":[{"path":"watt/websearch","binding":{"type":"builtin","tools":[{"name":"search","handler":"websearch"}]}}]}' "$TB/api/hosts/watt/mounts:sync"` |
| `tb.builtins.register(name, fn)` | 无运行时 API——builtin 注入是**部署期代码行为**：`export default createBridge({ builtinHandlers: tb.builtins.registry() })` 随宿主 Worker 部署 |
| `tb.adapters.wattError()` | 纯本地映射：401→`unauthenticated`、403→`permission_denied`、404→`not_found`、409→`confirmation_required`、502/503→`unavailable(retryable)` |
| `tb.adapters.effectMap({external:'destructive'})` | 纯本地映射：平台 `effect` 四值 → 宿主方言（未申报默认 `external`，保守映射） |

`as` / `traceId` / `reason` 分别对应 `X-TB-On-Behalf-Of` / `X-TB-Trace-Id` /
`X-TB-Reason` 头：**审计标注，不是凭据**，不参与授权。

### 宿主注册（admin）

| 操作 | 请求 |
| --- | --- |
| 注册宿主 | `curl -X POST -H "Authorization: Bearer $ADMIN" -d '{"id":"watt","confirmDelegated":true}' $TB/api/hosts` （同时创建 first-party provider `watt` 与空租户树 `tenant:watt`） |
| 签发 S2S key | `curl -X POST -H "Authorization: Bearer $ADMIN" -d '{"label":"watt-gateway"}' $TB/api/hosts/watt/keys` （raw key 只返回一次） |
| 查看宿主 | `curl -H "Authorization: Bearer $ADMIN" $TB/api/hosts/watt` |

## Admin SDK（M1/M2/M3/M4 管理面）

```ts
import { createToolBridgeAdmin } from '@tokenroll/tool-bridge/admin';
import { https } from '@tokenroll/tool-bridge/transport';

const admin = createToolBridgeAdmin({ transport: https(baseUrl), credential: adminKey });
```

| SDK 调用 | 等价请求 |
| --- | --- |
| `admin.providers.list()` | `curl -H "Authorization: Bearer $ADMIN" $TB/api/providers` |
| `admin.providers.create({id:'acme'})` | `curl -X POST -H "Authorization: Bearer $ADMIN" -d '{"id":"acme"}' $TB/api/providers` |
| `admin.providers.get/update/delete('acme')` | `GET/PUT/DELETE $TB/api/providers/acme` |
| `admin.providers.createKey('acme')` | `curl -X POST -H "Authorization: Bearer $ADMIN" -d '{}' $TB/api/providers/acme/keys` → `tbp_` key，只返回一次 |
| `admin.publications.create('acme', pub)` | `curl -X POST -H "Authorization: Bearer $TBP" -d '{"pubId":"search","binding":{...}}' $TB/api/providers/acme/pubs` （tbp_ key 只能写自己名下） |
| `admin.publications.publish('acme','search')` | `curl -X POST -d '{}' $TB/api/providers/acme/pubs/search/publish` |
| `admin.placements.list('a')` | `curl -H "Authorization: Bearer $ADMIN" "$TB/api/placements?tenant=a"` |
| `admin.placements.dryRun(p)` | `curl -X POST -d '{...,"dryRun":true}' $TB/api/placements` → 受影响 grant/path 预检报告，不落库 |
| `admin.placements.put(p)` | `curl -X POST -d '{"tenantId":"a","path":"tools/search","pubRef":{"providerId":"acme","pubId":"search"}}' $TB/api/placements` |
| `admin.placements.delete(id,'a',{dryRun})` | `curl -X DELETE "$TB/api/placements/{id}?tenant=a[&dryRun=true]"` |
| `admin.hosts.create({id:'watt'})` | `curl -X POST -H "Authorization: Bearer $ADMIN" -d '{"id":"watt"}' $TB/api/hosts` |
| `admin.hosts.get/createKey('watt')` | `GET /api/hosts/watt` / `POST /api/hosts/watt/keys` |
| `admin.endpoints.list/create/get/update/revoke()` | `GET/POST /api/endpoints`、`GET/PUT/DELETE /api/endpoints/{id}` |
| `admin.commandPolicies.list/create/get/update/delete()` | `GET/POST /api/command-policies`、`GET/PUT/DELETE /api/command-policies/{id}` |
| `admin.audit.events({tenant:'a',limit:50})` | `curl -H "Authorization: Bearer $ADMIN" "$TB/api/audit/events?tenant=a&limit=50"` |
| `admin.servers.list/create/delete()` | `GET/POST /api/servers`、`DELETE /api/servers/{id}`（legacy MCP server 兼容层，写入 provider/publication/placement） |
| `admin.servers.tools/help/skill/call(id, tool)` | `GET /api/servers/{id}/tools`、`GET /api/servers/{id}/~help`、`GET /api/servers/{id}/~skill`、`POST /api/servers/{id}/tools/{tool}` |
| `admin.bridge.tools/call({endpoint}, tool)` | `POST /api/bridge/tools`、`POST /api/bridge/call`（ad-hoc MCP server） |
| `admin.tree.get/crawl/help/call()` | `GET /api/tree`、`POST /api/crawl`、`GET /htbp/<path>/~help`、`POST /htbp/<path>` |

## Tunnel / Device（M2）

M2 使用占位接口边界：`/tunnel/*` 只处理已注册 endpoint 的最小 session 形状；
不实现凭据加密、token 轮换、deep verifier、OAuth 或 S2S key 生命周期。

| 操作 | 请求 |
| --- | --- |
| 注册 endpoint | `curl -X POST -H "Authorization: Bearer $ADMIN" -d '{"id":"sbx_1","tenantId":"a","kind":"sandbox","capabilities":["exec.run","fs.read","logs.tail"]}' $TB/api/endpoints` |
| 注册命令策略 | `curl -X POST -H "Authorization: Bearer $ADMIN" -d '{"id":"safe","defaultMode":"deny","allowCommands":["npm","pnpm"],"maxTimeoutMs":30000}' $TB/api/command-policies` |
| endpoint 建连 | `curl -X POST -d '{"endpointId":"sbx_1"}' $TB/tunnel/connect` → `{sessionId}` |
| 能力上报 | `curl -X POST -d '{"endpointId":"sbx_1","sessionId":"...","capabilities":["exec.run"]}' $TB/tunnel/capabilities`（只能收窄预注册能力） |
| device help | `curl -H "Authorization: Bearer $TBK" $TB/htbp/~device/sbx_1/~help` |
| argv 执行 | `curl -X POST -H "Authorization: Bearer $TBK" -d '{"argv":["npm","test"],"timeoutMs":30000}' $TB/htbp/~device/sbx_1/exec.run` |
| 文件读取 | `curl -X POST -H "Authorization: Bearer $TBK" -d '{"path":"/workspace/README.md"}' $TB/htbp/~device/sbx_1/fs.read` |

`exec.run` 只接受结构化 `argv`，`shell.run` 默认不暴露；全局策略会在 broker
dispatch 前拒绝危险命令模式。离线 endpoint 返回 `EndpointUnavailable → 503`。

Tunnel Agent Kit skeleton：

```ts
import { createTunnelAgent } from '@tokenroll/tool-bridge/tunnel-agent';

const agent = createTunnelAgent({
  transport,
  endpointId: 'sbx_1',
  dispatch: async (request) => runLocalCapability(request),
});

const { sessionId } = await agent.connect();
await agent.heartbeat();
await agent.reportCapabilities(['exec.run']);
```

## 审计（M4）

| 操作 | 请求 |
| --- | --- |
| 最近事件 | `curl -H "Authorization: Bearer $ADMIN" "$TB/api/audit/events?limit=50"`（租户 key 只能看本租户事件） |

每次 `describe`/`call`（含 401/403/404 拒绝路径）产生一条结构化事件：
`actor / tenant / path / tool / provider / effect / scope / decision / result /
status / errorCode / traceId / latencyMs`，并预留 SPEC-005 计量字段（`usage`）。
脱敏红线：绝不落 key、凭据、token、原始入参/出参（只记录字节数与顶层键名）。
响应携带 `X-TB-Trace-Id`（可用同名请求头传入既有 traceId）。
