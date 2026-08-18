# Dashboard 架构

Dashboard 是纯 HTTP 客户端，不 import core。wire 类型在 `src/lib/types.ts` 手抄，因此任何接口变更都要同轮更新 core、CLI、Dashboard 类型与 fixture。

## 分层

- `lib/api.ts`：HTTP、TBError、表示协商。
- `lib/queries.ts`：TanStack Query key、分页、mutation 与失效。
- `lib/session*`：profile、认证、连接上下文。
- `pages/system/`：SK、secret、registry、plugin、catalog、federation、annotation。
- `pages/system/forms/`：将表单状态编译成 wire payload 的纯函数。

表单编译逻辑优先抽成无 React 依赖的函数，用 Node Vitest 断言最终 payload、互斥项、必填项和 fail-closed 分支；DOM 测试再覆盖交互顺序、焦点和敏感值展示。

## 当前约束

- 内置集成表单只读 `CatalogListItem.exportDetails`；不保留旧 host 聚合字段 fallback。
- 新凭证先写 SecretStore，再写 registry；挂载失败只在确认本轮创建了新槽时回滚，不能误删既有凭证。
- 编辑挂载时留空表示沿用现有 `authRef`，因为 SecretStore 不可回读明文。
- secret/authRef 不进入调用历史、toast、URL 或人类输出；JSON 管理输出也要裁剪敏感字段。
- 切换 profile 时 query cache、history 和状态按 profile identity 隔离。
- 列表超过服务端默认页时必须可继续分页，客户端筛选不能吞 cursor。

## 验证

功能收尾至少覆盖：桌面/移动/矮屏滚动，键盘与 Escape，首屏和交互后的请求形状，localStorage 无敏感参数，分页后的计数/筛选，以及当前构建的 `/ui` deep-link/asset 行为。静态 class 审查或单张截图不构成交互证据。
