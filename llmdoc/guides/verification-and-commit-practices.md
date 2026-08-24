# 验证与提交

验收以可重跑命令为准，状态描述不能替代测试输出。

## 基线

```bash
pnpm verify
```

它执行 typecheck、lint 和 test，但不执行 build。只要修改公开包、打包配置、依赖或生成产物入口，还必须运行：

```bash
pnpm turbo run build
```

优先从改动附近的定向测试开始，最后执行全仓闸门。失败就报告失败；跳过真实外部验证时说明未验证的边界。

搜索候选、查询单元或 schema 变化必须让 D1、better-sqlite3、PostgreSQL 共跑 `verifySearchIndexContract`；PG 组虽然由 `TB_TEST_DATABASE_URL` 门控，完整验收不得 skip。新增测试全局类型、core 导出或跨包类型依赖时，定向 Vitest 之后先跑受影响包 typecheck，再进入全仓 `verify`；运行时测试通过不能替代 TypeScript 编译证据。

多 agent 共用同一 worktree 时，指定单一验证 owner，按“定向测试 → `pnpm verify` → 必需的 `pnpm turbo run build`”串行执行。其他 agent 不并发运行会重建 workspace 依赖链接的 pnpm 命令，避免共享 `node_modules` 软链接竞争产生无法归因的瞬时缺模块失败。

## 证据放置

| 变化 | 最小证据 |
|---|---|
| 纯 core 规则 | 单测 + typecheck + lint |
| app/宿主中立行为 | app 集成；Cloudflare/Node 适配各自薄层测试 |
| wire/管理面 | core + app + CLI + Dashboard 对等测试 |
| public package | 全仓 verify + 全仓 build + 产物入口检查 |
| Workers/DO 特性 | Miniflare 测试；必要时一次真实环境验证 |
| 外部上游 | stub 合约测试；获授权后一次真实调用 |

搜索等派生状态要分别验证写入、删除、失败保留 last-known-good 和读路径不修写。安全变化要覆盖 allow、deny、不可见 404 与日志无敏感值。

## wire 变更闭环

命令寻址或请求体变化不能只测“手写正确 URL 能调用”。至少为每个受影响的 kind 跑通同一条发现驱动闭环：

1. 请求 owner 的 JSON `~help`，精确断言目标 `cmds[].path` 等于带命令叶子的完整路径。
2. 不重建 URL，直接用返回的 `cmd.path` 和裸 arguments body 发起 POST，断言请求形状与响应。
3. 直接用同一个 `cmd.path` 请求命令级 `~help`，确认发现、帮助与执行指向同一命令身份。
4. 真实发送旧形态 `POST /<owner>` + `{tool,arguments}`，断言被拒绝(当前为 404）；标题、注释或只测新请求不能替代此负向证据。

路径和 body 使用精确结构断言；模糊子串、从测试 fixture 手写正确叶子路径，或分别验证 help 与 invoke 都不能证明闭环。公开 HTBP 的直连 wire 与 plugin/v2 固定 endpoint 的内部 `{tool,arguments}` 信封要分层测试，避免机械删除合法适配协议。

wire 迁移还必须审计仓库中的 smoke、验证脚本、示例与运维 helper，不能只查主请求处理器。优先把 URL/body 构造抽成可离线断言的纯函数，或让本地 stub smoke 进入常规闸门；真实外部资源验证只能补充证据，不能成为发现旧 wire 漂移的唯一办法。

## 提交纪律

- 先检查 `git status --short`，保留用户已有改动。
- 提交保持小而完整，信息解释为什么改及取舍。
- 多 agent 或批量作业期间不要中途提交，避免 pre-commit 对他人未完成文件做全仓 typecheck。
- 不提交 `.llmdoc-tmp/`、真实环境 ID、凭据或一次性测试输出。
- 稳定知识更新到对应 architecture/guide/reference；PR 过程和精确计数留在 Git/CI。

真实外部资源每轮最多验证一次。没有授权时以本地证据收敛并明确剩余风险，不能自行部署或发布。
