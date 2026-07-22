# Guide:验证与提交实践

> 用途:功能收尾、真实环境验证、批量改动与提交时的既定纪律。来源:bootstrap 期多轮反思的存量提炼(原文已归档 `archive/llmdoc-reflections/`)。更新时机:新实践定型或纪律变化时。

## 收尾验证(功能"完成"的判据)

- **证据矩阵**:宣布一个功能完成前,把「实现存在 / 测试覆盖 / 可重跑命令(生产或 opt-in)」三件事分开判断,逐条留命令 + 输出摘要;"看起来做完了"不算数。
- **多阶段验证必须 fail fast**:build、执行产物、pack 等相互依赖的命令用 `&&` 或脚本级严格错误处理连接;不能只看整段 shell 的最终退出码,因为末尾成功会掩盖前序失败并继续消费陈旧产物。
- **收尾同轮更新 current-state**:大功能收尾时同步更新 [../must/current-state.md](../must/current-state.md),不要攒——曾因积攒导致文档落后实现两个大阶段。文档同步类任务动笔前先做一轮"实现 vs 文档"审计(实跑测试取数、实查代码取证,以实现为准列差距清单)。
- **三入口能力对等**:每新增 builtin/API 动词、NodeConfig/ProviderConfig 字段或 Provider 分支,同轮按「动词 × 字段 × 分支」核对 API/builtin ↔ CLI ↔ Dashboard;刻意不暴露必须写明理由(防管理旁路)。涉及 CLI 参数时按 [cli-argument-contract-review.md](cli-argument-contract-review.md) 同时审 Commander 解析、本地语义和服务端安全边界。
- **代理/存储边界要测出站形状**:白名单/环检测之外,必须有测试直接断言出站请求或存储层的真实形状(调用者 SK 不外传、skRef 换发、路径改写、版本/内容),不能只断言入口返回 200。
- **Dashboard 真实浏览器四面证据**:前端功能收尾除 build/typecheck 外,至少核对①desktop/mobile/矮屏的滚动、横向溢出、键盘焦点与 Escape 恢复,②首屏请求与显式交互后请求的形状,③localStorage 等浏览器存储不含敏感参数,④测试数据超过服务端默认 limit 后可继续分页且派生计数/筛选正确。静态 class 审查和单页截图不能替代这些证据;lazy 分包还须覆盖动态 import 失败的恢复路径。

## opt-in 与真实环境验证

- 外部资源测试只以**完整命令退出码**为证据;workerd 打印 SDK sourcemap / `Network connection lost` 诊断噪声但退出码 0 属正常,stderr 文本不作为成败依据。
- 涉及 DO 内存态 + 长连接的功能,真实环境验证必须含**跨休眠窗口**用例(≥150s 空闲后调用);本地 miniflare 测不出(详见 [do-websocket-hibernation.md](do-websocket-hibernation.md))。
- **长驻进程**(如 `tb connect`)验证:`nohup … &` 起、记 PID、验证完 kill——用带超时的 exec 跑会在超时被杀,造成"设备离线"假象。多轮验证复用同一个测试 deviceId,connect 与 call 的目标路径写成同一个变量(曾因 id 不一致白排查一轮);轮末清理测试进程与注册残骸。设备是否在线以 invoke 结果为准(registry 的 `online` 经 KV 最终一致,仅供参考)。
- **生产 blocker 先取证后改码**:时间线证据(如 registry updatedAt 间隔揭示"全部 ~2min 死亡"模式)、对照实验(t0 调用 vs 空闲 150s 后调用,一次区分路由问题与休眠问题)、`wrangler tail` + 临时 console.log 锁定层位,然后才动手;凭猜测改码会在错误层面上打转。
- **权限疑虑用真实操作核实**:与其翻 whoami 权限清单,不如直接做一次幂等的真实操作(如 `wrangler r2 bucket create`)验证。

## 批量改动

- 批量文本清理(删注释/改字符串/重命名)后先 `pnpm lint:fix` 再 verify——原本因超长而折行的调用可收成单行,formatter 会报错。
- 清理范围包含**运行时字符串**(error message、CLI 文案、日志),不止注释;改动任何运行时字符串必须同步更新断言它的测试。派 worker 做批量清理时,这两条要明确写进 prompt。

## 提交纪律

- 少量多次;多 agent 共享工作区一律 pathspec 提交,禁 `git commit -a`、不带路径的裸 commit 与 `--amend`。
- **llmdoc 插件 hook 会在每次编辑 llmdoc/ 文件后自动 `git add`**:commit 前先看 `git status` 第一列确认暂存区没有预置内容;commit 后立刻 `git show --stat` 核对只含预期文件;带错了用 `git reset --soft HEAD~1 && git reset` 退回再按 pathspec 分块重提。

## 发布包

- 发布包的"可独立消费性"(types 入口 × files 白名单 × dependency 分类)不在 `pnpm verify` 覆盖内;发布前用隔离 tsc 验证类型自包含,流程与坑见 [npm-publish.md](npm-publish.md)。
