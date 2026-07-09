# 反思:Dashboard 功能性前端重构

## Task

- 在保留 graphite + signal amber「工业控制台」识别的前提下,把 Dashboard 从桌面优先界面重构为桌面/移动端都可用的响应式管理台。
- 功能性与视觉同轮收口:保护协议驱动的通用 NodePage,修复敏感历史、会话缓存、cursor 分页、设备页错误承诺、Context 乐观锁、危险操作与一次性凭据交互。
- 用真实本地网关数据和 Playwright 验证请求形状、移动布局、键盘焦点、分页与浏览器存储;不触碰生产数据。
- 拆分路由与 RJSF/AJV,让登录首屏不再下载全部管理页和表单引擎。

## Expected vs Actual

- 预期:主要工作是响应式壳、登录页、Overview 和管理页的视觉重排。
- 实际:「功能性很好」首先要求把 UI 当作协议消费者和敏感数据处理者审计。开工前的双向审计发现,最严重问题不是外观,而是完整调用参数落 `localStorage`、管理列表静默停在前 50 条、设备页承诺后端不支持的递归清理、关闭的命令面板仍取全树、同名档案换 SK 后可能看到旧权限缓存。
- 首轮修补也不等于安全边界已经闭合。最终只读审查又发现参数仍能经全局 replay Map 和 React Query MutationCache 留存、Context 可能以「旧正文 + 新 version」绕过乐观锁、lazy chunk 失败会白屏、矮屏登录页无法滚动。交叉审查因此不是形式动作,而是本轮最后一批关键修复的来源。

## What Went Wrong

1. **最初把「不落 localStorage」误当成完整脱敏。** 即使 history v2 不再序列化 `args`,`useMutation` 的 variables/data 和模块级「上次参数」仍可能持有 SecretStore value、Context 正文、token 或任意工具的敏感参数。黑名单也不足以覆盖未知 Plugin/MCP 工具。
2. **界面文案先于后端语义。** DevicesPage 把普通 `system/registry delete` 描述成「含 shell/fs 子节点的清理」,但 NodeRegistry 只允许删除叶节点;默认设备根通常有后代,按钮多数时候必然 conflict。CLI 也不存在注释所称的 `tb device rm`。
3. **把 `Page.items` 当成完整集合。** SK、Secret、Plugin、Registry 和由 Registry 派生的 Devices 都忽略 `cursor`,因此超过默认 50 条后,列表、计数、筛选和 Plugin 选择都会悄悄漏数据。
4. **响应式只看 class 不够。** 固定 256px 侧栏在 390px 视口把工作区压成窄条;矮屏又因文档级 `overflow:hidden` 裁掉登录表单。抽屉能关闭也不代表键盘流程完整,手动受控 Dialog 还需显式恢复焦点。
5. **代码分包只处理成功路径。** `React.lazy` 降低了首屏体积,但旧标签页跨版本部署或网络失败时,动态 import reject 不会被 Suspense 捕获,没有 Error Boundary 就会整页白屏。
6. **乐观锁没有原子基线。** Context 编辑表单只在首次 Get 时复制正文,提交却读取可能已被后台 refetch 更新的 `version`;这样会形成「旧正文 + 新 version」并覆盖别人刚写入的内容。
7. **异步确认契约只改组件不够。** `ConfirmAction` 开始 `await` 后,若调用方仍返回 `mutate()` 的 `void`,弹窗依旧立即关闭并解除 pending;必须逐个调用点改为返回 `mutateAsync()`。

## Root Cause

- 安全审计按「持久化介质」分层,却没有按「敏感数据从输入到销毁的完整生命周期」分层。浏览器内存、Query/Mutation cache、可重放 UI、错误对象和持久层都属于暴露面。
- 专用页面从已有文案和局部调用推断能力,没有回到 core store/builtin schema/CLI 命令矩阵核实真实语义。UI 越友好,错误承诺反而越像真实能力。
- 分页是类型上的可选字段,首屏数据又足以让页面看似正常,因此普通 smoke 看不出静默截断;必须让测试数据跨过服务端默认页大小。
- CSS 静态审查不能证明滚动、触控、焦点恢复、请求懒加载或本地存储安全。只有真实浏览器能同时观察 DOM、网络、localStorage 和交互状态。
- 性能优化只看 bundle 产物时容易漏掉运行时容错;并发一致性只看「提交时带 version」时容易漏掉 version 与正文是否来自同一快照。

## What Worked

1. **先做两份独立审计再分工。** 视觉/交互审计与功能/契约审计互相补全:前者抓到移动端、键盘和远端请求问题,后者抓到历史、分页、设备语义与字段漂移。最终 reviewer 再从数据生命周期和竞态角度复查,有效阻止了「修了一半」的安全结论。
2. **持久历史改为 metadata allowlist。** v2 只保留 `path/tool/ok/code/ms/at`,读取、迁移和写入都显式挑字段;旧 v1 记录和未知 `args`/extra 无法穿透。档案用稳定 id + BaseURL 隔离历史,query key 再加 session revision;切换/替换/删除档案时清 Query/Mutation cache。
3. **把内存缓存纳入敏感面。** 移除全局参数重放及 CmdPanel 的「上次参数」;`useInvoke` 在 observer 脱离后只保留 1 秒,敏感 SK/Plugin Token/Secret 成功流程显式 reset。Secret 请求 pending 时禁止 Escape/遮罩/X 关闭,避免「界面像取消,写入仍继续」。
4. **共用 cursor 适配而不是逐页补丁。** `usePagedBuiltin` 统一把服务端 cursor 放进 `opts`,合并各页 items,页面用 `PaginationFooter` 明示已加载数量和继续加载。真实创建 55 条 Secret 后验证首屏 50、继续加载 55,证明不是只改了类型。
5. **删除假能力。** DevicesPage 不再提供会失败的递归清理按钮,明确普通 Registry delete 只删叶子;这是比在前端拼多次 delete 更符合后端所有权边界的处理。
6. **浏览器验收同时验证功能与性能。** 390px 下管理页无页面级横向溢出;移动抽屉 Escape 后焦点回菜单按钮;调用 Secret 后 localStorage 没有 value;首页初始请求只有根 `~tree?depth=1`、health/status,打开命令面板后才请求 `depth=8`。
7. **分包与失败恢复一起交付。** 全部路由 `React.lazy`,RJSF/AJV 再拆为 `SchemaFormRenderer` 动态 chunk;入口约 299 kB、NodePage 约 203 kB、表单引擎约 403 kB,构建无 >500 kB 警告。`AppErrorBoundary` 为 chunk/runtime failure 提供刷新恢复路径。
8. **验证不是只看 Dashboard build。** `pnpm verify` 最终 1005 passed、7 skipped、退出码 0;Dashboard build/typecheck/Biome/diff check 通过。真实浏览器另补静态测试覆盖不到的布局、网络、分页、存储和焦点证据。

## Missing Docs or Signals

- `must/current-state.md` 仍把 Dashboard 记为「bundle 1.14MB 未 code-split」,与本轮实现相反;Dashboard 代码现状、验证日期和测试数也应同步。
- `architecture/code-map.md` 还缺本轮形成的关键边界:响应式 AppShell、route lazy、RJSF lazy renderer、history v2/profile revision、cursor 共用 hook与 Error Boundary。
- `guides/verification-and-commit-practices.md` 的证据矩阵适用于后端和部署,但没有 Dashboard 专项的「真实浏览器四面检查」:视口/滚动与焦点、请求形状、浏览器存储、跨默认页大小数据。
- Dashboard 仍没有稳定的产品级浏览器回归脚本。本轮 Playwright 是高价值手工验收,但截图和临时 QA 数据不能替代可重跑测试;后续应把安全历史、首屏 depth、移动抽屉焦点、cursor 第 2 页至少四条固化。

## Stable Promotion Candidates

以下是跨任务可复用规则,适合由 recorder 提炼进稳定文档:

1. **前端敏感数据生命周期审计:**调用参数与响应默认视为敏感;持久历史只用 metadata allowlist,禁止依赖字段黑名单。检查 localStorage/IndexedDB 之外,还要检查全局 replay、Query/Mutation cache、表单 state、一次性结果弹窗与关闭时机;旧 schema 迁移应丢弃未知字段。
2. **认证缓存隔离:**缓存 key 不放 SK 明文,使用稳定 profile id + BaseURL + credential revision;换凭据/删档案时同时清 QueryCache、MutationCache 和该档案历史。
3. **列表契约验收:**只要响应有 cursor,专用页面不得把首个 `items` 当全集。测试数据必须超过服务端默认 limit,并核对「首屏数量 → 下一页数量 → 筛选/计数/选择器」的派生结果。
4. **UI 能力声明以行为真源为准:**危险按钮和帮助文案必须回查 builtin dispatch/store 与 CLI 能力;后端不支持原子动作时,宁可移除按钮并解释边界,不要在 UI 中承诺或模拟未经授权的递归语义。
5. **Dashboard 真实浏览器证据矩阵:**至少覆盖 desktop/mobile/矮屏滚动,键盘焦点与 Escape,首屏网络请求和显式触发后的请求,localStorage 敏感字段,以及跨默认页大小的数据。静态 class 审查和 build 不能替代这些证据。
6. **代码分包验收包含失败路径:**除 chunk 大小和首屏是否预加载重依赖外,还要有 lazy import reject 的 Error Boundary/刷新恢复;部署静态资源时尤其要考虑旧标签页引用旧 hash。
7. **乐观并发基线必须原子:**可编辑内容、version 和 `$ref` 状态必须从同一次 Get 捕获;后台 refetch 不得把新 version 配给旧表单正文。没有成功基线时禁止降级成无 `ifVersion` 写入。
8. **异步确认端到端返回 Promise:**确认组件、调用封装与每个调用方必须共同采用 `mutateAsync`/Promise;pending、失败留窗和防重复不能只在组件内部声明。

## Task-Specific Evidence (Keep in Memory)

- 本轮视觉方向、390×844/1440×960 视口、55 条 Secret、具体 chunk 大小和临时本地网关配置都属于验收样本,不应写成协议不变量。
- 「工业控制台 2.0」是当前 Dashboard 的产品表达:保留 graphite、琥珀信号色、Plex Mono 和紧凑密度;它是设计决策,不是所有 tool-bridge 客户端必须复用的样式规范。
- 本轮没有部署生产、没有修改生产数据;浏览器 CRUD 只落临时本地数据目录。`.playwright-cli/` 与 `output/playwright/` 是 QA 产物,不属于项目知识真源。
- 当前手工浏览器验收已覆盖关键风险,但「Dashboard 无产品级自动化测试」仍是后续工程缺口,不能因本轮截图和一次性会话而标记为永久解决。

## Follow-up

- recorder 同步 `must/current-state.md` 与 `architecture/code-map.md`,并在 `llmdoc/index.md` 单列本反思;是否把浏览器证据矩阵推广进 verification guide,应以避免重复现有证据矩阵为前提做小幅增补。
- 后续优先建立最小 Playwright 回归:敏感历史 allowlist、首屏无 `depth=8`、移动抽屉焦点恢复、builtin cursor 第二页。测试数据使用临时本地宿主,禁止依赖生产。
- 新增或重构其他专用管理页时,先做「builtin schema/store ↔ CLI ↔ Dashboard」三向矩阵,再开始视觉迁移;通用 NodePage 始终保留为未知命令的协议兜底。
