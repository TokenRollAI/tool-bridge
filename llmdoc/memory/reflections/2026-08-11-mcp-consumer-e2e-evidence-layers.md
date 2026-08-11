# 反思:MCP consumer E2E 的证据分层与客户端真实性

## Task

- Round 29 复核 E2E-E：确认 MCP 出口由真实官方客户端消费，admin 到 narrow SK 的重连会精确收窄工具集，stale flat name 不可越权调用，并判断是否需要新增生产脚本。

## What Changed During Verification

- gateway 集成测试没有手写 initialize/list/call JSON-RPC，而是使用官方 `Client + StreamableHTTPClientTransport`；自定义 fetch 仅把 SDK 请求送入 `SELF.fetch`，initialize、`tools/list` 与 `tools/call` 的 POST 都真实穿过 workerd gateway。SDK 初始化后的可选 SSE GET 因 harness 不能挂长请求而返回 405，不影响本轮无状态 POST 契约。
- 权限重连用两个独立 Client/transport：admin 对本轮两个 path 得到精确集合，narrow 只剩 allowed path 且 flat name 稳定。窄连接调用缓存下来的 admin-only name 得 `tool not found`，上游计数保持 0；调用 allowed name 成功后上游恰为 1，证明拒绝发生在出站前且正向调用没有被测试替身短路。
- 现有 `scripts/verify-mcp.ts` 已使用同一官方 SDK，无需再造脚本，但严格复核发现原断言只要求 `narrow.size < admin.size` 与 narrow 是 admin 子集：零 scope SK 返回空集合时两个条件都成立，脚本会假绿。最终新增 narrow 非空、按可配置 path/command 找到预期 allowed tool并真实 `tools/call` 的断言；mutation probe 中零 scope SK 由 exit 0 变为 exit 1，正向隔离 Node 仍以 admin 27 项调用 `system/registry:list`、narrow 1 项调用 `system/status:get`、stale admin name 拒绝而全 PASS，并删除临时状态。

## Durable Lesson

1. **MCP E2E 要用真实生态客户端，而不是协议形似的 fetch。** 官方 Client 会执行 initialize、能力协商、schema 校验、错误映射和 transport 生命周期；手写 POST 只能证明某个 JSON body 被接受，无法证明真实 MCP consumer 能连接和解释返回值。测试与生产 smoke 应尽量复用同一 SDK/transport。
2. **“真实客户端”与“真实网络”是两个独立维度。** workerd 测试使用真实 SDK 但通过 `SELF.fetch` 进 isolate，适合精确注入上游并断言调用次数；隔离 Node 脚本使用同一 SDK 经过 loopback TCP，覆盖监听、URL、Authorization header 与 Node 宿主。生产复跑才覆盖公网 TLS、路由、部署版本和生产权限数据，三层不能互相代替。
3. **权限变化应通过新连接验证。** MCP tool discovery 是连接期消费面；admin client 关闭后，用 narrow SK 建立新的 Client/transport并重新 `tools/list`，才能证明消费者看到按当前身份重新投影的工具集。只在同一连接上换 header 或比较内部 helper 输出，不代表真实客户端会刷新可用工具。
4. **收窄断言既要比集合，也要拒绝空集假绿。** `narrow.size < admin.size` 在 `0 < 27` 时成立，“narrow 全属于 admin”对空集也真；两条合在一起仍不能证明 narrow 身份拥有任何预期能力。生产脚本至少要断言非空，并按 `_meta` 的期望 path/command 找到一项允许工具；确定性测试再比较精确 path/name 集合。
5. **负例必须配一个真实正向调用。** stale name 上游 0 可以来自路由坏掉、空 scope 或所有调用都被短路；先让 narrow client 对预期 allowed tool 完成真实 `tools/call`，再调用 admin-only stale name并要求 `tool not found`。workerd 层还能精确断言 allowed 上游 1、stale 上游 0，证明失败来自权限裁剪而非环境故障。
6. **flat name 只是传输标识，权限真源仍是 path + command。** 测试先从 `_meta['io.tool-bridge/path']` 与 command 找到工具，再记录 SDK 返回的 flat name。重连后允许项保持同名，隐藏项即使客户端缓存旧 name 也不可恢复其 path/command 调用权；不能仅按字符串前缀猜权限。
7. **已有生产脚本应补强而不是复制。** `verify-mcp.ts` 已覆盖官方 SDK initialize、admin list/call、narrow reconnect 与 stale 拒绝；在原脚本补上 narrow 非空、可配置 allowed path/command/args 和真实 call，既关闭空集假绿，也继续复用同一凭据、transport 与错误处理。新建一个 E2E-E 脚本只会扩大协议升级后的漂移面。
8. **本地全绿不能关闭生产 DoD。** 隔离 Node 的 27→1 与 workerd 的精确集合证明当前源码和本地宿主；它们没有证明目标 commit 已部署、生产 `/~mcp` 可达、真实 admin/narrow SK scope 正确。部署完成后必须对生产 URL 运行同一脚本并保留输出，E2E-E 才可勾选。

## Promotion Candidates

- MCP 验收指南可固化三层矩阵：workerd 精确集合/上游计数、Node TCP SDK smoke、部署后同脚本生产复跑；每层明确覆盖与不覆盖项。
- 权限投影测试可统一采用“admin 精确集合 → narrow 新连接精确集合 → stale name 上游 0 → allowed name 上游 1”的固定负正组合。

## Evidence Boundary

- 当前 gateway MCP integration 13/13 通过，包含官方 SDK 经真实 workerd POST、admin→narrow 精确集合、stale 拒绝上游 0 与 allowed 调用上游 1。补强后的 `verify-mcp.ts` mutation probe 使零 scope SK 从 exit 0 变为 exit 1；正向隔离 Node 真实 TCP 完成 admin 27 项与 `system/registry:list` 调用、narrow `system/status:get` 单项真实调用及 stale 拒绝，并已清理临时状态。尚未执行部署后的生产 `pnpm verify:mcp`，因此 E2E-E 仍必须保持未勾。
