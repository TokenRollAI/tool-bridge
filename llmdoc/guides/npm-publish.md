# npm 版本与发布

公开包共有七个：`app`、`cli`、`dashboard`、`gateway`、`plugin-sdk`、`sdk`、`server`。`core` 与 `plugins` 是 private，其代码由公开产物消费或打包。

## 是否 bump

按 public artifact ownership 判断：只提升消费者能感知到契约、依赖约束或发布内容变化的公开包。private 源码变化不会机械地沿依赖图提升所有包；但被 bundle 后改变公开运行时行为，仍属于对应公开包的变化。

仓库处于 `0.x`：破坏性变化和新增能力升 minor，纯修复升 patch。隐藏 flag 删除、既有配置从接受改为拒绝、默认安全行为收紧，都属于消费者可感知变化。

## 发布顺序

1. 修改 `packages/<pkg>/package.json` 的 version，并同步 lockfile。
2. 重建该包，直接检查生成入口确实包含新版本；已有 `dist` 不是证据。
3. 执行 `pnpm verify` 和 `pnpm turbo run build`。
4. 用 `scripts/pack-and-verify-package.mjs` 生成并验收最终将发布的确切 tarball。
5. PR 合入 `main` 后才创建 `<pkg>-v<version>` tag。
6. 一次只推一个 tag，等待对应 workflow；不要批量 push tags。
7. 用 `npm view <pkg> version` 或 `npm view <pkg> time.created` 确认 registry 元数据，再下载 registry 中的精确版本 tarball，重复干净安装与烟测。元数据存在不能代替 tarball 可安装性验证。

tag 前缀与目录同名，包括 `plugin-sdk-`。Dashboard 若嵌入 server/gateway 产物，应先发布它依赖的包，再发布承载最终产物的包。

## 打包检查

- 所有公开包统一用 `node scripts/pack-and-verify-package.mjs packages/<pkg> --output-dir <dir>` 打包和验证；CLI 额外传 `--bin tb`。
- 默认模式通过 `pnpm pack` 生成确切 tarball、扫描 packed manifest，并在仓库外创建干净 npm 消费者安装；CLI 还执行 `tb --version` 与 `tb --help`。
- `files`、exports、bin、types 与 `publishConfig` 必须指向构建后真实存在的文件。
- 多入口包必须递归检查 `exports` 的全部条件目标（包括 `types`、`import`、`react-native`），不能只验证 `main`。`@tool-bridge/sdk/device` 还必须扫描最终 tarball 中的 JS/d.ts：不得引用 `node:*`、Node `ws`、Hono、`process.env`、private workspace 包或 Node-only 声明类型；干净消费者同时 import 根入口与 device 子入口。
- 解包最终 packed tarball，检查其中 `package.json` 的 `dependencies`、`optionalDependencies` 与 `peerDependencies`；不得残留 `catalog:`、`workspace:` 或其他 npm 不支持的工作区协议。
- CI 在全仓 build 后复用同一脚本并传 `--skip-install`，只保留 packed manifest 协议闸门；合入前的 workspace 依赖版本可能尚未发布到 registry，不能把这类不可安装误判为 tarball 协议错误。publish workflow 不得跳过干净安装。
- publish workflow 必须捕获脚本返回的 tarball 路径，并将同一个文件交给 `npm publish`；校验后重新打包会留下产物漂移窗口。
- 声明文件可能跨包引用私有源码，不能只依赖 monorepo typecheck。
- 版本字符串若编译进产物，必须在 bump 后重建并搜索实际入口。
- 发布失败时修复后重建、重验；不要复用已经推送且不可回收的 npm 版本。

不要在 llmdoc 记录某次发布的 latest、digest 或传播耗时；这些属于 registry、tag 与 CI 证据。
