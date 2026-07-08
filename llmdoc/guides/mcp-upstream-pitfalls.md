# Guide:MCP 上游生产坑(会话复用与不合规上游)

> 用途:挂载/排查 `kind:mcp` 上游时的已知坑与可重跑排查手法。来源:2026-07-07 生产故障取证与修复(挂载 MetaMCP 后"过一段时间工具全部消失")+ 2026-07-08 同故障复发取证(初版防御被 KV 读缓存击穿)+ 2026-07-08 飞书官方 MCP 接入(自定义认证头)。更新时机:MCP provider 会话机制变化或新上游坑出现时。

## 会话复用机制(gateway `providers/mcp.ts`)

- 上游签发的 `Mcp-Session-Id` 存 KV `mcpsession:<nodePath>`(**无 TTL**),后续请求带 sessionId 重建 transport,MCP SDK 对已设 sessionId 跳过 initialize(单趟往返)。
- 失效信号:上游 HTTP 400/404(`StreamableHTTPError`)→ 清缓存、完整握手重试一次并回填新会话。
- tools/list 结果另有 `toolcache:<path>` 缓存(TTL 300s;`~help?refresh=1` 强制重取)。两层缓存独立:refresh 只跳 toolCache,**不**跳会话。

## 坑:不合规上游对过期会话回 200 + 空列表(实测 MetaMCP)

- MCP spec 要求对过期 session 回 404;MetaMCP 空闲回收会话后把旧 session 当空会话,`tools/list` 正常返回空数组——网关侧毫无失效信号。
- 症状:节点 `~help` `cmds:[]`、调用一律 404「未知工具」,且不自愈(空列表还进 toolCache);注册面变更(触发 invalidate)前永不恢复。
- **防御(已实现)**:`list` 在"复用缓存会话 + 空列表"时视为可疑——清会话、**强制完整重握手**(`forceFresh`,不回读会话缓存)再取一次,仍空才相信;只重试一次不循环,真空列表的合规上游至多多付一趟握手。测试:gateway `tool.integration.test.ts`「mcp 会话复用:过期会话空列表防御」(默认离线,mock Streamable HTTP 上游)。
- **坑中坑:防御重试不得回读 KV(2026-07-08 复发根因)**。初版防御是"清会话(KV delete)→ 重试时 loadSession 回读 KV":同一请求内刚 get 过该 key,Cloudflare KV 边缘读缓存(≥60s)把刚删的旧会话又还回来 → 重试再次复用死会话 → 又拿到空列表 → 防御被击穿,空列表照进 toolCache。缓存命中是概率性的,故防御"有时自愈有时不能"——修复当天塞伪 session 验证通过、次日生产复发。修复:重试直接强制完整握手,不经会话缓存;钉死用例为同文件「KV 边缘读缓存吞掉 delete」(注入 delete 为 no-op 的 StateStore 模拟缓存窗口)。教训同 [workers-kv-pitfalls.md](workers-kv-pitfalls.md):**"删缓存后立刻回读"在 KV 上不成立,凡纠错路径都应绕开缓存读**。
- `call` 路径无此防御:工具名解析不到时走不到 call;上游对过期会话的 call 若返回 JSON-RPC 业务错误,网关无法与真实业务错误区分。

## 坑:需自定义认证头的上游(飞书官方 MCP)

- 端点 `https://mcp.feishu.cn/mcp`,认证不走 `Authorization: Bearer`:自定义头 `X-Lark-MCP-UAT`(用户凭证)或 `X-Lark-MCP-TAT`(应用凭证),token **原样注入**——挂载时 `--auth-header X-Lark-MCP-TAT --auth-scheme ''`(空串 scheme = 无前缀),config 即 `authHeader`/`authScheme`(与 http kind 同语义)。
- **必须带静态头 `X-Lark-MCP-Allowed-Tools`**(逗号分隔工具白名单,`--header` / config `headers`):缺失或写错时上游 `tools/list` **恒回空列表**——会触发上文的空列表防御(多付一趟完整重握手)后如实展示空。症状与"过期会话空列表"同貌,**排查时先查该头再怀疑会话层**(该头错时重握手也救不回来,这是与会话层故障的区分点)。
- 飞书 UAT/TAT 有效期约 2h;SecretStore 是静态存储,过期后上游回 401,须 `tb secret set` 手动续期,无自动刷新。**免人工续期的推荐路径是 `packages/plugin-feishu`**(tool-provider plugin,plugin 内 TAT 自动换发 + 上游 401 强制重换发自愈);其凭证不落 plugin:`tb secret set --name feishu-app`(值为 JSON `{"app_id","app_secret"}`)+ 挂载节点配 `authRef:"feishu-app"`,平台调用时经 `X-TB-Upstream-Auth` 注入。直挂 kind:mcp + 静态 TAT 适合一次性验证。
- 网关侧实现:每趟上游请求(initialize/notifications/tools list/call)合并 `headers` + 凭证头(凭证头覆盖同名静态头),见 gateway `providers/mcp.ts`;mock 上游断言用例在 gateway `tool.integration.test.ts`。

## 排查手法(生产可重跑)

- **区分缓存层**:`~help?refresh=1` 后仍异常 ⇒ 问题在会话层或上游本身,不在 toolCache。
- **手动强制重握手**:对节点做幂等 registry update(patch 同值 description)触发 `invalidateToolCache` + `invalidateMcpSession`;若恢复 ⇒ 根因锁定会话层。这也是线上应急恢复手段。
- **复现故障态**:`npx wrangler kv key put --namespace-id <tb-kv id> "mcpsession:<path>" '{"sessionId":"bogus","updatedAt":"<iso>"}' --remote` 塞伪会话,再打 `~help?refresh=1` 验证自愈(2026-07-07 生产实测:工具列表恢复、KV 自动回填新 session)。
- 上游凭据(SecretStore)只写不读拿不到明文,对上游直接取证只能无凭据探边界(看 401 形状);主要靠网关侧对照实验(旧会话 vs 新会话)定位。
