# 全局工具搜索

## 数据流

```text
registry / provider help
        ↓ canonical audit
派生 SearchIndex（D1 或 SQLite）
        ↓ 轻量候选
按请求身份重新读取权威节点并 hydrate
        ↓
权限、可见性、virtualize 后的 ToolSpec
```

SearchIndex 不是权限真源，也不保存可直接返回的完整权威结果。索引记录只含 path、name、可搜索文本、digest/revision 等轻量材料；每次响应仍从 canonical state 复核节点、工具与权限。

## 能力边界

- adapter 通过 `capabilities` 声明 `search` / `search:semantic`；未声明的模式在协议层不可发现且运行时拒绝。
- D1 与 SQLite 共享 core SQL/游标契约；宿主只负责数据库原语。
- 默认/上限分页与 root `~search` 的 Page 语义一致。
- 短 query 不适合 FTS tokenizer 时可退回安全的 LIKE 路径；不是另建一套搜索语义。
- cursor 与 query/mode 绑定，重复、陈旧或越界 cursor fail closed。

## 派生状态恢复

- registry/provider 变化触发增量重建或 canonical audit。
- 索引失败不能破坏工具调用权威路径；最后已知可用索引可继续服务，但 hydrate 仍会排除已删除/无权节点。
- 删除 source-only 或陈旧记录靠当前 schema/rebuild 逻辑，不在长期文档保留旧表升级故事。

## 对等验收

直接 API、CLI 与 Dashboard 必须使用同一 query、mode、cursor 语义。窄 SK 验收至少证明：结果非空、属于 admin 集合、严格收窄，并全部落在允许的完整路径段前缀内。可重跑流程见 verification guide 与 `scripts/verify-search.ts`。
