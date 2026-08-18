# Agent Skill 接入与验收

## Ownership 与边界

公开 Agent Skill 由独立仓库 [`TokenRollAI/tool-bridge-skill`](https://github.com/TokenRollAI/tool-bridge-skill) 维护，安装入口是：

```sh
npx skills add TokenRollAI/tool-bridge-skill
```

仓库中的 skill id 是 `tool-bridge`。Skill 负责教 Agent 经 `tb` 使用网关，不拥有 HTBP 契约、CLI 实现或某个实例的工具目录；这些事实仍分别以目标实例运行时描述和 tool-bridge 代码为准。

不要把实例 URL、SK、动态工具清单或某次搜索结果固化进 Skill。Agent 只依赖已配置的 `TB_BASE_URL` + 最小权限 `TB_SK` 或本机 `tb login` profile。

## Agent 运行时流程

1. 用 `tb whoami --json` 验证目标与认证，输出中只能出现打码 SK。
2. 已知目标时先 `tb search`；Search capability 不存在时逐级使用 `tb tree`、`tb ls` 与 `tb help`。
3. 下钻工具级 `~help`，以 `cmds[].path`、schema、effect、confirm 和 scope 决定调用方式与确认边界。
4. 调用前读取 `~help` 中相关 feedback；陌生或易失败路径再主动 `tb feedback ls/get`。
5. 发生错误、超时、schema 合法但结果异常或上游行为不一致时，先在精确路径查用 feedback，再决定是否安全重试。
6. 已有条目确实帮助恢复时及时投票；新问题或已验证解法先去重，再在已获反馈写权限时提交。无写入授权则当场生成草稿并请求一次确认，不能把决定拖到任务结束。

运行时 `~help` 是契约真源，feedback 是经验层。feedback 可解释坑和规避方式，但不能覆盖当前 schema，也不能把未经验证的猜测包装成结论。

## 安全下界

- `effect:write`、`effect:destructive` 或 `confirm:true` 的调用遵守用户确认边界；超时后的副作用结果按未知处理，不自动重试。
- 404 同时表示不存在或对当前身份不可见，不通过探测猜隐藏路径，也不为此索要 Admin SK。
- SK 不进入 prompt、命令参数、日志、源码、临时产物或 feedback；自动化从 Secret 注入 `TB_SK`。
- feedback 不含凭证、客户数据、真实 payload、内部 URL 或未验证推测；优先投票已有同义条目，避免重复噪声。
- 管理类命令（挂载、注册、SK、Secret）不因安装 Skill 获得隐式授权。

## 变更联动

以下变化需要同轮检查 Agent Skill：

- `tb` 的目标配置、发现、help、call 或 feedback 命令语义变化；
- Help JSON 的调用路径、effect、confirm、scope、feedback 字段变化；
- 权限、404 可见性、错误码或安全边界变化；
- Agent 推荐工作流不再能从运行时自描述完成。

只更新 Skill 中稳定的流程与边界，不复制版本号或动态 catalog。公共教程若展示安装或连接步骤，也要同步评估；面向开发 agent 的内部实现细节仍留在本仓库 llmdoc。

## 验收

在 Skill 仓库至少验证：

```sh
npx --yes skills add . --list
```

输出必须只发现预期的 `tool-bridge` skill。再做两个隔离前向测试：

1. 正常路径覆盖 `whoami → search/tree → tool help → feedback read → call`。
2. 异常路径用确定性的首次失败覆盖 `call failure → feedback ls/get → 安全复验 → vote 或去重 submit`。

异常测试不能只在 prompt 里写“可能失败”；若 Agent 首次调用自然成功，只证明正常路径，必须通过无真实资源的可控故障注入重测。最后以 Skill 仓库 GitHub Actions 的 discovery 校验为远端证据。
