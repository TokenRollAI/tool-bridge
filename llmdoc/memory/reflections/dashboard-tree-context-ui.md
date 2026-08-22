# Dashboard 能力树与 Context 详情交互 Reflection

## Task

- 把画布从若干并列一级节点收敛成以 `/` 为唯一总根的能力树，并在节点卡片上提供展开、详情、挂载与卸载快捷操作。
- 改善 Inspector 内 Context 文件浏览：列表保持可扫描，条目正文统一在宽 Dialog 中查看，并能跳转到所属工具详情。
- 补充工具用途、子节点数与当前浏览器调用历史，让用户无需理解底层协议也能快速判断“这是什么、能做什么、最近是否调用过”。

## Expected vs Actual

- 预期 `GET /~tree` 的返回值天然是一棵以空路径为根的 `TreeJson`，画布应保留这个单根语义。旧 `useCanvasTree` 却把 `root.data?.children` 直接当成 `roots` 传给 `buildGraph`，根对象的身份与语义被前端丢弃；`buildGraph` 再逐个渲染这些 children，于是视觉上出现多个互不相连的“根”。
- 预期 truncated 节点的同一个控件可展开也可折叠。旧 `TreeCanvas` 点击时先 `toggle(data.path)`，随后只要 `data.truncated` 就无条件 `expand(data.path)`；折叠动作会在同一批状态更新里被第二次更新重新加回，因而 truncated 节点无法真正折叠。
- 预期 Context 条目详情在右侧 Inspector 的实际可用宽度内舒展显示。旧实现用 `window.matchMedia('(min-width: 1024px)')` 决定双栏；当整个浏览器够宽但 Inspector 只有约 30–38rem 时，`minmax(360px)` 与 `minmax(420px)` 仍会挤进这个窄容器，正文被压缩成狭长的一行式体验。
- 预期多 agent 可以并行实现，但同一 worktree 的最终闸门是单一、可归因的证据。本轮并行执行 pnpm 校验时出现了共享 `node_modules` 软链接竞争；这类失败来自多个进程同时触碰包管理器的共享安装状态，不能直接归因于代码。

## Root Cause

### 根节点被当成响应包装层

`~tree` 返回的根不是分页 envelope，而是领域模型的一部分。旧数据适配为了让图构建函数消费数组，直接剥掉了根节点，却没有在图模型里恢复“唯一父节点”这个不变量。API 数据形状与 React Flow 节点 ID 也被混为一谈：空路径 `''` 适合作为路由/领域路径，但图层应使用独立且非空的内部 ID。

本轮采用 `ROOT_NODE_ID = '__tb_root__'` 作为 React Flow 身份，同时在节点数据中继续保留 `path: ''`、展示 `/`，从而分开“图技术标识”与“HTBP 路径”。`treeGraph` 测试钉住了唯一总根、总根折叠无悬边，以及总根到全部一级节点的连接关系。

### 一次点击表达了两个相互冲突的状态变更

truncated 懒加载同时涉及“用户是否展开”与“是否记录过懒加载入口”。旧实现用 `toggle + expand` 试图兼顾两者，结果让折叠意图被覆盖。本轮把动作收敛为一次 `toggle`；只有从折叠进入展开且节点 truncated 时，才把路径和 remote scope 写入 `lazyPaths`。查询订阅再由最终 `expanded` 状态过滤，折叠父节点时同步清理后代展开态。

这说明可逆 UI 动作不应在同一事件中混用 toggle 和 force-open。异步加载是展开的副作用/派生状态，不应反向改写用户的展开意图。

### 响应式判断观察错了边界

`ContextBrowser` 不是直接占满 viewport，而是嵌在 `NodeInspector` 内。窗口断点只能说明浏览器宽，不能说明组件宽；因此 `lg` 双栏在 Inspector 中是错误的布局信号。本轮删除常驻预览栏，所有屏幕统一用 Dialog 展示条目，正文区域独立滚动，列表筛选、翻页状态继续留在底层组件中。Dialog 同时提供所属工具的链接入口，避免条目详情成为信息孤岛。

若未来确实需要恢复常驻双栏，应使用容器查询或由 Inspector 显式传入布局能力，而不是读取全局 viewport。

## Interaction Architecture Lessons

- `CanvasNode` 应保持展示与动作上报职责，`TreeCanvas` 负责编排展开/懒加载/选择，`CanvasPage` 负责挂载与卸载等管理 mutation。这样卡片无需直接依赖路由、query 或 registry API。
- 节点快捷操作要由能力约束驱动，而不是“所有节点都给按钮、失败后再提示”。本轮在图数据层集中派生 `canMountChild`、`canUnmountSelf`，系统 builtin 与虚拟总根不会暴露无效/危险动作。
- 整张卡片用于“查看详情”，内部按钮必须阻止冒泡并具有独立的可访问名称；展开状态还要暴露 `aria-expanded`。快捷操作不能让点击命中区域互相竞争。
- 画布卡片只展示高密度摘要：短名、用途、kind、子节点数与状态；完整命令、反馈、说明和调用历史留在 Inspector。调用次数必须明确是“当前浏览器、当前 profile、有限历史”，不能伪装成服务端全局审计数据。
- 详情 Dialog 是跨嵌套容器更稳定的阅读面：固定 header/footer、正文区独立滚动、长路径/markdown/pre 均允许换行或横向滚动，并提供回到所属工具的明确链接。

## Verification Lessons

- 纯图逻辑应首先用 Node Vitest 固定结构不变量：唯一总根、逐级展开、折叠后无悬边、remote scope 传播与布局方向；DOM 测试再覆盖快捷按钮的事件分流和可访问属性。
- Context 交互测试应覆盖“所有屏幕统一开 Dialog”、正文换行/滚动容器、所属工具链接的 URL 编码与新窗口属性、Escape 恢复列表状态，以及 `$ref` 条目不显示无效复制按钮。
- 多 agent 可并行做定向调查和实现，但同一 worktree 内不要并发启动 `pnpm verify`、全仓 build 或可能修复/重建 workspace 链接的 pnpm 命令。指定一个验证 owner，按“定向测试 → `pnpm verify` → 必需的 `pnpm turbo run build`”串行执行；遇到软链接/模块瞬时缺失时先确认是否有并发 pnpm 进程，再在安静工作区串行复跑，不能用并发噪声掩盖真实失败，也不能把一次复跑通过当作无需解释。

## 用户反馈后的二次教训

- `~tree` 的 `TreeJson` 只描述实体节点、children 与截断状态，不包含 `cmds`；命令的真源是节点级 `~help`。因此画布上的命令叶子与 overflow 必须是按需取得 `~help.cmds` 后构造的虚拟子树，不能从真实 children、节点 kind 或命令路径命名规则猜测。
- 用户明确纠正了最初方案：额外的 `commandGroup`/“命令目录”画布节点只是无意义的二次点击中转。owner 自己已经提供命令开关；一次点击后应直接显示由该 owner 连接的虚拟命令叶，不能再要求用户展开一个只含同一批命令的中间层。这里的产品层级是“实体 owner → 命令叶”，不是为了代码分组而把内部状态暴露成 UI。
- 命令可见性只需维护独立于真实树 `expanded` 的 owner 开关。它不能复用真实树展开状态，否则打开命令会改变真实 `childCount`、祖先折叠或懒加载订阅。当前实现只订阅“用户明确打开且当前仍可见”的 owner；owner 被真实树折叠隐藏时，不留下虚拟节点或悬边，重新关闭 owner 也会直接移除整组虚拟叶。
- 命令叶不能无限铺进图。每个 owner 应设置稳定的可见叶上限，超出部分汇总成 `commandOverflow`，点击后进入 Inspector 的可筛选完整目录；这既保护布局性能，也避免高命令数工具淹没真实能力树。
- 生成深链不等于交付深链。此前画布能导航到 `?tool=<command>`，但 `NodeInspector` 没有消费该参数，结果只打开节点而没有打开目标命令。本轮把参数贯通为 `CanvasPage → NodeInspector.initialTool → CommandWorkspace`，同时切到调用 tab 并打开对应 Dialog。后续所有 URL 状态都应成对验证 producer、consumer、刷新/前进后退与非法值降级。
- MiniMap 的“黑块”不是单一配色问题。旧暗色 token 让背景、mask、节点矩形对比不足；同时 `buildGraph/layoutGraph` 中已有的 `width/height` 在转成 React Flow `rfNodes` 时被丢弃，MiniMap SVG 因缺少几何尺寸画出零宽/退化矩形。当前转换显式透传尺寸，并用与主题背景有稳定对比的角色/kind 颜色；两项缺一不可。
- 这类画布视觉故障优先检查真实浏览器 DOM/SVG，而不是继续从截图猜 CSS。查看 React Flow 节点的测量尺寸，以及 MiniMap `<rect>` 的 `width`、`height`、`fill`、mask 和 computed style，能迅速区分“数据/几何丢失”与“颜色低对比”；截图适合确认整体体验，不适合单独定位 SVG 渲染根因。

## Promotion Candidates

- 提升到 `llmdoc/architecture/dashboard.md`：Dashboard 的树适配层必须保留 HTBP 唯一根语义；图内部 ID 与领域 path 分离，并用纯函数测试固定单根、可见性和边不变量。
- 提升到 `llmdoc/architecture/dashboard.md`：Inspector 内组件按容器宽度设计，禁止仅凭 viewport breakpoint 推导双栏；详情密集型内容优先使用统一 Dialog，确需双栏时采用容器查询或显式布局上下文。
- 提升到 `llmdoc/architecture/dashboard.md`：画布节点遵循“展示组件上报语义动作、画布编排本地树状态、页面持有管理 mutation”的 ownership；权限/可操作性在 view model 层集中派生。
- 提升到 `llmdoc/architecture/dashboard.md`：命令不是 `~tree` 实体节点，而是从按需 `~help` 派生的有界虚拟子树；owner 开关独立于真实树展开状态，命令叶直接连接 owner，不增加 commandGroup 中转层，超限命令进入 Inspector 完整目录。
- 提升到 `llmdoc/architecture/dashboard.md`：URL 驱动状态必须端到端消费；React Flow 数据适配必须保留布局尺寸，MiniMap 同时验证几何与主题对比度。
- 提升到 `llmdoc/guides/verification-and-commit-practices.md`：共享 worktree 的 pnpm 全仓闸门必须由单一验证 owner 串行运行，避免 `node_modules` 链接竞争造成不可归因结果。

## Follow-up

- recorder 应核对上述候选是否足够稳定并分别提升到 Dashboard architecture 与 verification guide；本 reflection 不直接修改稳定文档或 `llmdoc/index.md`。
- 后续视觉验收仍需在真实 Inspector 宽度下覆盖桌面、窄屏与矮屏，并实际操作总根折叠、truncated 二次折叠、命令 owner 一次点击直出叶子/再次点击收起/overflow、`?tool=` 刷新深链、Context Escape/长正文滚动和所属工具跳转；同时检查 MiniMap SVG 的真实矩形尺寸与填充色，静态 class 或截图猜测不能替代这些交互证据。
