# Tool Bridge

Tool Bridge 是一个可部署到 Cloudflare Workers 的 MCP Streamable HTTP bridge。它把远端 MCP server 暴露的 `tools/list` 和 `tools/call` 转换成普通 HTTP call，并提供一个用于发现和调用 tool 的 Web UI。

本项目不是 HTBP protocol 本身；HTBP 的 RFC 和设计文档放在 `TokenRollAI/HTBP`。

## 能力

- 连接 MCP Streamable HTTP server
- 将 MCP `tools/list` 暴露为 HTTP JSON API
- 将 MCP `tools/call` 暴露为普通 `POST` call
- 为 configured MCP server 生成 `~help` 和 `~skill`
- **把 MCP / HTTP / 远端 TB 实例组织成一棵自描述、可递归的 TB Server 树**
- 提供 React + TanStack UI（含树视图）
- 可部署到 Cloudflare Workers
- 支持 bridge 自身的 Bearer token 或 OAuth JWT verification
- 支持向上游 MCP server 透传 Bearer token
- 统一错误契约（`UpstreamError → 502` 等，code 级 retryable 语义）
- Provider / Publication / Placement 控制面实体 + `/api/providers/**` 管理面（`tbp_` 自助 key）
- 单包多入口 SDK（如 `@tokenroll/tool-bridge/host`、`/admin`、`/tunnel-agent`）：见 `docs/sdk.md`（含全部 curl 等价表）
- 最小审计事件流（describe/call 全路径，含拒绝决策；`/api/audit/events`）

当前不支持 stdio transport，也不支持 MCP SSE fallback。

## TB Server 树（递归 `~help`）

Tool Bridge 把配置的资源组织成一棵树，每个节点都响应 `GET {path}/~help`，从根 Domain 出发即可逐级下钻：

```txt
GET /htbp/~help                          # Domain：列出 namespace / 子节点（相对路径）
GET /htbp/docs/~help                     # mid-path：列出下一层资源
GET /htbp/docs/context7/~help            # leaf：MCP server 整体作为 end-path，内嵌全部工具
POST /htbp/docs/context7                  # 调用：body {"tool":"<name>","arguments":{...}}
```

`~help` 默认返回 JSON payload（`description` + 下一层资源列表 + end-path 的 schema）；资源列表中的
`path` **始终是相对路径**，使任意子树都可被挂载到任意 domain/path。带 `Accept: text/plain` 时返回
等价的 HTBP text DSL，用于兼容纯文本 Agent。

**MCP server 作为整体叶子**：树递归到 MCP 节点即停，不再把每个工具拆成下一层路径。MCP 节点的
`~help` 是一个 end-path，其 `endpoint.tools` 内嵌该 server 暴露的所有工具（含 `inputSchema`）；调用统一
`POST /htbp/.../{mcp}`，在 body 里用 `tool` 字段选择具体工具。

节点类型（配置在 `MCP_SERVERS_JSON`）：

- `directory`：纯中间节点，`~help` 列出子节点。
- `mcp`：MCP Streamable HTTP leaf（整体叶子，工具内嵌）。
- `http`：Custom HTTP handler，声明 `endpoints[]`（method/url/inputSchema）。
- `remote`：联邦到另一个 TB 实例（`helpUrl`），由 crawler 跟进其 JSON `~help`。
- `mount`：把对象存储（Cloudflare R2 bucket）的前缀树挂成 TB 子树。前缀=目录、对象=只读叶子，按层
  懒加载（访问某层 `~help` 时才 list 该层）。
- `builtin`：宿主实现的 whole-leaf（形如 MCP 叶子），声明一组静态工具，工具实现由**宿主 Worker** 注入。
  adapter 只负责树/help/路由，实际 handler 通过 `AdapterContext.builtinHandlers` 传入——这样 tool-bridge
  保持通用，宿主（如 Watt）注入自己的 `websearch` 等实现。

### Builtin（宿主注入 handler）

`builtin` 节点声明工具及其 `handler` 名，handler 的具体实现由宿主在处理请求时通过
`AdapterContext.builtinHandlers`（一个 `{ [handler名]: (input, ctx) => result }` 注册表）注入：

```jsonc
{
  "type": "builtin",
  "id": "host",
  "title": "Host Tools",
  "builtin": {
    "tools": [
      { "name": "echo", "handler": "echo", "effect": "read" },
      { "name": "websearch", "handler": "websearch", "effect": "external", "scope": "net.search", "confirm": true }
    ]
  }
}
```

内置 `echoHandler`（`adapters/builtin.ts`）是一个即用参考实现，宿主可直接注册它或自己的 handler。工具的
`effect` / `scope` / `confirm` 语义字段会随 `~help`（JSON 与 text DSL）一并输出。

### 工具调用语义（effect / scope / confirm）

`mcp` 内嵌工具、`http` 端点、`builtin` 工具都可声明可选的调用语义，供 agent / UI 判断是否需要确认：

- `effect`：`read` | `write` | `destructive` | `external`（缺省视为 `external`，与历史行为一致）。
- `scope`：该调用所需的权限/能力范围（自由文本）。
- `confirm`：提示客户端调用前应确认。

这些字段进入 JSON `~help` 的 `endpoint`（whole-leaf 的每个 `tools[]` 条目或单发 endpoint），text DSL 里
则渲染为 `effect` 行以及可选的 `scope` / `confirm` 行。未声明时行为不变（`effect external`、无 scope、无
confirm），完全向后兼容。

### Mount（FS / S3 as TB）

`mount` 节点把一个 R2 bucket（或其下某个 `prefix`）映射成 TB 子树：每个文件夹是 directory，每个文件是
只读 end-path 叶子，`GET` 调用返回文件内容。

```jsonc
{ "type": "mount", "id": "files", "title": "Files", "bucket": "TB_FILES", "prefix": "docs" }
```

`bucket` 是 Worker 上的 R2 binding 名称（在 `wrangler.jsonc` 的 `r2_buckets` 里配置）。存储后端通过
`StorageProvider` 接口接入，目前实现了 R2；S3 兼容 API 等可作为后续 provider 接入而不改 adapter。

### Tools Management（工具虚拟化）

`mcp` 节点支持对其工具做 namespace 前缀、重命名、隐藏与描述覆盖。对外只暴露虚拟名，调用时由 bridge
反向映射回上游真实名；隐藏的工具不出现在 `~help` 中且调用被拒绝。

```jsonc
{
  "type": "mcp",
  "id": "context7",
  "endpoint": "https://mcp.context7.com/mcp",
  "namespace": "c7",                       // 暴露为 c7__<tool>，避免跨 server 重名
  "toolOverrides": {
    "query-docs": { "rename": "docs", "description": "Query the docs" },
    "resolve-library-id": { "hide": true }
  }
}
```

上例中 `query-docs` 对外是 `c7__docs`，`resolve-library-id` 被隐藏；调用 `POST /htbp/.../context7`
时 `tool` 只能填 `c7__docs`（填上游真实名 `query-docs` 会被拒绝）。

服务端 crawler：

```txt
GET  /api/tree            # 从根递归 crawl 整棵树（含工具 schema）
POST /api/crawl           # 自定义起点 / 深度，body: {start?, maxDepth?, maxNodes?}
```

crawl 带环检测、深度（≤8）与节点数（≤200）上限；远端节点强制 https、可选
`HTBP_REMOTE_ALLOWLIST` 白名单、大小与超时上限；单个节点失败不会中断整棵 crawl。

旧的扁平 `MCP_SERVERS_JSON` 与 `/mcp/{server}/...`、`/api/servers` 路由保持完全兼容：扁平配置会被
自动包装成根 directory 的 `mcp` 子节点。

## 本地运行

```bash
npm install
npm run dev
```

默认本地地址：

```txt
http://127.0.0.1:8787
```

线上部署地址：

```txt
https://tool-bridge.fantacy.live
```

`npm run dev` 会先构建 UI，再启动完整 Worker。不要只用 Vite UI 来验证 bridge，因为 API 需要 Worker 路由。

## 默认 MCP Server

本地默认配置包含一个公开的 Context7 MCP server：

```txt
https://mcp.context7.com/mcp
```

启动后可以直接在 `Configured` tab 看到 `Context7`，也可以在 `Ad-hoc` tab 直接点 `Discover`。

## HTTP API

```txt
GET  /api/auth/config
GET  /api/servers
GET  /api/servers/{server}/tools
POST /api/servers/{server}/tools/{tool}/call

POST /api/bridge/tools
POST /api/bridge/call

GET  /mcp/{server}/~help
GET  /mcp/{server}/~skill
POST /mcp/{server}/tools/{tool}
```

示例：

```bash
curl http://127.0.0.1:8787/api/servers

curl -X POST http://127.0.0.1:8787/api/bridge/tools \
  -H 'Content-Type: application/json' \
  --data '{"server":{"name":"context7","endpoint":"https://mcp.context7.com/mcp"}}'
```

调用 tool：

```bash
curl -X POST http://127.0.0.1:8787/api/bridge/call \
  -H 'Content-Type: application/json' \
  --data '{
    "server": {"name":"context7","endpoint":"https://mcp.context7.com/mcp"},
    "tool": "resolve-library-id",
    "arguments": {"query":"React query library","libraryName":"TanStack Query"}
  }'
```

## 配置 MCP Server

通过 `MCP_SERVERS_JSON` 配置 server。非 secret 可以放在 `wrangler.jsonc` 的 `vars` 中；secret 应通过 `.dev.vars` 或 `wrangler secret put` 注入。

```json
{
  "context7": {
    "name": "Context7",
    "endpoint": "https://mcp.context7.com/mcp",
    "description": "Public documentation MCP server",
    "headers": {
      "Authorization": "Bearer ${CONTEXT7_TOKEN}"
    },
    "allowedTools": ["resolve-library-id", "query-docs"]
  }
}
```

上游 header 支持两种 env 引用：

```txt
Bearer ${TOKEN_NAME}
Bearer $env:TOKEN_NAME
```

## Bridge Auth

如果不配置 `AUTH_BEARER_TOKEN` 或 `OAUTH_ISSUER`，bridge 处于 unauthenticated mode。

静态 Bearer gate：

```bash
wrangler secret put AUTH_BEARER_TOKEN
```

OAuth JWT verification：

```txt
OAUTH_ISSUER=https://issuer.example.com
OAUTH_REQUIRED_AUDIENCE=tool-bridge
OAUTH_JWKS_URI=https://issuer.example.com/.well-known/jwks.json
```

`OAUTH_JWKS_URI` 可省略；Worker 会读取 issuer 的 OpenID configuration 来发现 `jwks_uri`。

## 多租户（Tenant Isolation）

配置 `TENANTS` KV namespace 即开启多租户:**bearer token 此时被当作 Secret Key**,按其
`sha256` 哈希在 KV 中查到所属租户,加载该租户专属的 TB 树。租户之间互不可见、互不可调用——
A 的请求只能解析/调用/crawl A 树内的节点,访问 B 独有节点返回 404。

KV schema:

```txt
apikey:{sha256hex(secretKey)}  ->  {"tenantId":"acme","label":"...","createdAt":"..."}
tenant:{tenantId}              ->  该租户的树配置 JSON（同 MCP_SERVERS_JSON 形态）
```

原始 Secret Key 不落盘(只存哈希),按哈希查找,天然常量时间。

种数据并启用:

```bash
wrangler kv key put --binding=TENANTS "tenant:acme" '<tree-json>'
# hash 用 sha256(secretKey) 计算后填入
wrangler kv key put --binding=TENANTS "apikey:<sha256hex>" '{"tenantId":"acme"}'
curl -H "Authorization: Bearer <secretKey>" https://tool-bridge.fantacy.live/htbp/~help
```

未配置 `TENANTS` 时,bridge 退回单租户的全局 `MCP_SERVERS_JSON` 树(向后兼容,行为不变)。
本轮仅做隔离 + Secret Key;OAuth 用户、User Group/per-node 权限、admin 为后续。

## 部署

```bash
npm run deploy
```

部署前建议先跑：

```bash
npm run check
npx wrangler deploy --dry-run
```
