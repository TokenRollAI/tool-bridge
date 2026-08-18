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

## 提交纪律

- 先检查 `git status --short`，保留用户已有改动。
- 提交保持小而完整，信息解释为什么改及取舍。
- 多 agent 或批量作业期间不要中途提交，避免 pre-commit 对他人未完成文件做全仓 typecheck。
- 不提交 `.llmdoc-tmp/`、真实环境 ID、凭据或一次性测试输出。
- 稳定知识更新到对应 architecture/guide/reference；PR 过程和精确计数留在 Git/CI。

真实外部资源每轮最多验证一次。没有授权时以本地证据收敛并明确剩余风险，不能自行部署或发布。
