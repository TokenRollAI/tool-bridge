# 反思:Dashboard 与 CLI 能力对等(PluginsPage + MountDialog/ContextBrowser 补齐)

## Task

- 补齐 Dashboard 相对 CLI 的能力缺口:新增 PluginsPage,补全 MountDialog/ContextBrowser,使配置面(NodeConfig/cmd 字段)与 CLI flag 逐一对齐。
- 本地全链路验证:浏览器跑通 plugin 注册 → token → 探活 → 挂载 → 消费。

## Expected vs Actual

- 预期:按现有页面模式平移即可,后台起 `wrangler dev` 顺跑验证。
- 实际:功能达成,但踩到两处流程坑(`| head` 杀死后台 wrangler、共享工作区 lint:fix 波及他人 WIP);能力审计靠"主会话读契约 + investigator 全量矩阵"双向交叉才补全(单方各有误判/遗漏)。

## What Went Wrong

1. **后台长驻进程接了 `| head`**:`wrangler dev | head -60` 在 head 读满退出后,SIGPIPE 把 wrangler 一并杀掉。表象是"探活突然失败/后台任务莫名 completed",初看像服务问题,实为管道生命周期问题。
2. **共享工作区跑全量 `pnpm lint:fix`**:biome 顺手格式化了另一会话正在编写的未提交 WIP(`packages/core/src/builtin/plugin.ts`)。靠既有提交纪律(pathspec 提交 + commit 后 `git show --stat` 核对)才没把他人 WIP 带进提交,但对方工作区已被改动。
3. **单视角审计不完整**:主会话对着 builtin cmd 表/CLI 命令线格式做的缺口清单有一条误判;investigator 的全量矩阵纠正了它,同时补出 ctx 条目层三条我漏掉的缺口——任一单方结论直接开工都会返工。

## Root Cause

1. `head` 退出即关闭管道读端,写端进程收 SIGPIPE 死亡;"截断日志"与"长驻进程"两个需求不能用同一条管道满足。正解:`> log 2>&1` 重定向到文件,想看头部再对文件 `head`。
2. `lint:fix` 的作用域默认是全仓,而多会话并行时工作区不是"只有我的改动";没有先 `git status` 圈定自己的文件就放开跑。
3. 能力对等审计本质是矩阵核对(每个字段 × 每个入口),单会话容易被"我熟悉的路径"锚定;交叉核对是低成本纠偏手段。

## Missing Docs or Signals

- `guides/verification-and-commit-practices.md` 长驻进程一节讲了 `nohup … &` + PID + kill,但没写 **禁止对长驻进程接 `| head`/`| grep -m`** 这类会提前退出的读端。
- 批量改动一节讲了"批量清理后 lint:fix",但没写多会话共享工作区的限定手法:lint:fix 前先 `git status` 圈定自己的文件,或用 `biome check --write <自己的 pathspec>` 限定范围。
- "配置面对等"纪律现只写了"NodeConfig 字段 → CLI 可设置"单向;本轮证明 UI 侧同样适用(每个 NodeConfig/cmd 字段逐一对 CLI flag / Dashboard 控件),且宜写明"双向 + 交叉核对"打法。
- 本地 UI 全链路验证配方无处可查,本轮是现拼的(见下)。

## Promotion Candidates

应由 recorder 提炼进 `guides/verification-and-commit-practices.md`:

1. 长驻进程日志一律 `> log 2>&1` 落文件,禁接 `| head` 等会提前退出的管道读端(SIGPIPE 杀进程,表象是探活突然失败/后台任务 completed)。
2. 多会话共享工作区跑 lint:fix 的限定纪律:先 `git status` 圈定自己文件,或 `biome check --write <pathspec>`;与既有 pathspec 提交纪律成套。
3. "配置面对等"扩写为双向(CLI ↔ Dashboard),并注明大矩阵审计宜"主会话读契约 + investigator 全量矩阵"交叉核对。

可考虑进 `guides/deploy-and-verify.md`(或新小节)的可复用配方:

4. **本地 UI 全链路验证**:`wrangler dev --persist-to <临时目录> --var TB_BOOTSTRAP_ADMIN_SK:<已知值> --var TB_ALLOW_INSECURE_HTTP:true` + `pnpm --filter @tool-bridge/gateway stub-provider`,浏览器可跑通 plugin 注册→token→探活→挂载→消费;数据面 curl 注意 body 是 `{tool, arguments}`(不是 `args`),人类模式响应包 ```json 围栏。

留在 memory 即可:本轮误判/遗漏的具体条目、被格式化的具体文件名。

## Follow-up

- recorder 按上述四条更新两篇 guide;`must/current-state.md` 同步 Dashboard 能力对等现状。
- 下次并行会话开工前,主会话与 worker 的 prompt 里显式带上"lint:fix 限定 pathspec"一句,直到该纪律进 guide。
