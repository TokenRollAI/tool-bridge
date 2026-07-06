# Reference

> 本文是 tool-bridge 设计所依赖的外部协议、项目与平台能力的调研参考。所有结论截至调研时点,引用确切 URL 以便复核;标注"待复核"的条目需在对应 Phase 动工前验证。

## 1. HTBP(HTTP ToolBridge Protocol)—— 本项目实现的协议

- 仓库:<https://github.com/TokenRollAI/HTBP>(公开,Draft 阶段,仅协议文档)
- 核心 RFC:<https://github.com/TokenRollAI/HTBP/blob/main/docs/rfcs/RFC-0001-htbp-core.md>

核心理念:**"如果 Agent 能 fetch 一个 URL,它就应该能学会使用这个 URL 对应的工具。"** 解决的问题:许多 Agent 运行环境无法运行 MCP client / CLI / SDK,HTBP 让纯 HTTP Agent 也能发现并调用工具。

协议要点(tool-bridge 是其参考实现,Proto §1 与之对齐):

- **双平面**:Control Plane(`GET {path}/~help`、`GET {path}/~skill`、`POST {path}/~register`)+ Data Plane(节点调用,HTBP 不标准化 Provider 的原生 API)。
- **`~help`(必选)**:`text/plain` 的紧凑 Help DSL,面向 LLM 阅读;`cmd <name> <METHOD> <path>` 描述命令,附 `q`/`h`/`body`/`returns`/`scope`/`effect`/`confirm` 等属性;消费方对未知行必须忽略。
- **`~skill`(推荐)**:`text/markdown` 操作指南;作为远端文本不可覆盖用户意图(防 prompt injection)。
- **`~register`(可选)**:自助注册入口。
- **认证**:标准 `Authorization: Bearer`;scope 由 Provider 定义并在 Help 中按命令声明。
- **渐进式发现**:已知路径 → `~help` → 最小调用 → 必要时才读 `~skill` → 按需下钻,节省 context token。
- 与 MCP 关系:不替代 MCP;MCP 能力可被包装后由 HTBP 描述——这正是 tool-bridge 的 mcp 节点。

## 2. tool-bridge v1(前代实现,本仓库为重写)

- 仓库:<https://github.com/TokenRollAI/tool-bridge>(私有);线上:<https://tool-bridge.fantacy.live>
- 部署形态:Cloudflare Workers(wrangler 4.x + nodejs_compat),TypeScript,前端 React 19;adapter 代码位于 `src/worker/tb/`,测试用 Vitest。

v1 已验证的机制(重写时保留的设计资产):

- **五种节点类型**:`directory` / `mcp`(Streamable HTTP 叶子,内嵌全部工具 schema)/ `http` / `remote`(联邦到另一实例,白名单)/ `mount`(R2 bucket 前缀树挂成只读子树)。
- **工具虚拟化**:namespace 前缀、rename、hide、description override,对外只暴露虚拟名。
- **多租户**:Bearer token 作为 Secret Key,`sha256` 哈希后在 KV 查租户,加载租户专属树。
- **Crawler**:`GET /api/tree` 递归爬树(环检测、深度 ≤8、节点 ≤200、remote 白名单)——`/~tree` 的前身。
- **StorageProvider 接口**:抽象存储后端(当前 R2,S3 兼容可扩展)。

v1 的缺口(本次重写的动机,对应 TB.md):Context Layer 四动词读写面(v1 的 mount 只读)、Device 反向注册(WebSocket)、SK 作用域细粒度(v1 租户级整树隔离,无 path×action)、SDK/Plugin 一等支持、Docker 自部署、内容协商(markdown 默认)。

## 3. MCP(Model Context Protocol)—— 上游供给协议

- 规范:<https://modelcontextprotocol.io/specification>(Streamable HTTP transport)
- 官方 TS SDK:<https://github.com/modelcontextprotocol/typescript-sdk>(`@modelcontextprotocol/sdk`)

tool-bridge 作为 **MCP client** 连接上游 server:`tools/list` → `~help` 数据源,`tools/call` → 调用代理。要点:

- Streamable HTTP 是当前标准 transport(POST + 可选 SSE 流);SDK 的 `StreamableHTTPClientTransport` 可直接在 Workers 环境运行(fetch-based)。
- 会话:server 可返回 `Mcp-Session-Id`,client 需回传;会话失效(404)时重建会话再重试一次。
- 上游认证:MCP 规范推荐 OAuth 2.1,现实中大量 server 用静态 Bearer——`authRef` 两者都要支持(静态头优先落地,OAuth 待复核后排期)。

## 4. Cloudflare 平台能力地图(默认宿主)

| 组件 | 在 tool-bridge 中的用途 | 关键限制/价格 | 文档 |
|---|---|---|---|
| Workers | M1 网关本体(Hono 路由) | CPU 默认 30s/请求 | <https://developers.cloudflare.com/workers/> |
| Durable Objects | M4 每设备一个 `DeviceSession`(WS hibernation:空闲不计费;唤醒处理帧) | 单值 ≤2 MB;请求 $0.15/M;空闲对象零计费 | <https://developers.cloudflare.com/durable-objects/> |
| KV | M5 SK 哈希表、M1 树配置、M8 manifest | 最终一致;1 write/s/key(树配置写少读多,契合);**吊销传播窗口 ≤60s**(Proto §2.3) | <https://developers.cloudflare.com/kv/> |
| R2 | M3 r2 provider、大对象 `$ref`(**binding 不支持 presign**——预签名走 S3 兼容端点 + R2 Access Key,aws4fetch;Proto §5.2) | 零出口流量费;$0.015/GB-月 | <https://developers.cloudflare.com/r2/> |
| D1 | 审计留痕(后期可选) | 10 GB/库 | <https://developers.cloudflare.com/d1/> |
| Workers Static Assets | M9 Dashboard 构建产物与 gateway **同 Worker 部署**(assets 绑定,不额外加 Pages/Worker) | 静态请求免费 | <https://developers.cloudflare.com/workers/static-assets/> |
| Vectorize + Workers AI | `search:semantic` 的可选后端(Plugin 形态,非核心路径) | ≤1536 维 | <https://developers.cloudflare.com/vectorize/> |

**WS hibernation 注意点(Phase 4 前复核)**:DO 的 WebSocket Hibernation API(`state.acceptWebSocket` + `webSocketMessage` 钩子)允许连接保持时 DO 休眠;心跳用 `setWebSocketAutoResponse`(ping/pong 不唤醒 DO)。设备调用的 requestId↔调用方响应的关联需在 DO 内存/storage 中保存待决表,休眠唤醒后可恢复。

## 5. 选型清单(成熟框架优先,TB.md 注意 0)

| 要写的东西 | 用现成的 | 依据 |
|---|---|---|
| HTTP 路由/中间件 | **Hono**(Workers 生态事实标准,同一 app 可跑 Node) | <https://hono.dev> |
| Node 宿主(Docker) | **@hono/node-server** + **better-sqlite3**(StateStore)| Hono 官方 adapter |
| MCP client | **@modelcontextprotocol/sdk** | §3 |
| 校验/Schema | **zod**(含 JSON Schema 互转) | 生态标准 |
| S3 签名(Workers 内) | **aws4fetch**(纯 fetch 的 SigV4,免 AWS SDK 体积) | <https://github.com/mhart/aws4fetch> |
| CLI 框架 | **citty** 或 commander(择一;`tb init` 向导用 @clack/prompts) | Watt 已验证 @clack/prompts |
| WS(设备侧/Node) | **ws** + **partysocket 1.x**(通用封装 `partysocket/ws`,Node 兼容已 spike 实证:重连/退避/open 重触发均可用;`Authorization` 头 partysocket 选项不透传,须以 ws 子类在构造器第三参注入 headers——工厂函数按运行时 SK 生成子类) | Phase 4 spike(2026-07-06)验证 partysocket 1.3.0 + ws 8.21 |
| 测试 | **Vitest** + `@cloudflare/vitest-pool-workers`(DO/Worker 在真实 workerd 里测) | Watt 已验证 |
| 部署 | **wrangler**(pinned 版本,`npx --yes wrangler@<ver>`) | Watt 已验证 |
| Dashboard 框架 | **React 19 + Vite + TanStack Query**(数据层;构建产物经 Workers Static Assets 随 gateway 同 Worker 部署,路径 `/ui`) | v1 已用 React 19 |
| Dashboard UI 组件 | **Ant Design v5**(管理台的表单/表格/树导航组件齐备;不手写组件库、不用裸 index.html 交差) | <https://ant.design> |
| JSON Schema → 表单 | **@rjsf/core + @rjsf/antd**(react-jsonschema-form:`~help` JSON 表现中 cmd 的 inputSchema 直接喂给它自动渲染表单,不手写表单生成器) | <https://rjsf-team.github.io/react-jsonschema-form/>;**需验证**:React 19 + antd v5 需 `@ant-design/v5-patch-for-react-19`,@rjsf/antd 对 React 19 的 peer 支持随版本波动——Phase 6 前跑最小 spike(DOD Phase 6 前置项);兜底 @rjsf/mui 或裸 antd Form 手接 |
| markdown 渲染 | **react-markdown**(调用返回值默认 markdown 的展示) | 生态标准 |

> 表外的新需求先调研现成库/平台原语,确认无合适方案并在 PROGRESS.md 写明理由后,才允许手写。手写协议栈、重实现平台原语、自造重试/持久化,都是违例(LOOP.md 纪律 4)。

## 6. Docker 自部署路径(Case 4)

- 单镜像:`node:22-slim` 基底,内含 core + Hono node adapter + Dashboard 静态产物;`/data` 卷持久化(SQLite + 对象目录)。
- 与 CF 路径的差异全部收敛在 `StateStore`/`ObjectStore`/`SecretStore`/`DeviceTransport` 四个注入点(Proto §7);业务代码零分叉。
- presign 已定案:CF 与 node 侧统一走 S3 兼容端点(aws4fetch)生成——R2 binding 本身不支持 presign(Proto §5.2);file ObjectStore 无 presign 能力时用网关中转下载路由兜底。

## 7. 参照系:Watt 项目的迭代方法论

- 本仓库的 DOD.md / LOOP.md 结构移植自 Watt 项目(`DOD 定义什么算完成,LOOP 定义每轮怎么干`),该方法论已在 Watt 全程(Phase 0 → 六条 E2E 全绿)验证。
- tool-bridge 同时是 Watt 的上游依赖(Watt Architecture M4 的 Tool Gateway)——本仓库的通用网关能力(节点类型、`~help` 生成、虚拟化、租户/SK、协议细节)按 Watt LOOP §2.1 的分界属于上游职责,重写时保持这一定位:**tool-bridge 不含任何 Watt 特有语义**。
