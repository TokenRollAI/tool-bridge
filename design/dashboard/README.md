# dashboard · Tool Bridge Web 工作台设计源

`web-dashboard.pen` 以别名 `t` 导入 [`../foundation/tool-bridge.lib.pen`](../foundation/README.md)，覆盖 `packages/dashboard` 桌面端（1440px）与手机浏览器窄屏（390px）全流程。

## 画板清单（10 Boards）

| 画板 ID | 名称 | 尺寸 | 主题 | 对应代码入口与关键状态 |
| :--- | :--- | :--- | :--- | :--- |
| `z7WMne` | `01 · Login & Gateway Profile` | `1440×900` | Dark | `LoginPage`：左侧已保存本地连接档案快速进入 + 右侧新网关地址与遮蔽访问密钥验证 |
| `tR1Nc` | `02 · Workspace & Command Hub Dark` | `1440×900` | Dark | `WorkspaceShell` + `WorkspacePage`：220px Stage 侧栏、52px 顶栏（次级添加工具 + `⌘K`）、去边框常用工具、高密度调用历史与设备状态 |
| `J25OlC` | `03 · Workspace Light Mode & Command Palette ⌘K` | `1440×900` | Light | 浅色模式同源对照 + `CommandPalette` 悬浮检索面板与深琥珀键盘焦点环 |
| `n3lmy` | `04 · Tool Invoke & Delivery Policy` | `1440×900` | Dark | `ToolPage` + `CmdPanel`：参数表单、`realtime / mailbox / fallback` 投递策略、行内字段校验错误、右侧 `202 Accepted` 入队回执与等价 CLI |
| `zxJsz` | `05 · Process Session Live Terminal` | `1440×900` | Dark | `DeviceSessionPanel`：实时日志流、字节游标续读提示，以及「停止观察」与「终止远程进程」职责分离 |
| `dSDYp` | `06 · Capability Tree Canvas & Node Inspector` | `1440×900` | Dark | `CanvasPage` + `TreeCanvas` + `NodeInspector`：去除重复添加按钮与节点彩虹色条，保留琥珀金选区锚点与右侧 420px Stage 检查器抽屉 |
| `SizK0` | `07 · Devices & Durable Mailbox Ledger` | `1440×900` | Dark | `DevicesPage` + `DeviceMailboxPanel`：单行摘要替代 4 张统计大卡；离线任务账本明确区分 `queued`、`claimed`、`result_unknown` 与 `expired` 不可盲重试提示 |
| `T1Qjgp` | `08 · Managed Config & Scoped SK Admin` | `1440×900` | Dark | `ConfigPage` + `SkPage`：`desired rev` 与 `applied rev` 差异对照、显式应用入口，以及右侧按路径授权的访问密钥详情与吊销操作 |
| `nV3O4` | `09A · Web 390 · Workspace Navigation Drawer` | `390×900` | Dark | 手机浏览器窄屏下的 `WorkspaceShell` 侧滑导航抽屉与 >=48px 触控行高 |
| `RZNaD` | `09B · Web 390 · Single Column Tool Invoke` | `390×900` | Dark | 手机浏览器窄屏单列工具调用表单与紧邻提交位置的响应回执 |
