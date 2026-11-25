# Tool Bridge Design System (`design/`)

Tool Bridge Web Dashboard 与 Mobile App 的统一权威设计源，使用 [pen.dev](https://pen.dev) 编辑与维护。

## 目录结构

| 目录 | 职责 | 关联代码面 |
| :--- | :--- | :--- |
| [`foundation/`](foundation/README.md) | `tool-bridge.lib.pen`：统一 UI Token（Dark / Light）、官方矢量标识与 `TB/*` 共享组件库 | 双端共享契约 |
| `dashboard/` | `web-dashboard.pen`：Web 工作台、工具目录与调用台、能力树画布与抽屉、设备与管理面（含 1440px 桌面与 390px 窄屏响应式） | `packages/dashboard` |
| `mobile/` | `mobile-app.pen`：本机信箱、报告阅读、设备中心、授权安全模式与远程命令确认门禁（390px Dark / Light） | `tool-bridge-mobile` |
| `scripts/` | `check-pen-refs.mjs`：零依赖引用、组件实例与资产完整性检查 | 设计源门禁 |

## 校验命令

```sh
node design/scripts/check-pen-refs.mjs --unused
```
