# 反思:轻量搜索索引与 MCP 发现面对等

## Task

- 复核 CLI、Dashboard 与 MCP 的 Search/List/Help/Call 能力，并补齐 MCP 的发现入口与大工具目录搜索。

## What Changed

- 在线 MCP 能列出飞书 8 个工具，但 `/~search` 始终为空。D1/KV 取证确认同步链存在，真正原因是 v2 把完整 `ToolSpec` 写入搜索行，单节点 20 KiB 投影预算会把长 description/schema 的整个节点排除。
- Search v3 只持久化 path、raw name、最多 1024 UTF-8 bytes 的 description 与 feedback；完整 `ToolSpec` 只参与快照 digest。候选通过权限、节点与虚拟化检查后，再从 HTTP config、device config 或批量 tool cache 水合完整结果。
- MCP 保留标准 `tools/list`/`tools/call`，新增稳定工具 `tb_search`、`tb_help`、`tb_list_nodes`。三者不复制权限逻辑，而是携带当前 Bearer 重新进入 `/~search`、`~help`、`~tree`。

## Durable Lessons

1. **召回文档不应兼任返回对象存储。** 搜索索引只需足够的检索字段和稳定 identity；把完整 schema/annotations 放进 FTS 行，会让无关的返回体大小反向决定可发现性。
2. **完整结果必须从 canonical state 水合。** 权限裁剪之后批量读取 registry/tool cache，既避免 provider fan-out，也保证 Search、Help、Call 看到同一份当前工具定义。索引漂移只能造成候选被丢弃，不能返回已删除或旧 schema。
3. **入口对等不等于协议方法同名。** MCP 没有 HTBP Search/Help/Tree 标准方法；稳定、只读的合成 tools 是兼容做法，但执行必须回到已有 HTBP PEP，不能新建旁路。
4. **派生 schema 升级应从 canonical 重建。** v2 的 full-row 数据不再适合作为 v3 真源；新 meta 初始 unseeded，首次 audit 从 registry/cache 重建，比复制旧行更可靠，也自然使旧 cursor 失效。
5. **验收必须同时覆盖召回和完整水合。** 本轮用 8 个长描述 MCP 工具在 D1/SQLite 证明可召回，并在真实 gateway wire 断言返回的 description 未被 1024-byte 索引摘要截断；单测截断 helper 不能替代这条全链证据。

## Evidence Boundary

- 本地 `pnpm verify` 为 package 1276 passed + provision 1 passed = 1277 passed / 7 skipped。官方 MCP SDK 测试覆盖三个合成工具、窄 SK Search/Help/List 裁剪、参数 schema 与原有 provider call。共享开发部署后,D1 v3 首次 audit 重建出 8 个飞书工具;API/CLI/Dashboard 均命中 `feishu:create-doc` 并返回完整 8790-byte description;官方 MCP SDK 在线 list 共 38 项且三个合成工具均真实 call 成功。该证据仍是共享开发环境,不是 production release。
