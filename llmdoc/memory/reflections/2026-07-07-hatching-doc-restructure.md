# 项目"破壳"文档重构反思(2026-07-07)

> 范围:初步实现阶段结束后的一次性大重构——bootstrap 期文档(docs/ 五份规范、TB/LOOP/DOD/PROGRESS)归档到 archive/,清理源代码与文档中的全部规范章节引用(Proto §x、DOD.md:行号、Phase N,约 640 处、150+ 文件,4 个 worker 并行),全面重写 llmdoc(proto-map 章节地图 → 自包含 protocol-contract,current-state 补落地事实)与双语 README。本文记这轮重构暴露的流程教训。

## 1. llmdoc 漂移了整整两个阶段才被发现,同步类任务必须先做"实现 vs 文档"审计

**现象**:`llmdoc/must/current-state.md` 停在"当前目标 Phase 4",而实际 SDK、Plugin、Dashboard 均已落地——测试数 core 322→589、cli 45→101、gateway 34→82,文档整整落后两个大阶段。这次差距能被完整暴露,靠的是 investigator 实跑测试拿精确数字做审计,而不是相信文档里写的数字。

**下轮怎么做**:
- 每个大功能关门(feature 收尾 / phase 结束)时,必须同步更新 current-state,不能攒到下次重构;
- 任何"文档同步/重写"类任务,动笔前先做一轮"实现 vs 文档"审计(实跑测试、实查代码取证),以实现为准列出差距清单,再改文档。

## 2. hook 会自动暂存 llmdoc 编辑,分块提交前必须核对暂存区

**现象**:主协调者按"代码清理 / llmdoc / README"分块提交时,`git add packages/ scripts/` 的那次 commit 意外带上了 llmdoc 的全部改动——llmdoc 插件 hook 在每次编辑后自动 `git add`,暂存区里早已躺着这些文件。修复手法:`git reset --soft HEAD~1 && git reset` 全部退回,再严格按 pathspec 重新分块提交。

**下轮怎么做**:
- commit 前先看 `git status` 第一列,确认暂存区没有他人或 hook 预置的内容;
- commit 后立刻 `git show --stat` 核对本次提交只含预期文件。

这是对既有 [共享工作区多 agent 提交纪律](shared-worktree-multi-agent-commits.md) 的补充:暂存区污染源除了并行 agent,还有编辑器/插件 hook。

## 3. 批量删注释引用后要先跑 formatter 再 verify

**现象**:批量删除注释/字符串中的括注引用后,原本因超长而折行的多行调用可以收成单行,biome format 报了 6 处错,verify 首轮失败。

**下轮怎么做**:凡是批量文本清理(删注释、改字符串、重命名),改完先 `pnpm lint:fix` 让 formatter 归位,再跑 verify,一次过。

## 4. 运行时字符串里的引用与测试断言耦合,清理任务 prompt 要点名"运行时字符串 + 测试同步"

**现象**:章节引用不只藏在注释里——error message、CLI `--help` 文案等运行时字符串也埋着(如 status 命令 description 的 "Phase 0: GET /healthz")。删这些字符串会连带击穿断言它们的测试;若清理任务的 prompt 只说"清理引用",worker 往往只扫注释,漏掉运行时字符串,或改了字符串却没同步测试。

**下轮怎么做**:给 worker 派批量清理任务时,prompt 明确写上两条规则:(1) 清理范围包含运行时字符串(error message、CLI 文案、日志),不止注释;(2) 改动任何运行时字符串必须同步更新断言它的测试。

## Promotion Candidates

- 教训 2(hook 自动暂存)应合并进既有的"共享工作区多 agent 提交纪律"记忆/文档,把污染源清单从"并行 agent"扩展为"并行 agent + hook"。
- 教训 1 的"大功能关门时同步 current-state"属于 llmdoc 维护纪律,可考虑写入 llmdoc 工作流说明(startup/skill 层面),避免再攒出两个阶段的漂移。
