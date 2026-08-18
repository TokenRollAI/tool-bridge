# npm 版本与发布

公开包共有七个：`app`、`cli`、`dashboard`、`gateway`、`plugin-sdk`、`sdk`、`server`。`core` 与 `plugins` 是 private，其代码由公开产物消费或打包。

## 是否 bump

按 public artifact ownership 判断：只提升消费者能感知到契约、依赖约束或发布内容变化的公开包。private 源码变化不会机械地沿依赖图提升所有包；但被 bundle 后改变公开运行时行为，仍属于对应公开包的变化。

仓库处于 `0.x`：破坏性变化和新增能力升 minor，纯修复升 patch。隐藏 flag 删除、既有配置从接受改为拒绝、默认安全行为收紧，都属于消费者可感知变化。

## 发布顺序

1. 修改 `packages/<pkg>/package.json` 的 version，并同步 lockfile。
2. 重建该包，直接检查生成入口确实包含新版本；已有 `dist` 不是证据。
3. 执行 `pnpm verify` 和 `pnpm turbo run build`。
4. PR 合入 `main` 后才创建 `<pkg>-v<version>` tag。
5. 一次只推一个 tag，等待对应 workflow；不要批量 push tags。
6. 用 `npm view <pkg> version` 或 `npm view <pkg> time.created` 验证 registry。

tag 前缀与目录同名，包括 `plugin-sdk-`。Dashboard 若嵌入 server/gateway 产物，应先发布它依赖的包，再发布承载最终产物的包。

## 打包检查

- `files`、exports、bin、types 与 `publishConfig` 必须指向构建后真实存在的文件。
- 声明文件可能跨包引用私有源码；发布前用干净 tarball/临时项目验证，而不是只在 monorepo typecheck。
- 版本字符串若编译进产物，必须在 bump 后重建并搜索实际入口。
- 发布失败时修复后重建、重验；不要复用已经推送且不可回收的 npm 版本。

不要在 llmdoc 记录某次发布的 latest、digest 或传播耗时；这些属于 registry、tag 与 CI 证据。
