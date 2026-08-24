# CLAUDE.md

## 会话启动必做

- 每次会话开始时，先执行一次 `pwd` 确认当前工作目录。本项目经常在 git worktree（如 `~/.superset/worktrees/...`）中工作，**所有绝对路径必须基于 `pwd` 的结果来拼**，不要根据提示词中出现的主仓库路径去猜测文件位置。

## 改了可发布包就要发版本

`packages/*` 里**非 private** 的包(当前:`app` / `cli` / `dashboard` / `gateway`
/ `plugin-sdk` / `sdk` / `server`;`core` 与 `plugins` 是 private,不发布)一旦有改动,
同轮就要 bump 版本并打 tag 推送 —— 不要留给"下次一起发"。

### 判定要 bump 哪些包

按 **public artifact ownership**:只有**自身**外部契约、依赖约束或发布内容变化的 public 包
才 bump。private 且被 bundle 的包(core/plugins)不因内部实现变化单独 bump,**也不沿源码依赖图
传递式提升所有 public 包**。

判据是"消费者能不能感知",不只是"导出面有没有变":新增路由、改变既有配置的接受/拒绝行为、
默认值从放行改成拒绝 —— 这些 `index.ts` 的 diff 是空的,但对消费者是可感知的变化,要 bump。

```bash
# 看哪些包的 src 有改动
for p in app cli dashboard gateway plugin-sdk sdk server; do
  git diff main..HEAD --stat -- "packages/$p/src" | tail -1 | sed "s|^|$p |"
done
```

### 版本号

仓库处于 0.x,按 semver 的 0.x 约定:**破坏性变更走 minor**,新增能力也走 minor,纯修复走 patch。
凡是"既有部署升级后行为会变"的改动(如某个缺配置的路径从放行改成拒绝),必须在提交与 PR 正文里
显式点出,不能只写"修复"。

### 流程(顺序不能反)

1. 改 `packages/<pkg>/package.json` 的 `version`
2. **重建并验证产物入口真的带新版本** —— 只读 manifest 或看到 `dist` 已存在都不算证据:
   ```bash
   cd packages/cli && pnpm build && node -e "console.log(require('fs').readFileSync('dist/index.js','utf8').includes('0.9.0'))"
   ```
3. `pnpm verify` **和** `pnpm turbo run build` 都要过 —— **`verify` 不跑 build**,而 build 是
   发布 workflow 的第一道闸门,这类断裂只在打 tag 后暴露、返工要删 tag 重打
4. 等 PR 合入 main 后,在 main 上打 tag 并推送(**别在未合入的分支上打** —— tag 一推 CI 就发 npm,
   而 npm 版本号不可回收):
   ```bash
   git tag <pkg>-v<版本> && git push origin <pkg>-v<版本>
   ```
   tag 前缀:`app-` / `cli-` / `dashboard-` / `gateway-` / `plugin-sdk-` / `sdk-` / `server-`
5. **一次只推一个 tag** —— `git push origin tag1 tag2` 不触发 tag workflows(实测四 tag 同推零触发)
6. 发布后复查:`npm view <pkg> version`。**刚发完可能仍报 E404**(registry CDN 传播延迟,
   实测 91 秒后仍 404),等一两分钟再查,或直接看 `npm view <pkg> time.created`

细节与踩过的坑见 `llmdoc/release/npm-publishing.mdx`(用 `npx --no-install llmdoc show release/npm-publishing.mdx`)。
