# Guide:MCP 上游生产坑(会话复用与不合规上游)

> 用途:挂载/排查 `kind:mcp` 上游时的已知坑与可重跑排查手法。来源:2026-07-07 生产故障取证与修复(挂载 MetaMCP 后"过一段时间工具全部消失")。更新时机:MCP provider 会话机制变化或新上游坑出现时。

## 会话复用机制(gateway `providers/mcp.ts`)

- 上游签发的 `Mcp-Session-Id` 存 KV `mcpsession:<nodePath>`(**无 TTL**),后续请求带 sessionId 重建 transport,MCP SDK 对已设 sessionId 跳过 initialize(单趟往返)。
- 失效信号:上游 HTTP 400/404(`StreamableHTTPError`)→ 清缓存、完整握手重试一次并回填新会话。
- tools/list 结果另有 `toolcache:<path>` 缓存(TTL 300s;`~help?refresh=1` 强制重取)。两层缓存独立:refresh 只跳 toolCache,**不**跳会话。

## 坑:不合规上游对过期会话回 200 + 空列表(实测 MetaMCP)

- MCP spec 要求对过期 session 回 404;MetaMCP 空闲回收会话后把旧 session 当空会话,`tools/list` 正常返回空数组——网关侧毫无失效信号。
- 症状:节点 `~help` `cmds:[]`、调用一律 404「未知工具」,且不自愈(空列表还进 toolCache);注册面变更(触发 invalidate)前永不恢复。
- **防御(已实现)**:`list` 在"复用缓存会话 + 空列表"时视为可疑——清会话、完整重握手再取一次,仍空才相信;只重试一次不循环,真空列表的合规上游至多多付一趟握手。测试:gateway `tool.integration.test.ts`「mcp 会话复用:过期会话空列表防御」(默认离线,mock Streamable HTTP 上游)。
- `call` 路径无此防御:工具名解析不到时走不到 call;上游对过期会话的 call 若返回 JSON-RPC 业务错误,网关无法与真实业务错误区分。

## 排查手法(生产可重跑)

- **区分缓存层**:`~help?refresh=1` 后仍异常 ⇒ 问题在会话层或上游本身,不在 toolCache。
- **手动强制重握手**:对节点做幂等 registry update(patch 同值 description)触发 `invalidateToolCache` + `invalidateMcpSession`;若恢复 ⇒ 根因锁定会话层。这也是线上应急恢复手段。
- **复现故障态**:`npx wrangler kv key put --namespace-id <tb-kv id> "mcpsession:<path>" '{"sessionId":"bogus","updatedAt":"<iso>"}' --remote` 塞伪会话,再打 `~help?refresh=1` 验证自愈(2026-07-07 生产实测:工具列表恢复、KV 自动回填新 session)。
- 上游凭据(SecretStore)只写不读拿不到明文,对上游直接取证只能无凭据探边界(看 401 形状);主要靠网关侧对照实验(旧会话 vs 新会话)定位。
