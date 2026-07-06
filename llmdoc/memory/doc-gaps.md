# doc-gaps:docs 待修项与调查未覆盖面

> 用途:记录 docs/ 规范中已核实的待修措辞、实现时注意项、以及 llmdoc 调查尚未覆盖的盲区。更新时机:docs 修订落地后将对应项移入文末"已处理"区;新发现缺口时追加。依据:2026-07-06 两轮交叉核对(C1–C7 复核)。

## 需改 docs(当前无待修项)

原 G1/G2 已修复,记录见文末"已处理"区。

## docs 未定义、实现时定义后须回写(1 条)

### G3 平台自身 `/healthz` 响应结构未定义 — Phase 0 即触发

Proto 中 healthz 仅是 Plugin 的健康端点(`{"healthy":true}`,Proto.md:584);平台网关自身 `/healthz` 的唯一硬约束来自 DOD.md:40(200 + 版本号)+ DOD.md:41(`tb status --json` 可解析)。建议 `{"healthy":true,"version":"<x.y.z>"}`;Phase 0 实现定型后按 DOD.md:25 回写 docs。

## 实现时注意、无需改 docs(2 条)

### G4(原 C2)`Delete` 动作归属随对象不同

规范自洽但易混:context 条目删除 = `write` 动作(Proto.md:183)、节点卸载 `NodeRegistry.Delete` = `register` 动作(Proto.md:320)、Provider 层 `Delete` = capability 声明项(Proto.md:389)。实现权限判定处应加注释锚定 Proto §2.2:181–187 的动作枚举。

### G5(原 C7)`ObjectStore.presign?` 可选 vs `$ref` 强依赖

大对象返回 `{$ref:<预签名URL>}`(Proto.md:408)而 `presign` 可选(Proto.md:536);退化契约**已在 docs/Reference.md:86 定案**——所有无 presign 的 ObjectStore 统一走网关中转下载路由。实现时把兜底做成 ObjectStore 层通用逻辑,而非 r2 专属。可选优化:Proto §7 `presign?` 处加一行回指 §5.2/Reference §6(非必需)。

## 已核实无需改(3 条,勿再当矛盾追)

- **(原 C4)markdown 内容类型**:Proto §1.2:110–114 与 Architecture.md:71 已自洽(`text/markdown` IANA 注册,`~help` 默认 `text/plain`);引用 Architecture 顶层句时带上括号说明即可。
- **(原 C5)`Search(keyword)` 基线 vs 可选**:用词精确——对内置 r2/s3/file 是义务(均声明 `search` capability),对第三方 Plugin 是可选(Proto.md:387/427,Plugin.md:54 佐证)。
- **(原 C6)超时值分歧**:Device 60s(Proto.md:477)/ Plugin 30s(Proto.md:608)/ Workers CPU 30s(Reference.md:52)对象不同,非矛盾;实现分别命名常量。

## 调查未覆盖面(后续按需补)

- **Proto.md 深读覆盖**:两轮调查已覆盖全部章节地图、附A、§1.3 Help DSL、§0.2 TBError;各接口的完整 TS 签名仍以原文为准,引用前按 [../reference/proto-map.md](../reference/proto-map.md) 行号翻原文核对。
- **待复核项(docs 自标注)**:partysocket 的 Node 兼容性(Reference.md:72,Phase 4 前);React 19 + antd v5 + @rjsf/antd spike 与 Static Assets 路由次序(DOD.md:115,Phase 6 前);上游 MCP OAuth 2.1(Reference.md:46,排期未定);wrangler OAuth 的 R2 write 权限(见 [../must/current-state.md](../must/current-state.md))。

## 已处理(保留记录)

### G1(原 C1)`DeviceChannel` 命名与 Proto 不一致 — 已修复(commit 0d48b06,2026-07-06)

原问题:Architecture.md:157 把 `DeviceChannel` 当 M4 必要接口列出,但 Proto §6/§7 无此名(实际是 `DeviceTransport` Proto.md:538 + `DeviceConn` Proto.md:541,帧类型 `DeviceFrame` Proto.md:449)。修复:Architecture.md:157 改为 "`DeviceTransport` / `DeviceConn` — 承载 WS 帧协议 `DeviceFrame`……本文早前以 `DeviceChannel` 泛指该 WS 帧通道抽象";Architecture.md:27 的枚举保留口语化名并加括注 "(= Proto 的 DeviceTransport/DeviceConn)"。实现命名一律以 Proto 为准。

### G2(原 C3)"必须实现且只必须实现四个接口"措辞歧义 — 已修复(commit 0d48b06,2026-07-06)

原问题:Proto.md:371 "必须实现且只必须实现以下四个接口" 与紧随的 `ContextProviderOptional`(Proto.md:385–390)字面冲突。修复:改为 "**每个 Context Provider 必须实现以下四个核心接口(可选能力见其后 `ContextProviderOptional`,须在 `~describe` 的 capabilities 中声明)**"。

### G6 v1 文件级检索地图缺失 — 已解决(2026-07-06)

init 阶段 v1 调查报告一度从磁盘消失导致误判"未产出";已由调查者重写(`.llmdoc-tmp/investigations/v1-reference-map.md`),内容(四个子系统的文件路径+机制+踩坑结论)已内化进 [../reference/v1-lessons.md](../reference/v1-lessons.md)。
