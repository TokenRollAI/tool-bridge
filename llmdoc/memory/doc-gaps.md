# doc-gaps:llmdoc 文档缺口追踪

> 用途:记录 llmdoc 中缺失或薄弱、应该后续补强的文档面。更新时机:发现缺口时追加;补齐后移入文末"已处理"区。recorder 维护。

## 当前缺口

- **Docker 宿主落地**:Docker 自部署路径实现时,需新增对应 guide(SQLite StateStore、FS ObjectStore、ws DeviceTransport 的装配与验收)并更新 modules-and-boundaries。
- **dashboard 开发流程**:dashboard 本地开发(vite dev + wrangler dev 联调)没有 guide;下次涉及 dashboard 改动时补。

## 历史说明

本文件在 bootstrap 期曾用于跟踪 `docs/` 规范文档的措辞缺口与矛盾核查(编号 G1-G6 与 C1-C7);该使命已随 docs/ 归档(`archive/docs/`)终结,历史记录见 git 历史与 `archive/`。当时沉淀的两条实现注意已并入 [../reference/protocol-contract.md](../reference/protocol-contract.md):Delete 动作归属随对象不同(数据模型节)、`presign?` 可选与 `/~ref` 网关中转兜底(端点面)。
