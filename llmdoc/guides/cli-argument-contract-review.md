# CLI 参数契约检查

CLI 是公共控制面，不是 API 的宽松包装。修改命令时同时检查解析、客户端语义和服务端权限三层；任一层缺失都会产生旁路或误导性帮助。

## 参数原则

- 同名参数必须同义；不同语义使用不同名称。
- 全局参数在 root、group、leaf 三个位置都应可解析，不能依赖 Commander 的偶然继承行为。
- 未知参数、缺值和多余位置参数必须失败，退出码与 stderr 保持可脚本化。
- 互斥、依赖、默认值和枚举在解析层显式表达；不要把非法组合静默改写。
- 密钥只从专用 secret 流程进入，不保留隐藏的旧 flag，也不把明文带入普通资源命令。
- 删除资源只做命令名承诺的动作，并校验目标 kind：`integration rm` 只卸 tool/context 节点，打到 device 等其它 kind 即拒（走 `deleteNode(target, path, ['tool','context'])`）。集成卸载与密钥删除是两个显式操作。
- 破坏性命令（rm/unmount 及 `sk create` 空 scope）的二次确认只对交互式 TTY 且未给 `--yes` 生效；`--yes` 与非 TTY（管道 / CI / Agent `--json`）一律放行。确认是人类安全网，不改变脚本/Agent 既有行为，因此不破坏三入口对等；真正的护栏（如上面的 kind 校验、服务端权威校验）不能依赖它。共享 helper 在 `packages/cli/src/confirm.ts`。

## 三入口对等

新增或改变管理能力时，逐项核对：

| 面 | 要验证的内容 |
|---|---|
| 直接 API / HTBP | 权限、状态码、响应形状与错误码 |
| `tb` CLI | 参数可达、帮助文本、stdout/stderr、退出码 |
| Dashboard | 字段来源、校验、敏感值处理与成功后刷新 |

如果 Dashboard 或 API 能完成而 CLI 无法表达，就是管理旁路。若某能力有意只属于一个入口，应在契约中说明原因。

## 评审步骤

1. 从 `packages/cli/src/program.ts` 和对应 command 文件确认实际命令树。
2. 对照 builtin 的 `~help`/返回契约，不从旧示例反推参数。
3. 覆盖 root/group/leaf 参数位置、非法输入、权限不足和服务端失败。
4. 更新 `helpContract`、`strictParsing`、`argSemantics` 与业务命令测试。
5. 涉及 wire 字段时，同轮更新 core、app、CLI、Dashboard 和协议文档。

帮助文本只描述当前路径，不保留 migration 文案；项目尚未上线，旧命令应直接删除而不是长期隐藏。
