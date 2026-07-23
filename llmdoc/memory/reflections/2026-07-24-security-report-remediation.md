# 反思:安全报告复核、纵深修复与提交前复审

## Task

- 逐项复核一份覆盖 OAuth、SK、KV、remote、`$ref`、设备连接与部署面的十项安全报告,区分可利用漏洞、显式能力委托、平台一致性边界和运维加固项。
- 修复已证实的问题,为 Workers 与 Node 两种宿主补对等测试,同时避免为了“关闭 finding”引入更弱或不可验证的替代方案。

## Expected vs Actual

- 报告中的 OAuth callback 反射型 XSS 可直接成立;同源 Dashboard 的 `tb.profiles` 会放大影响,因此必须同时做输出编码、callback 严格 CSP/no-store 和全局 HTML 安全头。
- KV 文档只保证变更通常在约 60 秒内可见、也可能更久;`/~ref` 是有时效的 bearer capability,可复用本身不是 audience 绕过。但首轮把 `skRef` 视为“只能由管理员配置”的 service-account capability 是错误假设:`~register` 与 registry write/update 并未对 `skRef/authRef` 做额外授权,受限注册者可以引用平台已有 Secret,原报告的 confused-deputy 风险成立。
- `sessionStorage` 或浏览器端“加密 localStorage”不能阻止同源 XSS 读取凭据;认证热路径再叠内存缓存会延长 KV 吊销陈旧窗口;给 `$ref` token 加 nonce 但没有强一致消费状态也不能实现一次性语义。

## What Went Wrong

1. **把攻击链条件写成无条件账户接管。** XSS 与 Dashboard 凭据必须位于同一 origin,受害者还需在该 origin 使用过 `/ui`;漏洞仍是 Critical,但威胁模型应明确。
2. **把平台说明写成硬 SLA。** “约 60 秒”曾被 README、llmdoc 与验收脚本逐步复制成“最长 60 秒”,掩盖了 KV 可能更久的事实。
3. **用存储介质替代 XSS 边界。** `localStorage → sessionStorage` 只缩短持久时间,不隔离同源脚本;HttpOnly cookie 则需要服务端 session、CSRF 和跨 origin 登录模型的完整设计,不能当局部补丁。
4. **只修 Worker 入口会造成宿主分叉。** 安全头最初放在 `app.ts`,Node/SDK 的 `createTbApp` 路径不会获得保护;设备吊销同样必须同时覆盖 DO hibernation 与 Node DeviceHub。
5. **响应包装可能破坏流语义。** 为统一加响应头而无条件 `new Response(response.body, ...)` 会破坏 Hono Node adapter 的自定义流对象;应优先原位修改 headers,仅在 headers 不可变时克隆,并跳过 101/WebSocket。
6. **没有验证配置写入者就假设 capability 由管理员授予。** 判断 `skRef/authRef` 是否越权不能只看调用路径,必须从所有 NodeConfig 写入口反查谁能写引用、是否有 Secret 使用权限。`~register` 只要求目标路径的 register,因此“管理员配置”不是代码不变量。
7. **在异步重验中忽略连接代际。** DO/Node 在读取连接 A 后 await `identify`,期间连接 B 可接管;恢复后若不重新比较 active connection,会把调用发给 A,DO 还可能用陈旧 meta 把 B 标记离线。安全重验必须同时验证凭据、授权范围和连接代际。

## What Worked

1. **先按数据流验证再定级,并用独立复审纠正遗漏。** OAuth 链路与 KV 语义判断成立;提交前从 NodeConfig 写入口重新追踪 Secret Reference 后,及时推翻了“管理员配置”的错误前提。
2. **用 fail-closed 收紧 Workers 首次引导。** Workers 未配置 `TB_BOOTSTRAP_ADMIN_SK` 时不再生成并写日志,而是拒绝初始化。提交前复审进一步确认正式 Node/Docker server 仍默认走随机生成并打印明文的兼容路径,不能把它与本地 SDK 一并视为安全豁免。
3. **建立了长期凭据重验点,但尚未形成可靠安全属性。** DO 与 Node 已在 invoke 前调用 `identify`,可覆盖简单的 disabled/delete/expiry 用例;连接替换竞态以及 scope/registerPaths 收紧仍未处理,因此本轮只能记为部分修复。
4. **测试安全属性而非只测状态码。** 用例覆盖恶意 callback 被实体编码、严格 CSP/no-store、普通错误响应也有安全头、canonical OAuth redirect、remote 审计 actor、不记录明文凭据、`$ref` no-store 和连接吊销后 503/错误帧。
5. **配置与代码同轮收口。** production `workers_dev:false`、`preview_urls:false`、`TB_CANONICAL_ORIGIN` 与 OAuth 实现、模板说明一起更新,防止部署面重新打开备用 origin。

## Stable Promotion Candidates

1. 安全报告必须把“漏洞成立条件、攻击者可控字段、配置写入者、Secret 使用权限、持久状态”分开验证。高权限 service credential 可以是合法 capability,但只有当所有写入口都强制 capability 所有权/授权时才能这样定性。
2. 同源 XSS 的直接修复是上下文正确的输出编码和 CSP;浏览器存储替换不是 XSS 隔离。若改 HttpOnly cookie,必须作为 session/CSRF/BFF 架构任务处理。
3. 最终一致存储上的撤销说明不得承诺硬上限;本地缓存不能作为主动失效机制。需要确定性即时撤销时,应迁移认证真源到强一致协调面。
4. 长连接认证不能只在握手验证;敏感调用和休眠恢复的重验必须同时检查凭据有效性、当前 scopes/registerPaths 与连接代际。任何跨存储/网络 await 后都要重新确认 activeConnId,断开清理须按 connId 条件执行;多宿主实现必须有 barrier 并发测试。
5. 公共响应中间件必须保留 streaming/WebSocket adapter 语义;安全头测试应覆盖 Worker 与 Node 两个入口。

## Follow-up

- **合入阻断:**在 `~register` 与 registry write/update 统一限制 `skRef/authRef` 的使用,覆盖 remote/mcp/http/context/tool/plugin,并增加低权限注册者引用他人 Secret 的拒绝测试。
- **合入阻断:**修复 DO `activeSocket/initSession/markDisconnected` 与 Node `DeviceHub.invoke` 的连接替换 TOCTOU,增加可控 barrier 测试;重验时同步检查 scope/registerPaths 收紧。
- Node/Docker server 首次启动必须像 Workers 一样要求预置 Admin SK;只给 SDK 或显式 insecure dev 模式保留随机 bootstrap。
- `TB_CANONICAL_ORIGIN` 已配置但非法时应 fail closed,并补 Node/SDK 配置面对等与 OAuth DCR redirect 缓存迁移。
- Cloudflare KV 的确定性即时撤销需要 Durable Object/D1 等强一致认证架构,不属于本次局部修复。
- Dashboard 若要消除 JS 可读 SK,需要服务端 session + HttpOnly cookie + CSRF + 多网关连接模型的产品设计;当前以消除已知 XSS、严格 CSP 和缩短泄露面为边界。
- 分布式 rate limiting 需要先确定 key、预算、失败策略和 Workers/Node 宿主对等方案;不要用 isolate 内 Map 冒充全局限流。
