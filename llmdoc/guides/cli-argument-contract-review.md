# Guide：CLI 参数契约审查

> 用途：新增或修改 `tb` 参数、命令动词、分页列表、Provider 分支或安全字段时的审查清单。更新时机：Commander 装配、参数语义、管理 API 或 CLI/Dashboard 对等规则变化时。

## 三层一起审

CLI 参数不是单纯的 argv 解析配置。每次变更都按三层取证：

| 层 | 负责什么 | 必查问题 |
|---|---|---|
| 解析层（Commander） | 参数位置、类型形态、未知参数/缺值、输出通道 | 未知 flag 和多余 positional 是否硬失败？全局参数在根/组/叶子位置是否等价？`--json` 下连 Commander 错误是否也是结构化输出？ |
| 本地语义层（command action） | 互斥、依赖、条件分支、文件/stdin、帮助与迁移提示 | 不适用于当前 kind/provider 的参数是否在发请求前拒绝？多个输入源是否显式互斥？必填关系是否可执行而非只写在帮助里？ |
| 服务端边界（core/builtin/store） | 权威校验、规范化、存量脏数据处置 | 直接 API 能否绕过 CLI？安全字段是否写入前规范化？历史非法值是否 fail closed？失败是否不污染旧记录？ |

安全相关字段必须同时有快速反馈与权威边界：CLI 提前拒绝，core/builtin 重复校验。认证读取不能假设历史数据永远干净；无法证明有效就拒绝。

## 命名与条件参数

- **同名即同义。** 全局 flag 在任何子命令都必须保持同一含义。局部对象需要另一地址时使用具体名称，例如当前网关用 `--base-url`，联邦远端用 `--remote-url`。
- kind/provider 分支按白名单组装参数，同时拒绝其它分支的 flag；不要静默忽略，也不要形成“后一个赢”的隐式优先级。
- 参数依赖要本地执行，例如认证头/前缀必须依赖凭证引用；两个内容来源必须互斥；空描述等服务端必填字段应在 CLI 派生有意义的缺省值。
- 读取 stdin 的命令在交互式 TTY 且没有显式输入源时应立即报错，不能无限等待。
- 改名若破坏既有脚本，help 和发布说明必须给迁移提示；不要为兼容继续保留同名不同义。

## 真正的全局参数

`--json`、`--base-url`、`--sk`、`--timeout` 是根命令契约，以下位置应等价：

```text
tb --json sk list
tb sk --json list
tb sk list --json
```

叶子命令可重复声明以保持局部 help 自包含和历史调用兼容；action 前需把根命令解析到的显式值补到尚未显式设置同名参数的叶子命令。测试用参数化用例分别执行根、命令组、叶子三种位置，而不是用一个代表性位置推断其余位置；未知 flag、缺值、多余 positional 也要在三种 `--json` 位置下核对错误对象和非零退出码。

生产入口判断 JSON 错误通道时，只认 Commander 实际解析为 CLI option 的 value/source，不能用 `argv.includes('--json')` 等裸字符串扫描。`--json` 可能位于 `--` 之后成为 positional value，也可能只是另一个参数的值；这些情况都不得切换输出通道。

长驻命令即使位于统一全局参数面，也应明确拒绝不适用的单请求 `--timeout`，不能让用户把它误解成整个进程寿命；所有一次性 HTTP 请求则统一走带 abort/超时的客户端 helper，避免局部裸 `fetch` 绕开契约。

## Help 是公共契约

- 行为约束与 help 同轮更新：参数依赖/互斥、合法范围、自动默认值、改名迁移和 fallback 限制都必须能在发请求前被用户发现。
- 命令组 help 必须展示祖先 `Global Options`；叶子 help 保留本地可用参数，不能要求用户返回根 help 猜全局面。
- 破坏兼容的改名同时提供 help 迁移说明与缺参运行时提示。例如旧 `server add --base-url` 迁往 `--remote-url` 时，两条路径都应明确 `--base-url` 现在只选择当前网关。
- 聚合列表存在降级路径时，help 要声明能力差异。例如 Registry 不可见而退到 `~tree` 时无法分页，显式 `--limit/--cursor` 应拒绝而非静默忽略。
- Commander 的 `helpInformation()` 只返回主体，不包含 `addHelpText('before'/'after', ...)` 的追加内容。测试迁移提示、分页 note 等追加段时，必须配置输出并捕获 `outputHelp()`；主体 option 文案才可直接用 `helpInformation()`。

## 分页是知识边界

只要接口返回 `Page<T>`，CLI 同轮完成全部事项：

1. 暴露 `--limit` 和 `--cursor`，`limit` 本地限制为网关契约的 1..200。
2. 把分页参数放进接口要求的 `opts` 对象，不平铺到 arguments。
3. JSON 模式保留完整 page 形状；人类模式在存在 cursor 时打印下一页令牌。
4. 对 items 做 kind/prefix 等客户端过滤时仍保留服务端 cursor；“当前页无匹配”不能表达“全集为空”。
5. List 与 Search 都要审，不能只补列表。
6. 测试必须覆盖请求 cursor、响应 cursor 和越界 limit；有过滤的列表另测 cursor 不丢。
7. 存在不支持分页的 fallback 时，显式分页参数必须报错，help 同时声明该限制。

## 三入口能力矩阵

对等审计不要停在顶层命令或页面是否存在，按下面三维展开：

- **动词：** List/Get/Write/Update/Delete、Enable/Disable、Health/Search 等。
- **字段：** 每个 NodeConfig/ProviderConfig、权限、安全和并发字段。
- **分支：** builtin provider 与 tool-provider/context-provider plugin 等实现分支。

以 core store/builtin schema 和网关行为为真源，逐项核对 API ↔ CLI ↔ Dashboard。任何入口刻意不暴露能力，都要写明产品或安全理由；否则属于管理旁路或能力漂移。

## 最小验证矩阵

- 解析：未知 flag、缺值、多余 positional、参数化的根/组/叶子全局参数、JSON 解析错误，以及 `--` 后同名文本不触发 JSON 模式。
- Help：组级 Global Options、依赖/互斥/范围/默认值/迁移/fallback；`addHelpText` 内容用 `outputHelp()` 验证。
- 本地语义：每个互斥/依赖/条件分支均证明“报错且未发请求”。
- 传输：断言最终 URL、query、`{tool, arguments}` 和 `opts` 形状。
- 服务端安全：合法值规范化、非法 write/update 拒绝且旧值不变、历史脏值 fail closed。
- 分页：limit 边界、cursor 双向保留、过滤页和 search。
- 对等：新增动词/Provider 分支在 CLI 命令矩阵和 Dashboard 能力表中逐项核对。

相关代码检索入口见 [../architecture/code-map.md](../architecture/code-map.md)，已实现的命令与参数契约见 [../reference/protocol-contract.md](../reference/protocol-contract.md)。
