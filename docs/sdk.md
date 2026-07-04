# Host SDK / Admin SDK — API 与 curl 等价表

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

## Host SDK（`@tokenroll/tb-host`，M1）

```ts
import { createToolBridgeHost, https, serviceBinding } from '@tokenroll/tb-host';

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

## Admin SDK（`@tokenroll/tb-admin` provider 子集，M3）

```ts
import { createToolBridgeAdmin, https } from '@tokenroll/tb-admin';
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

## 审计（M4）

| 操作 | 请求 |
| --- | --- |
| 最近事件 | `curl -H "Authorization: Bearer $ADMIN" "$TB/api/audit/events?limit=50"`（租户 key 只能看本租户事件） |

每次 `describe`/`call`（含 401/403/404 拒绝路径）产生一条结构化事件：
`actor / tenant / path / tool / provider / effect / scope / decision / result /
status / errorCode / traceId / latencyMs`，并预留 SPEC-005 计量字段（`usage`）。
脱敏红线：绝不落 key、凭据、token、原始入参/出参（只记录字节数与顶层键名）。
响应携带 `X-TB-Trace-Id`（可用同名请求头传入既有 traceId）。
