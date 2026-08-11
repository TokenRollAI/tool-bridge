# 反思:Dashboard 大页拆分、纯 builder 与测试证据边界

## Task

- Round 25 拆分 Registry、Plugin、SK 三个大型系统页，把表单字段、dialog、展示组件与 route coordinator 分离，并为最终 wire payload 建立 Dashboard 自有测试。

## What Changed During Review

- 仅移动 JSX 无法证明行为等价。把闭包里的 config 构造抽成纯 builder 后，测试立即暴露了三类契约差异：custom auth 空前缀会静默回退 Bearer、HTTP ToolDef 校验弱于 CLI，以及 SK `registerPaths` 用逗号分隔会破坏合法 TreePath。builder 因而既是拆分边界，也是可执行的 CLI/builtin 对等检查点。
- NodePage 原先从整个 `RegistryPage` route module 导入 `MountDialog`，导致普通节点页连带依赖 Registry route chunk。拆分后两个 route 直接引用独立 `forms/MountDialog`，共享组件不再经 route page re-export。
- Gateway UI integration 已无条件从当前 Dashboard source fresh build；若仍只检查已有 `dist`，大规模文件迁移最容易让旧 chunk 继续通过接线断言。

## Durable Lesson

1. **先抽纯 config builder，再拆组件。** builder 的输入是受控 form state，输出是最终 `system/registry`、`system/plugin` 或 `system/sk` wire object；组件只负责状态、I/O、toast 与生命周期。这样重排 JSX、拆 dialog 或替换控件时，契约测试不依赖 DOM 结构，且能在移动代码前后比较真实 payload。
2. **“与 CLI/builtin 对等”必须可执行。** 不应只在评审中人工对照字段名；用共同 fixture 断言 MCP/HTTP 认证组合、HttpToolDef、context/skillhub/plugin export、virtualize、plugin/v2 manifest、SK scope/registerPaths/expiry 的精确对象和 fail-closed 分支。builder 负责确定的本地组合校验，HTTPS、SecretRef 权限、远端 contract 与 provider probe 仍由 gateway 权威判定，避免复制安全真源。
3. **拆页要消除 route-component 耦合，而非只降低行数。** route module 应保留分页、查询、mutation 与页面编排；可复用 dialog/field/presentation 从独立模块导入。共享组件若通过 route page re-export，静态依赖仍会把无关 lazy chunk 拉进调用方，文件数变多但加载边界没有改善。
4. **UI 分隔符必须服从领域语法。** TreePath 允许逗号，所以 `registerPaths` 不能用逗号切分；改为每行一条才能无转义地表达 `device/a,b/**`。任何 tags、scope、header 或 path 列表在选择分隔符前都应先查领域 grammar；若所有单字符都可能合法，应使用结构化控件或显式 escaping，而不是靠 placeholder 约定。
5. **测试脚本存在不等于进入验收链。** Dashboard 需要本包 `vitest` devDependency、`test` script、明确 Node environment，并加入根 `test:unit` filter；否则专门运行能绿，`pnpm verify` 却会静默漏测。依赖只用于开发，避免为纯函数测试引入生产 runtime 或 jsdom。
6. **Node Vitest 只证明纯 builder，不冒充组件交互。** 当前 Node 环境可以覆盖 trim/default、省略规则、组合拒绝和 wire shape；它不能证明 dialog open/close/reset、pending 锁定、切换 kind 后草稿保留、Plugin 分页、一次性 token/secret 不可误关、焦点与响应式布局。后者仍需组件测试或真实浏览器证据。
7. **Gateway UI integration 必须绑定当前 source。** 无条件 Dashboard build 后，workerd deep-link/chunk 测试才能证明这次拆分的 lazy assets 可加载且 Worker 路由未被吞；chunk 字符串断言仍只证明打包接线，不能替代 builder 或浏览器交互测试。
8. **审查应围绕边界负例，而非文件数量。** custom auth 空值、缺字段 ToolDef、半填 scope、含逗号 TreePath、过时 plugin/v2 字段与 route chunk 反向 import，比“页面从 1760 行降到 510 行”更能判断拆分是否提升了可靠性。

## Promotion Candidates

- Dashboard 架构文档可记录 system form 的三层边界：纯 builder 定义客户端 wire shape，field/dialog 负责交互，route page 只做协调。
- 验收指南可加入：新增包级测试必须进入根 verify；lazy route 拆分需检查反向 import 和 fresh-source chunk；UI 列表分隔符须先审计领域语法。

## Evidence Boundary

- 当前 Node Vitest 10 例、Dashboard type/build、根 `test:unit` 与 fresh-build Gateway UI integration 已证明 builder 契约和打包接线。React dialog 生命周期、草稿保留、分页与一次性敏感值交互仍是明确的组件/浏览器测试缺口，不能由纯函数全绿推断完成。
