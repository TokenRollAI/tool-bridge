# v1 参考实现要点

> 用途:v1(前代实现)的可复用资产、重写动机与检索入口——涉及 v1 已解决过的机制时,先看本文确认踩坑结论,再按需去 v1 仓库读对应实现。更新时机:每次实际检索 v1 仓库后,把文件路径与踩坑结论回填到本文。

## v1 是什么

- 仓库:`github.com/TokenRollAI/tool-bridge`(**私有**;本机 gh 已登录 Disdjj,repo scope 可访问);线上 `tool-bridge.fantacy.live`。
- 形态:Cloudflare Workers(wrangler 4.x + nodejs_compat)+ TypeScript + React 19;**adapter 代码位于 `src/worker/tb/`**;测试用 Vitest。

## v1 已验证的设计资产(重写已继承)

| 资产 | 机制 | 重写落点 |
|---|---|---|
| 五种节点类型 | `directory` / `mcp`(Streamable HTTP 叶子)/ `http` / `remote`(联邦,白名单)/ `mount`(R2 前缀树只读子树) | 扩展为 7 种 kind(新增 builtin/context/device,mount 演进为 context) |
| 工具虚拟化 | namespace 前缀、rename、hide、description override,对外只暴露虚拟名 | core `tool/virtualize.ts` |
| 多租户 | Bearer token 作 SK,sha256 哈希后 KV 查租户,加载租户专属树 | SK 哈希表(`sha256(sk)→记录`) |
| Crawler | `GET /api/tree` 递归爬树:环检测、深度 ≤8、节点 ≤200、remote 白名单 | `/~tree` 的前身 |
| StorageProvider 接口 | 抽象存储后端(R2,S3 兼容可扩展) | 演进为 StateStore/ObjectStore 注入点 |

## v1 的缺口 = 本次重写动机(现状)

1. Context Layer 四动词读写面(v1 的 mount 只读)——**已实现**。
2. Device 反向注册(WebSocket)——**已实现**。
3. SK 作用域细粒度(v1 是租户级整树隔离,无 path×action)——**已实现**。
4. SDK/Plugin 一等支持——**已实现**。
5. Docker 自部署——**已实现**(`packages/server`,见 [../guides/docker-host.md](../guides/docker-host.md))。
6. 内容协商(markdown 默认)——**已实现**。

## 文件级检索地图(2026-07-06 已检索)

核心资产集中在 `src/worker/tb/`;主入口 `src/worker/index.ts`(手写路由 + 认证 + 内联 MCP client,1145 行)。

| 子系统 | v1 文件 | 机制一句话 |
|---|---|---|
| MCP 会话管理 | `src/worker/tb/mcp-client.ts`(权威版;`index.ts` L415-650 为等价内联旧版) | **完全无状态、每次调用重建会话**:initialize→拿 `MCP-Session-Id`→initialized(202)→list/call→finally DELETE;响应按 Content-Type 分流 JSON/SSE(手写逐行解析);有界读取(MAX_JSON/SSE_BYTES);全部失败在 `executeMcpRequest` 单点裹成 `UpstreamError→502`。无会话复用、无 404 重建重试(重写已新增两者)。 |
| 工具虚拟化 | `src/worker/tb/virtualize.ts` + `adapters/mcp.ts` | 对外只暴露虚拟名:`virtualizeTools` 应用 `toolOverrides`(hide 剔除、rename、`${namespace}__${name}` 前缀、description/effect/scope/confirm override 优先),产出 `{exposed, reverse Map}`;调用侧 `resolveUpstreamTool` 反查,查不到(含 hidden)抛 NotFound。每次 describe/call 重新 list+虚拟化,无缓存。 |
| KV 多租户 | `src/worker/tb/tenant.ts`(控制面 `entities.ts`) | Bearer 即 SK,存取一律 `apikey:{sha256(raw)}`,明文永不落库;principal(agent/provider/host/admin/service)绑定租户则加载 `tenant:{id}` 树 JSON 整树替换全局树(整树级隔离);key 前缀 `tbk_`/`tbp_`/`tbs_`,128 位熵。控制面 D-1"compile, don't rewrite":placement 请求时编译进运行时树,resolve/crawl/adapter 零改动。 |
| tree 环检测 | `src/worker/tb/crawl.ts` | 共享 `visited:Set<cycleKey>`(本地=resourcePath,远端=规范化 helpUrl),命中标 `truncated` 停止下钻;硬上限 depth≤8、nodes≤200;单节点失败 try/catch 写 `error` 字段不炸整棵树;remote fetch 受 https 强制 + `HTBP_REMOTE_ALLOWLIST` 白名单约束。 |

其他常用定位:`registry.ts`(树解析/findNode)、`resolve.ts`(路径→节点→describe/call 分发)、`errors.ts`(统一错误契约)、`help.ts`(Help DSL 渲染)、`materialize.ts`(${VAR} header 替换 + SSRF 白名单)、`adapters/`(每种节点类型一个 adapter)。

## v1 踩坑结论(重写已继承的设计)

1. 仅支持 Streamable HTTP,明确不支持 stdio/SSE fallback(README)。
2. 错误单一收敛点 + code 级 retryable(`RETRYABLE_CODES`,errors.ts)——保留"单 choke point"设计。
3. **deny == not_found**:隐藏/越权一律 404,不泄露存在性(errors.ts)。
4. SSRF 防护:上游/remote 强制 https + host 白名单(materialize.ts)。
5. 有界读取防 OOM:JSON/SSE/crawl fetch 均有大小上限。
6. 明文 SK 永不落库,mint 时返回一次(tenant.ts)。
7. v1 不含 hono/@modelcontextprotocol/sdk/zod——这三者是重写的新增基础设施,勿从 v1 抄手写实现(违反工程纪律"成熟框架优先")。
