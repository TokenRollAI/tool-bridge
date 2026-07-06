# v1 参考实现要点

> 用途:LOOP §2.1 "v1 参考通道"的入口——涉及 v1 已解决问题时,先看本文确认可复用资产与检索入口,再去 v1 仓库读对应实现。更新时机:每次实际检索 v1 仓库后,把文件路径与踩坑结论回填到本文。

## v1 是什么(docs/Reference.md:24-25)

- 仓库:`github.com/TokenRollAI/tool-bridge`(**私有**;本机 gh 已登录 Disdjj,repo scope 可访问);线上 `tool-bridge.fantacy.live`。
- 形态:Cloudflare Workers(wrangler 4.x + nodejs_compat)+ TypeScript + React 19;**adapter 代码位于 `src/worker/tb/`**;测试用 Vitest。

## v1 参考通道的触发条件(LOOP.md:45-47)

涉及以下 v1 已解决问题时,**先读 v1 对应实现再动手**,复用踩坑结论,不照搬结构:

1. **mcp 会话管理**(`Mcp-Session-Id` 回传、404 重建重试)→ Phase 2。
2. **虚拟化映射**(namespace/rename/hide/描述覆盖)→ Phase 2。
3. **KV 多租户**(Bearer→sha256→KV 查租户)→ Phase 1 SK 哈希表同构。
4. **tree 环检测**(递归爬树)→ Phase 1 `~tree` / Phase 2 remote 联邦。

## v1 已验证的设计资产(重写保留,docs/Reference.md:27-33)

| 资产 | 机制 | 重写落点 |
|---|---|---|
| 五种节点类型 | `directory` / `mcp`(Streamable HTTP 叶子,内嵌全部工具 schema)/ `http` / `remote`(联邦,白名单)/ `mount`(R2 前缀树只读子树) | 扩展为 7 种 kind(Proto.md:263,新增 builtin/context/device,mount 演进为 context) |
| 工具虚拟化 | namespace 前缀、rename、hide、description override,对外只暴露虚拟名 | Proto.md:271 `Virtualize` |
| 多租户 | Bearer token 作 SK,sha256 哈希后 KV 查租户,加载租户专属树 | Phase 1 SK 哈希表(Architecture.md:176) |
| Crawler | `GET /api/tree` 递归爬树:环检测、深度 ≤8、节点 ≤200、remote 白名单 | `/~tree` 的前身(Proto §1.1) |
| StorageProvider 接口 | 抽象存储后端(R2,S3 兼容可扩展) | 演进为 StateStore/ObjectStore 注入点(Proto §7) |

## v1 的缺口 = 本次重写动机(docs/Reference.md:35)

1. Context Layer 四动词读写面(v1 的 mount **只读**)。
2. Device 反向注册(WebSocket)。
3. SK 作用域细粒度(v1 是租户级整树隔离,无 path×action)。
4. SDK/Plugin 一等支持。
5. Docker 自部署。
6. 内容协商(markdown 默认)。

实现这六项时 v1 没有可参考实现,以 docs/Proto.md 为唯一依据。

## 检索现状(待回填)

v1 仓库的**文件级检索地图尚未产出**(init 阶段的 v1 调查未完成,见 [../memory/doc-gaps.md](../memory/doc-gaps.md) G6)。目前仅知 adapter 入口 `src/worker/tb/`。首次触发参考通道时,派 `llmdoc:investigator` 用 `gh` 检索对应子系统(四个触发点各一次即可),把"文件路径 + 机制概括 + 踩坑结论"回填本节。
