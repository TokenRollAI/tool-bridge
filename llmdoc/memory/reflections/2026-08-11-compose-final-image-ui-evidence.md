# 反思:Compose final image 的 Dashboard 打包与 UI 证据边界

## Task

- Round 31 闭合 E2E-D：验证 Docker Compose 的 production final image 不仅 API 与三跳插件链健康，也真实包含并可运行当前 Dashboard，覆盖 SPA、资源、树网络、键盘和浏览器错误面。

## What Changed During Verification

- `pnpm --filter @tool-bridge/server --prod deploy --legacy /out` 没有把 Dashboard 变成 final image 内的自足目录，而是在 `/app/node_modules/@tool-bridge/dashboard` 保留指向构建阶段 `/repo/packages/dashboard` 的 workspace symlink。final stage 不含 `/repo`，链接悬空；server bundle、SQLite 与 API 不依赖这条链接，因而容器 healthy、gateway→plugin→mock upstream smoke 全绿，只有 `/ui` 404。
- 最终镜像不再依赖运行时 package resolution：构建阶段继续 fresh build Dashboard，final stage显式复制 `dist` 到 `/app/dashboard`，并设置 `TB_UI_DIR=/app/dashboard`。Node assets resolver优先校验该 override 的 `index.html`；路径无效时按既有语义关闭 UI，不静默回退到另一份可能过期的产物。
- Compose smoke 新增 `/ui/` 与 `/ui/manage/registry` 的 200、HTML content type 和当前 title 断言；真实 final-image 浏览器再验证入口 assets、九类路由的 desktop/mobile 导航、树请求 depth、ARIA 键盘、移动焦点恢复、console warning/error 与 pageerror。

## Durable Lesson

1. **构建阶段存在 workspace 产物，不代表 final image 可达。** 多阶段 Docker build 会丢弃未显式复制的路径；package manager 的 deploy 目录中即使列出 workspace 依赖，也可能只是指向 build-stage 工作区的 symlink。验收应在 final container 内检查 `readlink`、目标存在性和普通用户可读性，而不是只看 `/out` 文件名或构建日志。
2. **API healthy 不能代表同进程的静态 UI 可用。** `/healthz`、SQLite、secret、plugin 注册和三跳 call 可以完全绕过 Dashboard assets；因此这些全绿时 `/ui` 仍可能 404。一个容器承载多种能力时，health/smoke 必须为每个对用户可见的能力设置独立探针，不能用共同进程存活外推所有功能。
3. **跨 stage 的关键静态产物应显式复制并显式寻址。** `COPY --from=build .../dashboard/dist /app/dashboard` 建立真实目录，`TB_UI_DIR` 把运行时真源钉在同一路径；这比依赖 node_modules symlink、hoist 布局或 `require.resolve` 的偶然行为更稳定。复制后还要确认 `USER node` 可读、入口与 assets 均在镜像内。
4. **UI smoke 至少要覆盖 SPA root 与 deep link。** `/ui/` 证明入口 HTML 存在，`/ui/manage/registry` 证明未知静态文件可回退到 SPA index；两者都要断言 200、`text/html` 和可辨识内容。只探 root 会漏掉反向代理/serveUi fallback 错误，只探任意 200 又可能把 JSON、404 页面或陈旧占位页当成功。
5. **HTML title 不是完整资源可用性证明。** smoke 的 title 断言能防住本次“无 Dashboard”回归并提供低成本同步退出码，却不能证明 HTML 引用的 hashed JS/CSS 存在、content type 正确或 React 能启动。可进一步从镜像 HTML 抓入口 asset；当前由真实浏览器的资源请求和页面运行补齐，不能把 smoke 单独描述成完整 UI E2E。
6. **浏览器必须消费被发布的 final image。** Vite dev server、宿主 `packages/dashboard/dist` 或 Node workspace package都可能绕开镜像布局问题。本轮浏览器直接访问 Compose gateway final image，才能把 Docker copy、`TB_UI_DIR`、静态文件服务、SPA fallback与客户端运行串成同一条证据链。
7. **真实浏览器要验证行为面，而不只是页面能打开。** desktop/mobile 共九类路由证明 lazy chunks与导航；root `depth=1`、local lazy `depth=1`、remote `depth=3`、filter `depth=8` 证明树网络边界；Arrow/Home/End/Left/Right 与移动 Escape/focus restore 证明 ARIA 状态和焦点；`console warning=0`、`error=0`、`pageerror=0` 防止视觉可见但运行期已报错的假绿。
8. **smoke 与浏览器应分层而非互相替代。** Compose smoke 快速、可重复、能在 CI 直接传播 final-image 缺 UI或 deep-link 失败；浏览器较重，覆盖 assets、Router、React、网络策略与可访问性。前者应作为每次栈验收的底线，后者用于发布级行为证据；两层都必须基于当前源码生成的同一 final image。
9. **现场自动化证据不等于长期回归已固化。** 本轮真实浏览器足以闭合当前 E2E-D，但仓库仍没有独立维护的 Playwright spec。后续若 Docker/UI 边界持续演进，应把最小路由、tree depth、ARIA 和 console 矩阵固化，而不是只依赖一次运行记录。

## Promotion Candidates

- Docker/发布指南可加入 final-image 资产审计：workspace symlink 目标存在、`TB_UI_DIR/index.html` 可读、root/deep-link HTML 与入口 JS/CSS 200，且浏览器必须连 final container。
- Compose 验收指南可把能力探针拆为 process health、Dashboard root/deep link、三跳业务 call和真实浏览器四层，避免用 API success 代领 UI success。

## Evidence Boundary

- 当前 final image 已验证 `/app/dashboard` 为真实可读目录、`TB_UI_DIR` 生效；Compose smoke 的 Dashboard root/deep link及 gateway→plugin→mock upstream 全 PASS，宿主额外请求的入口 JS/module preload/CSS 也为正确 content type。真实 final-image 浏览器在 desktop/mobile 共 18 次导航中无横向溢出，树 depth 边界、ARIA 键盘与移动焦点恢复通过，`warning=0`、`error=0`、`pageerror=0`。这些证据闭合本地 E2E-D，但浏览器流程尚未固化为仓库内长期 Playwright 回归。
