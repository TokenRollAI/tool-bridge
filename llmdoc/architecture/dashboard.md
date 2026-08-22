# Dashboard 架构

Dashboard 是纯 HTTP 客户端，不 import core。wire 类型在 `src/lib/types.ts` 手抄，因此任何接口变更都要同轮更新 core、CLI、Dashboard 类型与 fixture。

## 分层

- `lib/api.ts`：HTTP、TBError、表示协商。
- `lib/queries.ts`：TanStack Query key、分页、mutation 与失效。
- `lib/session*`：profile、认证、连接上下文。
- `canvas/`：工作区骨架与画布。`WorkspaceShell`(顶栏 + 库务栏 + Outlet,取代旧三栏 AppShell)、`CanvasPage`(index 与 `/nodes/*` 同一组件:左画布 + 右 Inspector 抽屉,选中态由 URL 驱动)、`TreeCanvas`(React Flow 渲染)、`NodeInspector`(选中节点后右侧滑出,取代旧整页 NodePage,原样复用 node 子组件)。`treeGraph.ts` / `useCanvasTree.ts` 是无 DOM 的纯逻辑(工作树→图布局、展开集合、按需懒加载合并),沿用 TreeNav 的性能边界(root depth=1、本地 lazy=1、remote lazy=3)。
- `components/node/`：Inspector 内的节点子组件。`CommandWorkspace`(整宽命令目录,点命令开 Dialog)、`CmdPanel`(单条 cmd 调用面板,`accordion` 折叠行 / `dialog` 弹窗两态)、`ResultView`、`CliHint`、反馈与 note。
- `components/add-tool/`：「添加工具」向导。把原本散在三页(集成目录 / 节点注册 / Plugin)的入口收敛成按来源分流;不重复造挂载逻辑,内置集成仍走 `buildIntegrationCalls`、自定义 kind 仍走 `buildRegistryMountCalls`。`mountDiagnostics.ts` 把真实 `system/registry write` 的失败按 TBError code 归类(不另起和真实挂载不一致的 dry-run 探测)。
- `pages/system/`：SK、secret、registry、plugin、catalog、federation、annotation。
- `pages/system/forms/`：将表单状态编译成 wire payload 的纯函数。

表单编译与图布局逻辑优先抽成无 React 依赖的函数(`forms/*.ts`、`canvas/treeGraph.ts`),用 Node Vitest 断言最终 payload、布局结果、互斥项、必填项和 fail-closed 分支;DOM 测试再覆盖交互顺序、焦点和敏感值展示。

## 当前约束

- 内置集成表单只读 `CatalogListItem.exportDetails`；不保留旧 host 聚合字段 fallback。
- 新凭证先写 SecretStore，再写 registry；挂载失败只在确认本轮创建了新槽时回滚，不能误删既有凭证。
- 编辑挂载时留空表示沿用现有 `authRef`，因为 SecretStore 不可回读明文。
- secret/authRef 不进入调用历史、toast、URL 或人类输出；JSON 管理输出也要裁剪敏感字段。
- query cache、history 和状态按 profile identity 隔离：queryKey 以 profile 标识为前缀，缓存失效（`useInvalidate`）也始终限定当前 profile —— 不带参失效整个 profile，带域名参数只失效对应域段，绝不跨 profile 失效。
- 列表超过服务端默认页时必须可继续分页，客户端筛选不能吞 cursor。
- 画布选中态由 URL 驱动(`/nodes/<path>`，BrowserRouter basename `/ui`)：命令面板跳转、deep-link、前进后退都要能定位节点并开对应 Inspector，`/` 不选中(全景)。切换节点时 Inspector 按 `key={path}` 整体 remount，不跨节点残留 tab/表单状态。
- 画布只渲染"已加载 + 已展开"的节点：truncated/remote 子树按需懒加载，offline 设备节点进入布局前剪掉，节点总数超阈值时默认只展根层——换成画布不能丢这三条 TreeNav 既有性能边界。

## 验证

功能收尾至少覆盖：桌面/移动/矮屏滚动，键盘与 Escape，首屏和交互后的请求形状，localStorage 无敏感参数，分页后的计数/筛选，以及当前构建的 `/ui` deep-link/asset 行为。静态 class 审查或单张截图不构成交互证据。
