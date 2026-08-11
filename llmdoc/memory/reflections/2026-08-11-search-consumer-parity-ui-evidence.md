# 反思:全局搜索三入口对等与 UI 证据边界

## Task

- Round 24 为 root 工具搜索补齐 CLI 与 Dashboard 消费面，使 API、`tb search` 和 `/ui/search` 共享同一权限裁剪、分页与工具跳转语义。

## What Changed During Review

- 现有 CommandPalette 与 Explorer 输入看起来已经能“搜索”，但它们只在客户端已加载的 `~tree` 上过滤节点，既不查询工具 name/description/feedback，也没有服务端权限后分页。最终新增独立 SearchPage，并把原控件改称“全局跳转”，避免用相似 UI 冒充协议能力。
- UI integration 最初只在 `dist` 不存在时 build。审查时源码新于构建产物，测试仍可能抓旧 chunk 假绿；最终 Gateway Vitest 每次从当前 Dashboard source 无条件 build 后再启动 workerd。
- 搜索结果最初只编码 tool query，TreePath 直接拼进 pathname。合法 path 含 `?`/`#`/`%` 时会被浏览器截断或错误解码；补上逐 segment 的 `encodeTreePath()` 后，又必须在 Router 解码出的 raw path 发 API 前再次编码，否则第二次裸拼接仍会把特殊字符解释成 URL 语法。

## Durable Lesson

1. **三入口对等必须落到同一 wire contract。** CLI 必须直接 `POST /~search` 并发送 `{query,opts}`，不能套数据面 `{tool,arguments}` 信封；`--json` 原样保留完整 `Page<{path,tool}>` 与 cursor，人类输出也要显示下一页 cursor，使用户能用 `--cursor` 续页。Dashboard 同样直连 root endpoint，以服务端 cursor 驱动 infinite query，不能在客户端重算排序或权限。
2. **客户端树筛选不是全局搜索面。** 本地 filter/palette 只适合导航已知节点；全局搜索必须覆盖未加载工具、索引字段、feedback、virtualize、`read + call` 裁剪和 opaque cursor。产品命名、图标、ARIA label 与导航入口也应区分“工具搜索”和“全局跳转”，否则功能存在但用户无法判断语义边界。
3. **URL 编码有两个独立边界。** 导航时把 raw TreePath 逐 segment `encodeURIComponent` 后保留 `/` 层级，tool name 作为独立 query 参数编码；React Router 会把参数解码回 raw path，随后 HTBP 请求构造必须再次逐 segment 编码。只修 Link 或只修 API 都不够，编码整条 path 又会错误吞掉层级 slash。
4. **静态资源测试必须证明产物来自当前源码。** 检查 SPA deep link、lazy chunk 文本和 `/~search` 路由次序之前，必须无条件 fresh build 或用内容哈希证明 source/dist 对应。`dist`“存在”不是 freshness 证据，fresh CI 偶然正确也不能替代本地可重跑性。
5. **UI integration 与真实浏览器证明不同层。** workerd 测试能证明 `/ui/search` fallback、当前构建产物包含 SearchPage/API 接线、root POST 未被 assets 吞；它不能运行 React 状态、Router decode、TanStack cursor 或响应式布局。真实浏览器需补特殊字符 TreePath 的 Link → Router → API 往返、50→下一页累计且请求携 opaque cursor、结果直达工具预选，以及 390px/矮屏无横向溢出、console 无错误。
6. **特殊字符测试不能停在 helper 断言。** `encodeTreePath('a?b/c#d/e%f')` 的静态结果只证明编码函数；只有浏览器点击后检查 pathname、发出的 HTBP URL 和最终 NodePage 200，才能覆盖 Router 自动解码与 API 二次编码。普通 ASCII path 的成功证据不能外推到该分支。
7. **Page/cursor 需要端到端保真测试。** CLI 应精确断言 root URL、method、body、JSON Page 和人类 cursor；Dashboard 要核对 query key 隔离 query/profile/mode/limit、cursor 只从 `pageParam` 进入下一次请求、pages 累积无重复跳页。空态、401/403、404 未启用与 200 无可见结果必须分开，不能把权限裁剪后的空页解释成全局无 raw 命中。

## Promotion Candidates

- Dashboard 架构文档可记录 raw TreePath 在“导航 URL”和“HTBP 请求 URL”两个边界都必须逐 segment 编码。
- 验收指南可把 UI 证据拆为 fresh-source build、workerd 静态/路由集成和真实浏览器三层，并把特殊字符路径、分页网络体与移动端列为固定矩阵。

## Evidence Boundary

- 当前 CLI tests、无条件 Dashboard build、Gateway UI integration，以及桌面/390px、50→57、opaque cursor、工具预选的浏览器证据已覆盖主要流程。追加真实浏览器 fixture `providers/a?b/c#d/e%f` + `calendar?open#special%tool` 后，已验证搜索结果 URL、Router decode、节点 `~help` 二次编码与工具预选完整往返，最终 NodePage 非 `not_found`。仍未把这条真实浏览器流程固化为产品级自动化测试。
