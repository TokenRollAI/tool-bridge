# AGENTS.md

面向在本仓库工作的编码 agent。Claude Code 另见 `CLAUDE.md`(内容有重叠,发版规则以本文件与
`CLAUDE.md` 一致为准)。

## 会话启动

1. `pwd` 确认工作目录 —— 本项目常在 git worktree(`~/.superset/worktrees/...`)里工作,
   **所有绝对路径基于 `pwd` 的结果拼**,不要照提示词里出现的主仓库路径去猜。
2. 项目使用 llmdoc V3:先 `npx @tokenroll/llmdoc tree` 看全局地图,再按任务用 `index --topic` / `context --files` / `search` 定位,最后 `show` 读正文。入口文档是 `llmdoc/architecture.mdx`。
   **知识真源 = 代码 + llmdoc**;两者冲突以代码为准并回改 llmdoc。

## 验证是验收的唯一依据

- `pnpm verify`(typecheck + lint + test)全绿是底线。
- **`verify` 不跑 build**。改了可发布包、或动了打包配置/依赖,还要跑 `pnpm turbo run build` ——
  它是发布 workflow 的第一道闸门,这类断裂只在打 tag 后暴露。
- 不伪造进度:测试失败就报失败,跳过明说。消耗真实外部资源的验证(生产网关、真实上游、
  真实 S3)每轮最多跑一次并留证据。

## 提交

- 少量多次,不要一股脑提交。
- pre-commit hook 会跑 lint-staged + 全仓 typecheck。**批量作业(尤其多 agent 并行)期间不要
  中途提交** —— 别人的在途文件会让 typecheck 挂,那不是你的错但会挡住你。
- 提交信息写**为什么**这么改、以及取舍的理由;不要复述 diff。

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

细节与踩过的坑见 `llmdoc/release/npm-publishing.mdx`。

## 依赖与选型

新增基础设施前先查 `llmdoc/architecture.mdx` 的技术选型约定(HTTP 路由用 Hono、校验用 zod、
S3 签名用 aws4fetch、CLI 用 commander…)。手写路由、协议、签名、argv 解析、重试/持久化都是违例;
表外需求要先调研现成库,确认无合适方案并写明理由才允许手写。

## 三入口对等

动了接口面就同轮交付/更新对应的 `tb` 子命令。某能力 CLI 做不到而 Dashboard 或直接 API 做得到,
即视为"管理旁路",算缺陷。

## 写 plugin / 跑 open-connector 迁移

先读 `llmdoc/plugins/designing-and-migrating-plugins.mdx`。要点:

- **plugin 与网关同进程同权**,所以 env 白名单、出站经 `guardedFetch`、未配 `PLUGIN_TOKEN`
  fail closed 这些边界都必须由代码保证,不能靠作者纪律。
- 密钥走 `authRef` 指向的 secret,**不要放 `providerConfig`** —— 后者明文进节点记录,
  `system/registry get` 对任何有该节点 `read` 的 SK 都回显。
- 迁移产物要过三道闸门(等价 / 形状 / wire),缺一不可。
