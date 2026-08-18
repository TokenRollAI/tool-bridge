# CLI Registry `catalog:` 依赖泄漏 Reflection

## Task

- 将本机全局安装的 `@tool-bridge/cli` 从 `0.7.0` 更新到 npm `latest` 指向的 `0.17.0`。
- 修复导致该版本不可安装的发布验证缺口，避免后续公开包再次发布未解析的 workspace 依赖协议。

## Expected vs Actual

- 预期：`npm install -g @tool-bridge/cli@latest` 直接安装 registry 上的最新版本。
- 实际：npm 解析 `0.17.0` tarball 的运行时依赖时，对 `partysocket` 与 `ws` 的 `catalog:` 值报 `EUNSUPPORTEDPROTOCOL`，官方发布物无法被 npm 正常安装。
- 为完成本机更新，从 registry tarball 出发，仅将这两个占位符替换为 `cli-v0.17.0` 标签下 `pnpm-workspace.yaml` 给出的确切版本 `partysocket@1.3.0`、`ws@8.21.0`，重新打出本地 tarball 后安装；`tb --version`、`npm ls -g @tool-bridge/cli` 与 `tb --help` 均通过。

## What Went Wrong

- 把“npm `latest` 已指向新版本”误当成“该版本可被 npm 消费者安装”。registry 元数据和版本存在性不能证明 tarball 的依赖协议有效。
- 发布验收偏向仓库内 pnpm 构建与入口检查，没有从干净 npm 消费者视角安装最终 tarball，因此漏掉了 workspace catalog 占位符进入运行时 `dependencies` 的问题。
- 本地重打 tarball 是针对当前机器的最小恢复手段，只证明修正这两个 manifest 值后 CLI 可以运行，不代表 registry 上的 `0.17.0` 已被修复。

## Root Cause

- 发布到 npm 的 `package.json` 仍保留 pnpm workspace 专用的 `catalog:` 协议；npm 不支持该协议，因而在执行 CLI 代码前就终止安装。
- 发布流程缺少对“最终将上传/已经上传的 tarball”执行协议扫描、干净 npm 安装和 bin 烟测的硬性闸门。

## Missing Docs or Signals

- `llmdoc/guides/npm-publish.md` 已要求用干净 tarball/临时项目验证，但未明确要求扫描最终 manifest 的运行时依赖，拒绝 `catalog:`、`workspace:` 等未被改写的 workspace 协议。
- 现有指南没有明确区分三种证据：registry 上存在版本、tarball 可由 npm 安装、安装后的 CLI 可执行；本次只满足第一项就开始升级，直到真实安装才发现断裂。
- CLI 发布验证缺少最小 bin 烟测清单，例如 `tb --version` 和 `tb --help`。

## Promotion Candidates

- 在 npm 发布 guide 中加入稳定规则：对最终 packed tarball 解包后检查 `dependencies`、`optionalDependencies` 和 `peerDependencies`，发现 `catalog:`、`workspace:` 或其他 npm 不支持的 workspace 协议即失败；不能只检查仓库源码 manifest。
- 将干净 npm 消费者验证设为公开 CLI 包的发布闸门：在临时目录安装最终 tarball，确认依赖树可解析，再执行版本与帮助命令。发布后再对 registry tarball 重复同类验证，不能以 `npm view <pkg> version` 代替。
- 对 catalog 依赖建立 CI 断言：发布构建必须把 workspace catalog 引用解析成确定版本；若发布工具未自动改写，应在发布前失败，而不是依赖用户侧 workaround。
- 故障恢复时允许基于同一发布标签的 workspace catalog 映射制作本地修复包，但要记录来源与替换范围，并明确它不是官方版本修复。

## Resolution

- 七个公开包的 publish workflow 统一调用 `scripts/pack-and-verify-package.mjs`：用 `pnpm pack` 生成将要发布的确切 tarball，扫描运行时依赖协议，并默认在仓库外执行干净 `npm install`。
- CLI 校验额外严格执行 `--version` 与 `--help`；修复版本提升为 CLI `0.17.1`，同时受发布内容变化影响的 SDK 提升为 `0.10.1`。
- CI 在全仓 build 后复用同一脚本并传入 `--skip-install`。这是为了允许 server 引用同一 PR 中尚未发布的 dashboard 版本；发布 workflow 仍保留默认的干净安装闸门。
- `pnpm verify`、`pnpm turbo run build` 与七个公开包的 clean install 均已通过。

## New Lessons

- 发布验证应产出并消费同一个 tarball；分别执行“校验 manifest”和“另行打包发布”仍可能留下产物漂移窗口。
- 仓库内 CI 与逐包发布的依赖可用性不同。复用同一个校验器并显式区分 `--skip-install`，比复制两套近似流程更容易保持协议扫描一致，同时不掩盖发布阶段的真实安装要求。
- CLI 的可安装性还不足以证明 bin 契约正常；版本输出和帮助入口应作为 CLI 专属的严格烟测。
- 本地 tarball 验收与 registry 实际产物验收是两道独立闸门，发布后仍须从 registry tarball 复验。

## Follow-up

- 剩余动作仅为 PR 合入 `main` 后按依赖顺序逐个发布新版本，并从 registry 下载实际 tarball，重复协议、干净安装及 CLI bin 验证。
