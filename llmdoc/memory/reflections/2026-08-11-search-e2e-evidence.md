# 反思:Search E2E 的精确查询、全分页权限与证据分层

## Task

- Round 30 补强 E2E-C 本地证据：让 `日程` 与 `create document` 两个验收 query 在 D1/SQLite、真实 root wire 和 CLI consumer 上可重跑，并证明窄 scope 对全部分页结果做权限裁剪。

## What Changed During Review

- 原有测试虽然覆盖了中文搜索、英文搜索和两宿主 adapter，却没有在各层执行 DoD 的精确 query：Node wire 查 `日历`，英文 `create_document` 只存在于无关 plugin fixture。最终把两个 exact query 放入 shared SearchIndex contract、D1 `SELF.fetch` 与重启后的 Node TCP/SQLite wire。
- `verify-search` 初版只取 `--limit 200` 首屏。构造“窄身份第一页全合法、第二页出现 hidden leak”的假网关后，脚本仍 exit 0；最终改为每页执行真实 CLI `--cursor`，拉完再校验，并对重复 item/cursor 与超过 20 页 fail closed。同一后页越权 probe 随后变为非零退出。
- Node 窄 scope 初版只断言 visible 命中，若 hidden fixture 根本没同步入 SQLite 也会通过。最终先以 admin 对同一 query 精确看到 visible + hidden，再签只允许 visible path 的 `read + call` SK，断言 narrow 只剩 visible。
- 本地 consumer 对拍最终补上真实浏览器：隔离 Node 中 admin/API/CLI 对两个 query 都能看到 visible + hidden，切换窄 SK 后，当前 Dashboard 分别搜索 `日程` 与 `create document`，两次 DOM 都只显示 `search/e2ec/visible:lookup_calendar`，Playwright 最终 console 为 0 error。

## Durable Lesson

1. **验收 query 必须逐字进入每个声称覆盖它的层。** `日历` 通过不能证明 `日程`，仓库出现 `create_document` 字符串也不能证明 `create document` 经 registry、索引和 root API 可搜。shared fixture、宿主 wire 与 consumer script 都应使用 DoD 的 exact query，结果按 `{path,tool.name}` 对拍。
2. **多 term query 的 fixture 必须符合真实语法。** `create document` 是 AND 查询，两个 term 要落在同一个 ToolSpec 的可搜索字段中；把 `create` 与 `document` 分散到不同工具会正确返回空。fixture 应为每个 exact query 使用可辨识工具，避免一个万能文档同时命中一切而掩盖 query 选错。
3. **首屏权限正确不能外推全分页正确。** 权限泄漏可能只出现在 continuation；一次 `--limit 200` 返回无越权项并不证明后续页。consumer verifier 必须沿 opaque cursor 拉到末页后再检查非空、prefix、admin subset 与 strict shrink，并拒绝重复 cursor、重复 item和无界页链。
4. **分页上限应 fail closed，并明确它是 verifier 预算。** 20 页不是协议上限，而是验收脚本的运行预算；达到上限仍有 cursor 时必须失败，宁可对超大环境假红，也不能把未检查的尾页当作权限安全。预期 fixture 应控制在预算内，生产数据超出时显式调整并重新审计成本。
5. **窄 scope 正例必须有 hidden admin control。** narrow 返回一个 allowed item 只能证明该项可见，不能证明隐藏候选存在或被裁剪。先用 admin 对相同 query/索引证明 visible + hidden 都命中，再让 narrow 精确只剩 visible；同时要求 narrow 非空、admin 有 prefix 外结果且结果严格缩小，堵住零权限与缺 fixture 假绿。
6. **权限前缀比较必须遵守 TreePath 段边界。** 允许 `path === prefix` 或 `path.startsWith(prefix + '/')`，不能用裸 `startsWith(prefix)`，否则 prefix `allowed` 会错误接纳 `allowedness/tools`。前缀混淆应作为固定 mutation probe。
7. **两宿主对等需要 shared contract 与各自 wire 双证据。** 共享 fixture在 D1/SQLite adapter 上执行两个 exact query，证明排序/term 语义一致；D1 `SELF.fetch` 与 Node 真实 TCP + restart 再证明 binding/SQLite、registry sync、gateway route 和持久化接线。只测 shared adapter或只测单宿主 HTTP 都不足以声称宿主对等。
8. **真实 CLI 与真实浏览器是不同 consumer 层。** `verify-search` 每页启动构建后的 CLI，覆盖 parser、`--cursor`、HTTP 和 JSON Page；它不运行 React、TanStack pagination、身份切换或 DOM。Dashboard 还必须在真实浏览器执行 exact query，把 DOM `{path,tool}` 与同身份 API/CLI 对拍，并验证窄身份没有 hidden path、console 无错误。fresh build、chunk 文本和 route 200 仍只是接线证据；本轮隔离 Node 浏览器对拍正是独立补齐这一层。
9. **本地 consumer 证据不能替代生产数据面。** Miniflare D1、Node SQLite、CLI 与本地浏览器证明当前源码；真实 D1 provision、部署版本、生产索引内容和生产 Dashboard 仍需授权后用同一 query/身份复跑。没有生产结果时 E2E-C 必须保持未勾。

## Promotion Candidates

- Search 验收指南可固化五层矩阵：shared adapter、D1/Node wire、真实 CLI 全分页、真实浏览器 DOM/网络、部署后生产复跑；每层记录 exact query、身份和结果集合。
- 权限搜索 fixture 可统一采用“admin visible + hidden control → narrow non-empty exact visible → 全 cursor 聚合 → prefix/subset/strict-shrink”模板，并保留后页泄漏与前缀混淆 mutation probes。

## Evidence Boundary

- 当前 core 8、D1 Worker 10、Node 8、CLI 3 个定向测试均通过；shared adapter、D1 `POST /~search` 与重启后 Node TCP/SQLite 已执行 `日程`、`create document`，Node wire包含 admin hidden control与真实窄 SK。`verify-search` 的后页越权 probe由初版 exit 0 变为非零，合法两页及主线 Node 203/2p→201/2p 证据通过。隔离 Node + 当前 Dashboard 的真实 Playwright 对拍也已闭环：admin/API/CLI 两个 query 均为 visible + hidden，窄 SK 下两次 DOM 均仅有 `search/e2ec/visible:lookup_calendar`，最终 console 0 error。仍未执行真实 D1 provision/deploy、生产中英文 smoke与线上 Dashboard 验收，因此 E2E-C 继续保持未勾。
