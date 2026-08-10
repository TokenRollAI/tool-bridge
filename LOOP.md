# LOOP(持续开发执行契约)

> 本文与 DOD.md 是一对:DOD 定义什么算完成,本文定义每一轮怎么干。
> 这是无人值守(AFK)契约:没有人在每轮之间把关,所以证据门、晋级与终止条件都写死在下面。

## 如何启动

把下面这段粘进一个 agent 会话(或用 `/goal`,若已安装为命令):

```
读本仓库的 LOOP.md 与 PROGRESS.md,按 LOOP.md 的状态机一轮接一轮地跑,
直到命中终止条件。每轮结束把证据与勾选写进 PROGRESS.md。
你被授权自动编辑文件;commit 与其它外向动作按 LOOP 的纪律与宿主惯例判断。
```

一次能连跑几轮取决于宿主:有的 harness 一次回复只跑一轮,那就反复重入(手动"继续"、脚本或外层 loop)。本文只保证——不管谁来唤起,行为都一致、且知道何时该停。

## 开跑前先读(本项目专属)

本项目有 llmdoc 压缩知识层,动代码前必读,能省大量重复探索:
1. `llmdoc/must/project-brief.md` — 项目定义、知识真源、工程纪律(含选型表)、术语。
2. `llmdoc/must/current-state.md` — 部署资源、代码现状、凭据状态、未竟事项。
3. `DECISIONS.md` — 本轮 9 个已拍板决策 + 理由(grill 共识,权威来源)。
4. 按当前 Phase 再读:动代码找文件 → `llmdoc/architecture/code-map.md`;引用接口契约 → `llmdoc/reference/protocol-contract.md`;对应阶段的 `guides/`(改 Provider/注册边界读 modules-and-boundaries;改设备通道读 do-websocket-hibernation;改 server/Docker 读 docker-host;写 KV 读 workers-kv-pitfalls;挂 mcp 上游读 mcp-upstream-pitfalls;新增 CLI 参数读 cli-argument-contract-review;发 npm 读 npm-publish;部署读 deploy-and-verify)。

## 不可违背的纪律
1. **DOD 是法官**:只有可复现证据(命令 + 输出)能勾选 DoD 项。没跑过、没贴证据,就不勾。
2. **不伪造进度**:失败就报告失败,跳过就明说跳过。消耗真实外部资源的验证(生产网关、真实上游、飞书、真实 S3)每轮最多跑一次并留证据。
3. **规格是宪法**:实现偏离 VISION/DECISIONS 时,先改文档说明理由,再写码。
4. **成熟框架优先**:要从头造轮子(HTTP 路由 / MCP 协议 / S3 签名 / argv 解析 / 自造重试持久化)是违例;表外新基础设施需求先调研现成库,写明理由才允许手写。选型表见 project-brief。
5. **breaking 一步到位(本轮专属)**:Phase 2 不保留 legacy provider API / v1 adapter / 强制四方法 / ToolProvider.Get。理由:项目未发布无用户,兼容层是最贵的部分。若发现某处 breaking 会打断一条仍需存活的链路,先在 PROGRESS 记录再定,不默认加兼容 shim。
6. **三入口对等(本轮专属)**:任何动了接口面的 Phase(B/C 尤甚),同轮交付/更新对应 `tb` 子命令与 Dashboard;某能力 CLI 做不到而 Dashboard/API 做得到 = 管理旁路 = 缺陷。
7. **安全默认拒(本轮专属)**:Phase 1 的 fail-closed 语义(resolve 不到 Secret、缺 bootstrap SK、非法 canonical origin)一律拒绝而非静默降级;新增授权判定只走 `Authorizer.Check`,不自造判权。

## 按宿主能力调整(不是铁令,用判断)
- **commit**:本项目纪律是少量多次提交;**逐阶段 PR** —— 每个 Phase 一个 PR,Phase 1(A 解冻)必须最先独立合并。先看工作区是否干净、用户是否授权 commit;未授权就把变更留着、在 PROGRESS 记一笔。**部署必须从与 origin/main 零差异的干净工作区执行**(见 current-state 遗留注意)。
- **subagent**:界限清晰的子任务(多文件读、跨包改动、能力矩阵审计)派并行 subagent 加速;宿主不支持就顺序自己做。
- **回归**:每轮跑与本项相关的包级测试(`pnpm --filter <pkg> test`);Phase 晋级时跑一次全量 `pnpm verify`。

## 每一轮
1. 取 context:读 PROGRESS.md(当前 Phase、上轮遗留、blocker)+ DOD 当前 Phase + 本 Phase 相关 llmdoc。
2. 定目标:挑当前 Phase 一个未勾选、且不被 blocker 卡住的 DoD 项作为本轮唯一目标。
3. 实现:见"按宿主能力调整"。先取证后改码(改既有行为前先拉当前真实状态)。
4. 验证:拿到本项的可复现证据(命令 + 输出)。贴进 PROGRESS,再勾 DoD。
5. 沉淀:更新 PROGRESS;踩了坑记下来防止下轮重蹈;durable 教训收尾时提示走 llmdoc:update。

## 状态机:晋级与终止
每轮结束后判断下一步:
- **Phase 晋级**:当前 Phase 的 DoD 项全部勾选 → 跑一次该 Phase 全量回归(`pnpm verify`)+ 若该 Phase 要求部署则部署并留生产证据 → 开 PR → 进入下一 Phase。不跳 Phase(依赖关系:A→B→E→C→D)。
- **全部完成(终止)**:Phase 5(E2E)5 条全勾 → 在 PROGRESS 顶部写"全部完成"并附最终证据,停下。
- **卡住挂起**:同一 DoD 项连续 3 轮不闭环、或撞上需人拍板的决策(生产部署、PR 合并等)→ 标成 **PENDING** 写进 PROGRESS 顶部,去做下一个能做的项。不停机空等,不在死磕点烧 token。
- **Phase 内只剩 PENDING → 继续下一 Phase**(2026-08-10 用户指令,覆盖原「卡死即停机」):
  判断依据是**代码依赖**而非流程依赖。被挂起的若是"部署 / 合并"这类流程动作,后续 Phase 的
  **编码**工作通常不依赖它——它依赖的是前一 Phase 的**代码**,而代码已在本分支上,可以继续;
  只有当被挂起的是后续 Phase 真正依赖的**代码产物**时才必须等。
  每次因 PENDING 跨 Phase,在 PROGRESS 写明「跳过了什么 / 为什么不构成代码依赖」。
- **真正停机的唯一情形**:所有 Phase 的全部未勾项都被 PENDING 卡住,无任何可推进项。

## 单轮输出格式(追加到 PROGRESS.md)
```
## Round <N> — <日期>
- 目标:<Phase X / DoD 项原文>
- 动作:<实现摘要;派发的 subagent 及其结论>
- 验证:<命令 → 结果>(逐条)
- 勾选:<勾掉的 DOD 项 / 无>
- 遗留:<blocker 或下一轮建议起点>
```
