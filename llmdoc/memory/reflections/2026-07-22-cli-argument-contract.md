# 反思：CLI 参数契约审查与修复

## Task

- 审查现有 `tb` CLI 的参数设计、校验、分页和管理能力对等性，并修复高风险与高频问题。
- 保持 Commander 严格解析，同时让全局参数、结构化错误、超时、分页和各命令的条件参数形成一致契约。

## Expected vs Actual

- 预期：主要是补几处互斥参数和帮助文案。
- 实际：参数问题横跨三层——Commander 解析与位置、本地语义校验、服务端安全边界；只改 CLI 会留下直接 API 绕过，只改服务端又会让用户在一次网络往返后才得到本可提前发现的错误。
- 审计还暴露出 CLI 与 Dashboard/API 的能力漂移：Context 已支持 Delete、SK 已支持 Get/Update/禁用、Plugin 已能作为 Tool/Context Provider，但 CLI 未完整表达。

## What Went Wrong

1. **把可选字符串误当成已校验语义。** `--expires` 原样写入 `expiresAt`，非法字符串进入记录后，`Date.parse()` 返回 `NaN`；旧有效性判断的比较结果为 false，历史脏值因此仍被当作有效 SK。这不是输入体验问题，而是认证边界问题。
2. **“全局参数”只是在叶子命令重复声明。** `--json`、`--base-url`、`--sk`、`--timeout` 不能稳定放在根命令或命令组位置；Commander 自己产生的未知参数、缺值等解析错误也绕过了 `--json` 输出契约。
3. **同一个 flag 在局部命令复用了另一种语义。** `server add --base-url` 曾表示远端 HTBP 地址，而其余命令里 `--base-url` 表示当前网关；这使全局覆盖在该命令中不可表达，也让脚本迁移和帮助文案产生歧义。
4. **条件参数只写在帮助里，没有形成可执行约束。** mcp/http/plugin、r2/s3/plugin 等分支接受了不适用参数，多个内容来源隐含“某个赢”的优先级；用户拼出矛盾命令时仍可能发请求。
5. **把分页当作输出细节而非协议契约。** 多个返回 `Page<T>` 的 list/search 命令未暴露 `limit/cursor`，部分聚合列表过滤 items 后丢掉 cursor；超过默认页大小时，CLI 静默呈现不完整集合。
6. **对等审计停在命令族名称。** Dashboard/API 已支持的 Context Delete、SK 生命周期管理和 Plugin Provider 挂载，没有进入 CLI 命令矩阵；“三入口对等”若只看顶层页面或命令是否存在，会漏掉动词和配置分支。
7. **用裸 argv 猜测解析结果。** 首版生产入口用 `argv.includes('--json')` 判断 Commander 错误是否结构化；当 `--json` 位于 `--` 之后、实际只是 positional value 时也会误切 JSON 通道。输出模式同样必须以解析器认定的 option value/source 为准。
8. **实现校验与 help 契约曾不同步。** 依赖、互斥、范围、自动默认值和分页 fallback 若只存在于 action，用户仍需试错；而 Commander 的 `addHelpText('after', ...)` 不进入 `helpInformation()`，用错测试 API 会让迁移提示看似已测、实际未覆盖最终输出。

## Root Cause

- CLI 参数被当成解析器配置，而没有作为跨层契约审查：类型、互斥/依赖、位置、传输形状、服务端重复校验和输出错误形态没有放在同一张检查表里。
- 安全字段缺少“写入规范化 + 读取 fail closed”的双保险；校验只放在使用方会被直接 API 绕过，只放在写路径又无法处理存量脏数据。
- 参数命名按单个命令局部优化，没有维护“同名即同义”的全局不变量。
- 分页消费者围绕首屏 `items` 编写，忽略了 cursor 代表的知识边界；过滤视图尤其容易只保留 items 而丢续页令牌。
- CLI/Dashboard/API 对等核对没有下钻到「管理动词 × 配置字段 × Provider 分支」。
- 解析错误发生时 action 未执行，不能靠扫描原始字符串恢复语义；`--` 终止符、参数值和同名文本都会使字符串搜索产生假阳性。
- help 被当作文案而非公共参数契约，导致运行时约束、迁移路径和 fallback 限制缺少同轮可执行断言。

## What Worked

- 将共享规则收敛到 `args.ts`：全局参数合并、`limit` 1..200 校验、cursor 透传、带时区 ISO 时间解析与 UTC 规范化，避免各命令继续长出不同方言。
- SK 过期时间同时在 CLI 与 core 写/更新路径校验，认证读取对历史非法值 fail closed；用户获得快速反馈，安全边界也不依赖 CLI。
- 将裸 `fetch` 收敛到统一 HTTP helper，使 status、login 与 OAuth 本地回调兑换同样遵守 `--timeout`。
- 以 builtin/API 和 Dashboard 能力反向核对 CLI，补齐 `ctx rm`、SK Get/Update/Enable/Disable，以及 Tool/Context Plugin Provider 挂载。
- 生产入口递归读取 Commander 实际解析出的 `json` value/source，不再扫描裸 argv；`--json` 只是 `--` 后的值时保持人类错误通道。
- 测试显式参数化根/组/叶三种全局参数位置与 JSON 解析错误，并动态比对全部叶子命令，新增命令不会静默漏掉严格解析矩阵。
- 新增 help 契约测试：组级 help 展示 `Global Options`；依赖、互斥、范围、默认值、`server add` 迁移提示和 `server ls` 分页 fallback 都与行为同步；`addHelpText` 内容通过捕获 `outputHelp()` 断言。

## Missing Docs or Signals

- 缺少专门的 CLI 参数契约审查清单，现有文档只强调严格解析，没有覆盖解析、本地语义和服务端安全边界三层。
- `protocol-contract.md` 的全局参数、分页、SK 过期语义与命令矩阵已落后实现。
- `architecture/code-map.md` 仍把 `withGlobalOpts` 描述为只挂在叶子命令，未记录生产入口对 Commander 解析错误的统一处理。
- “三入口对等”已有纪律，但缺少下钻到动词、字段和 Provider 分支的明确矩阵。
- 缺少“help 是参数契约”的稳定规则，以及 `helpInformation()` 不包含 `addHelpText` 追加内容这一 Commander 测试陷阱。

## Promotion Candidates

1. 新增一篇稳定 guide，固定 CLI 参数审查的三层模型、同名同义、条件参数、全局位置、分页和对等矩阵。
2. `reference/protocol-contract.md` 更新全局参数位置/结构化解析错误、SK `expiresAt`、统一 Page 参数及新增命令能力。
3. `architecture/code-map.md` 更新 `args.ts`、`main.ts` 和相关测试职责。
4. `must/current-state.md` 记录本地未发布状态和最新 CLI 测试数，明确没有部署/发布证据。
5. 稳定 guide 增加解析结果优先于裸 argv、help 契约同步和 `outputHelp()` 测试规则。

## Follow-up

- 后续增加任何返回 `Page<T>` 的 CLI 命令时，必须同时提供 `--limit/--cursor`、原样保留响应 cursor，并用跨页用例验证。
- 后续增加 Provider 或 builtin 动词时，同轮按「API/builtin ↔ CLI ↔ Dashboard」三向矩阵核对，不能只检查页面或顶层命令存在性。
- 发布前给 `server add --base-url` → `--remote-url` 提供变更说明；help 与缺参运行时错误均已给迁移提示。本轮仅完成本地实现和测试，不宣称已发布或已部署。
