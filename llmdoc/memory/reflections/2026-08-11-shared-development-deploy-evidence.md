# 反思:共享开发环境部署例外与在线证据分账

## Task

- Round 32 在用户明确“当前无 production、项目仍处开发期”并授权立即覆盖既有共享开发实例后，从功能分支完成真实 Cloudflare provision/deploy，以及 MCP、Search、Device/hibernation、Feishu 与 Dashboard 在线验收。

## What Changed During Deployment

- 部署前只读审计发现目标并非空环境：公开 custom domain、gateway/plugin Workers、同名 KV/R2、remote secrets与旧部署都已存在。用户随后明确这些是可覆盖的共享开发资源，并授权 feature branch 直接部署；因此本轮是对既定 clean-main 纪律的有范围例外，不是 production release，也不是以后默认可跳过 PR/merge。
- 首次创建真实 APAC D1 `tb-search` 并回填 binding 后，将该配置单独提交，使部署工作树干净；连续第二次 provision 对 KV/R2/D1 全部 exact skip。真实 D1 schema继续由请求期 SearchIndex 幂等初始化，不把“数据库存在”误写成“搜索链已验收”。
- Search fixture写入后，跨请求 canonical KV 与索引审计约 35–60 秒才收敛。最终使用有界等待后再跑全 cursor verifier，而不是把立即为空误判为 D1 失败，或用无限重试隐藏永久故障。

## Durable Lesson

1. **环境名称不等于实际 blast radius。** 用户说“没有 production”解决的是生命周期口径，不会让公开域名、真实 Workers、共享 KV/R2/D1和 secrets 变成无风险沙箱。部署前仍须列出现有 deployments、routes、storage 与 secrets，明确会覆盖什么、复用什么、哪些旧状态可能继续被新代码读取。
2. **纪律例外必须绑定目标、版本与授权。** 默认顺序仍是 push → PR → merge → clean main → deploy。本轮例外只因用户明确授权当前 feature branch 覆盖指定共享开发实例；记录 branch/commit、目标账户/Worker、资源复用与“非 production release”措辞，避免一次授权被泛化为长期绕过 review 的许可。PR 合入要求仍独立存在。
3. **配置回填应先固化，再部署依赖它的代码。** provision 创建 D1 后会改 tracked `wrangler.jsonc`；应把真实 binding id 单独提交并重新确认工作树干净，再运行 deploy。否则线上版本可能依赖一个只存在于未提交工作树的 UUID，PR、回滚和后续 clean checkout均无法复现。
4. **幂等 provision 要验证第二次真实运行。** “代码里先 list 再 create”不是云端幂等证据；同一账户连续第二次运行必须对 KV、R2、D1 使用精确名称匹配并 skip，且保持 binding不漂移。数据库创建成功也只证明资源层，仍需真实 Worker request触发 schema并完成 query。
5. **KV 最终一致要用有界收敛窗口建模。** registry/SK mutation成功后，下一跨请求 isolate可能暂时读到旧 canonical snapshot，SearchIndex 审计也可能先保留 LKG。本轮 35–60 秒是一次实测样本，不是 SLA；验收应轮询可辨识 control fixture到明确 deadline，跳过暂时 null/旧值，超时则失败并保留诊断，不能 sleep 一个过短常数或永久重试。
6. **在线能力要分别证明正向、收窄与 stale 拒绝。** MCP 使用官方 SDK：admin→narrow 工具集 29→2，narrow 真实调用 `system/status:get`，缓存的 admin-only flat name被拒；Search 对两个 exact query 均 admin 2→narrow 1并拉完 cursor，线上 Dashboard只渲染 allowed path。只看 endpoint 200或非空列表都不足以证明权限投影。
7. **DO/设备在线证据不能由本地 barrier 代领。** 标准 `verify-device` 证明真实 shell/fs、同 ID replacement与 registerPaths allow/deny；另以 opt-in 155 秒空闲后调用证明部署环境的 hibernation/恢复路径。两次都要核对临时设备节点与 restricted SK清理，不能只凭脚本 exit 0假设 teardown无残留。
8. **外部业务验收要串起同一对象的状态变化。** Feishu 先独立部署 plugin、把旧 v1 注册迁为 plugin/v2并挂载 `actions`，真实发现 8 个工具；随后对同一文档执行 create → fetch(create marker) → update append → fetch(create+update markers)。这种 marker 对拍比三个互不相关的 200 更能证明写后读与调用路由，同时账本只保留脱敏结果，不保存 doc token、URL或凭据。
9. **平台注入脚本与应用 CSP 冲突时，安全策略优先。** Cloudflare Web Analytics 在响应阶段注入 `static.cloudflareinsights.com` beacon，而应用 CSP固定 `script-src 'self'`，浏览器因此记录拦截。该 console error来源于平台注入，不代表 Search DOM失败；也不应为“console 变绿”直接放宽 CSP。若确需 analytics，应显式决定是否启用，并完整审计 script/connect来源、隐私与攻击面。
10. **在线临时资源必须有逐类清理账。** MCP narrow SK已撤销；Search allowed/hidden registry fixture与窄 SK已删除；Device临时节点与 SK已核对清理。cleanup 是验收的一部分，应在删除后用 list/get确认不存在，并对失败保留 id供人工处理。业务侧 Feishu测试文档不能因未记录 token而被描述成已删除。
11. **本地全绿、共享开发在线通过与正式发布是三本账。** `pnpm verify`、dry-run与本地 E2E证明源码；共享开发部署证明真实 Cloudflare/外部系统；PR合入 main及正式发布纪律证明可发布状态。前两本账全绿不能自动满足外部 HTBP Draft同步、PR merge或 global Done。

## Promotion Candidates

- 部署指南可加入“共享开发 feature-branch 例外”模板：先列真实资源与公开入口，再记录用户授权、目标 commit、覆盖范围、非 production口径、回滚点和后续 PR义务。
- 在线验收指南可固化按能力清理表与 KV有界收敛探针，并增加 Cloudflare response injection/CSP 的诊断分支，避免把平台脚本拦截误判为应用功能错误或反向放宽安全策略。

## Evidence Boundary

- 本轮真实证据包括：D1首次创建与第二次 exact skip、authenticated smoke、MCP 29→2+allowed call+stale拒绝、Search双 query 2→1与线上 Dashboard对拍、Device标准路径与155秒 hibernation、Feishu同文档 create/fetch/update/fetch marker对拍，以及临时 SK/registry/device fixture清理。它们只代表用户授权的共享开发实例与部署版本；当前 feature branch尚未合入 main，外部 HTBP Draft仍未同步，正式 global Done不成立。Cloudflare Analytics beacon被严格 CSP拦截是已知线上 console事实；Feishu测试文档删除没有留证，不能归入已完成清理。
