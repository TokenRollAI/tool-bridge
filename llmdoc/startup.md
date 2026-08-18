# llmdoc 启动顺序

每次进入仓库：

1. `pwd` 确认当前 worktree；所有路径以它为准。
2. 读 [must/project-brief.md](must/project-brief.md)。
3. 读 [must/current-state.md](must/current-state.md)。
4. 按 [index.md](index.md) 只加载与任务相关的架构、契约或 guide。
5. 用 `git status --short` 确认已有改动，用户文件一律保留。

## 升级提示

- 改接口、节点或 CLI：读 protocol、CLI guide；核对 API / CLI / Dashboard。
- 改 plugin：读 plugin runtime、security boundaries、plugin guide。
- 改 search：读 search architecture 与 verification guide。
- 改 Dashboard：读 dashboard architecture；涉及 wire 时再读 protocol。
- 改 gateway/Workers：读 deploy、KV、DO guide。
- 改 server/SDK/Docker：读 modules、docker guide。
- 改 public package：读 npm guide，并执行 build 闸门。

代码是行为真源。`.llmdoc-tmp/` 只是可丢弃的调查缓存；复用前要重新核对代码，不能从 stable docs 链接过去。
