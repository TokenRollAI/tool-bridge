# DOD(Definition of Done)

> 勾选纪律:一项能被勾上,当且仅当有一条可重跑的命令、且它的输出证明了这一项。
> 不是"我觉得写完了"。规格真源见 VISION.md。

## 全局完成定义

整个项目 Done = 以下同时成立:
1. 每个 Phase 的 DoD 清单全部勾选,依据是可重跑命令。
2. 最后一个 Phase(Phase 5)的 E2E 全部通过(对应 VISION 每个 User Case A/B/E/C/D)。
3. 五个功能阶段各自一个 PR 合入 main;每阶段完成即部署上线并留生产证据。
4. 每阶段 `pnpm verify` 全绿(退出码 0)。

## 执行顺序

Phase 1(A 安全解冻)→ Phase 2(B Plugin SDK)→ Phase 3(E 对外 MCP 出口)→ Phase 4(C Search 0+1)→ Phase 5(E2E)。
Phase 间不可跳:B 改 ToolSpec 派生形态,C 索引 ToolSpec 必须在 B 后;E 只读现有 tool list 亦在 B 后;D(组件抽象收尾)并入 Phase 4 之后作为 Phase 4.5,其 E2E 归 Phase 5。

## Phase 1 — A:安全阻断项解冻

**目标**:清 4 个部署 blocker,恢复可部署;为 Phase 2 清 Secret Reference 授权地基。
**DoD**:
- [x] Secret Reference 使用授权:`~register` 与 `system/registry` write/update 两条通道都校验写入者对 NodeConfig 中 `skRef/authRef` 的使用权;resolve 不到 Secret 时 fail closed(去掉静默匿名降级)。验证:`pnpm --filter @tool-bridge/core test` + `pnpm --filter @tool-bridge/gateway test` 中新增用例(受限注册者写越权引用被拒、resolve 失败 fail closed)全绿。
- [x] DO/Node 连接替换 TOCTOU:invoke 跨 await 后复核活动连接,并校验 scope/registerPaths 收紧,堵住旧连接接收调用与 DO 陈旧 meta 覆盖新连接两个竞态。验证:`pnpm --filter @tool-bridge/gateway test` + `pnpm --filter @tool-bridge/server test` 新增竞态回归用例全绿。
- [x] Node/Docker bootstrap fail closed:缺 `TB_BOOTSTRAP_ADMIN_SK` 时进程拒绝启动、退出非 0,不随机生成写 stdout。验证:`TB_BOOTSTRAP_ADMIN_SK= pnpm --filter @tool-bridge/server start` 退出码非 0 且 stdout 无 SK 明文(可脚本断言);新增单测钉死。
- [x] canonical origin 对等:非法配置不静默回退,Node/SDK 与 Workers 行为对齐。验证:`pnpm --filter @tool-bridge/gateway test` + server 侧对等用例全绿。
- [x] 全阶段回归绿:`pnpm verify` 退出码 0。
- [ ] 部署解冻:从干净工作区 `pnpm deploy:all`,再 `TB_BASE_URL=https://tool-bridge.pdjjq.org TB_SK=<admin> pnpm smoke` 通过。

## Phase 2 — B:Plugin SDK / OperationRegistry 地基(breaking 一步到位)

**目标**:底层统一 Zod 驱动 OperationRegistry;Plugin v2 多 export;新发 `@tool-bridge/plugin-sdk`;飞书 plugin 重写验证;收敛 TB/宿主装配面。删所有兼容层。
**DoD**:
- [x] OperationRegistry 落地:core 统一 Zod 驱动 registry,SDK 自动完成 z.infer 参数推导 / safeParse / ZodError→invalid_argument / Zod→JSON Schema / List·Get·Call / 裸返回值包装。验证:`pnpm --filter @tool-bridge/core test` 覆盖 registry 与派生全绿。
- [x] Plugin v2 多 export:`kind` 从 manifest 移出,`/~describe` 返回 exports 数组(profile tools/v1 或 context/v1),挂载配置加 `export` 字段;一个 plugin 能同时导出 tools 和 context。验证:`pnpm --filter @tool-bridge/gateway test` 中多 export 描述/挂载/调用用例全绿。
- [x] Context 按 handler 推导能力:handler 全可选,存在性推导 methods/capabilities,无 write/update/delete 自动只读;修掉 Watch 假能力与 connect() 上报丢失 virtualize/readOnly/capabilities。验证:core + gateway 相关用例全绿(含 connect 语义保真回归)。
- [x] `@tool-bridge/plugin-sdk` 可发布:Web 标准兼容(不引 Node 运行时依赖污染 Worker),接管 v1/v2 envelope / auth / dedupe / health / describe / help / Zod 校验 / JSON Schema / 错误归一。验证:`pnpm --filter @tool-bridge/plugin-sdk build && npm pack --dry-run` 在该包通过;新增该包单测全绿。
- [x] 样例 plugin 双 export 零样板:一个用新 SDK 写的 plugin 同时注册 tools 与 context、不写任何 JSON Schema 与协议样板。验证:该样例的集成测试(注册→describe 两 export→调用工具→读 context)全绿。
- [x] 删净 legacy 面:代码中不再有 legacy provider API / ToolProvider.Get / 强制四方法接口。验证:`grep -rn "ToolProvider" packages/*/src` 无强制 Get 契约残留(或有断言测试);`pnpm verify` 全绿。
- [ ] 飞书 plugin 重写复验:飞书 plugin 用新 SDK 重写、重新部署,生产 create-doc/fetch-doc/update-doc 全链路通过。验证:`npx tsx scripts/verify-plugin.ts`(TB_BASE_URL+TB_SK)+ 飞书三动词生产实调各一次留证。
- [ ] 部署上线:`pnpm deploy:all` + `pnpm smoke` 通过。

## Phase 3 — E:对外 MCP 出口(flat 全暴露)

**目标**:gateway 加 MCP server 端点,整棵树按 SK scope 裁剪后 flat 暴露为 MCP tools。
**DoD**:
- [x] 测试 MCP client 就位(解 blocker E-1):用官方 @modelcontextprotocol/sdk 写一个测试 client。验证:该 client 能连本地 gateway MCP endpoint 完成一次 initialize 握手。
- [x] MCP server 端点:gateway 暴露 MCP endpoint,复用现有树调用分发 + Authorizer.Check;`tools/list` 返回按连接 SK scope 裁剪的工具(无权节点不出现),`tools/call` 转发到现有调用路径。验证:`pnpm --filter @tool-bridge/gateway test` 中 MCP 出口集成测试(list 裁剪 + call 成功)全绿。
- [x] scope 收窄钉死:换窄 scope SK 后 tools/list 相应收窄、越权工具不可见不可调。验证:gateway 集成测试中窄 scope 用例断言工具集差异。
- [x] 三入口对等审计:MCP 出口不制造管理旁路(它是消费面非管理面,确认 CLI/Dashboard 无需新增管理动作,或若需开关则同轮补)。验证:能力矩阵审计记入 PROGRESS。
- [ ] 全阶段回归 + 部署:`pnpm verify` 全绿;`pnpm deploy:all` + 生产 smoke 覆盖 MCP endpoint(测试 client 连生产 tools/list + tools/call)。

## Phase 4 — C:Search 0+1

**目标**:协议 `~search` 保留段 + FTS5/trigram 索引 + 第五个宿主注入点 SearchIndex + 三入口对等。
**DoD**:
- [ ] D1 绑定与 provision(解 blocker C-1):`packages/gateway/wrangler.jsonc` 加 `d1_databases`;`scripts/provision.mjs` 按 TB_KV 那套(list→存在则 skip→create→重新 list 取 id→正则回填 wrangler.jsonc)补 D1 幂等分支。验证:干净路径 `node scripts/provision.mjs` 幂等(二次运行不重建)且 `pnpm deploy:all` 不断链。
- [ ] `~search` 协议保留段:进 protocol-contract 契约 + HTBP Draft 同步;`~describe` 声明 search 能力;`mode` 沿用 keyword|semantic(未声明 capability 的 mode 回 invalid_argument)。验证:`pnpm --filter @tool-bridge/gateway test` 中 `~search` 契约用例 + 未声明 capability 拒绝用例全绿。
- [x] 第五个宿主注入点 SearchIndex:CF=D1,Node=better-sqlite3(同库不同表);FTS5 + trigram tokenizer。验证:core 接口单测 + gateway(miniflare 本地 D1)与 server(sqlite)双侧集成测试全绿。
- [x] trigram 短查询 LIKE 兜底:任一 whitespace term 短于 3 个 Unicode code points 时全部 terms 走 escaped LIKE 子串扫描并按 AND 组合,中文两字词(如"日程")命中不返回空。验证:双侧集成测试中"日程"/"日历"命中断言 + trigram 3+ 字符命中断言全绿。
- [ ] 索引内容与加权:索引 tool name/description + `~feedback` title/detail,加权 name>description>feedback;索引原始 ToolSpec,虚拟化/可见性/Authorizer.Check 放返回前后处理管道,over-fetch 填页,cursor 语义进契约。验证:集成测试断言加权顺序 + scope 裁剪 + cursor 分页边界。
- [ ] 三入口对等:`tb search` + Dashboard 搜索面。验证:`pnpm --filter @tool-bridge/cli test` 中 `tb search` 用例 + gateway `ui.integration.test.ts` 搜索面用例全绿。
- [ ] 全阶段回归 + 部署:`pnpm verify` 全绿;`pnpm deploy:all` + 生产 `~search` smoke(中文两字词 + 英文词各一次)。

## Phase 4.5 — D:组件抽象收尾

**目标**:Dashboard 大页拆分(层 2)+ Docker Compose 本地开发栈(层 3)。
**DoD**:
- [ ] Dashboard 大页拆分:Registry/Plugins/SK 页拆出独立纯 config builder / kind 子表单 / 共用 section,表单行为与 CLI/builtin 对齐。验证:`pnpm --filter @tool-bridge/dashboard test` + gateway `ui.integration.test.ts` 全绿;`pnpm verify` 退出码 0。
- [ ] Docker Compose 本地开发栈:`docker-compose.yml` 一键起 gateway + 一个 plugin worker + mock 上游;生产单容器形态不动。验证:`docker compose up -d` 后端到端 smoke(注册 plugin→挂载→调用)通过,`docker compose down` 清理。
- [ ] 全阶段回归:`pnpm verify` 全绿。

## Phase 5 — E2E 验收

> 每条 E2E 对应 VISION 的一个 User Case,脚本化、可重跑。用复选框承载状态,遵守顶部的勾选纪律。

- [ ] **E2E-A**(Case A:解冻 + 越权引用拒绝):`pnpm verify` 全绿含竞态/fail-closed 回归;窄 register scope SK 经 `~register` 写越权 skRef 被拒(用例证据);`TB_BOOTSTRAP_ADMIN_SK= pnpm --filter @tool-bridge/server start` 退出非 0 且无 SK 明文;干净工作区 `pnpm deploy:all` + `pnpm smoke` 通过。
- [ ] **E2E-B**(Case B:新 SDK 双 export 零样板 + 飞书复验):样例 plugin 集成测试(describe 两 export→调工具→读 context)通过;`npm pack --dry-run` 在 plugin-sdk 包通过;飞书 plugin 重写后 `npx tsx scripts/verify-plugin.ts` + 生产 create-doc/fetch-doc/update-doc 各一次通过。
- [ ] **E2E-E**(Case E:存量 MCP 客户端接入):测试 MCP client 连生产 MCP endpoint,`tools/list` 按 SK scope 裁剪、`tools/call` 真实成功;换窄 scope SK 重连工具集收窄(命令 + 输出留证)。
- [ ] **E2E-C**(Case C:按意图搜工具 + 中文两字词 + 权限裁剪 + 双侧对等):`tb search "日程"` 与 `tb search "create document"` 均命中不空;窄 scope SK 搜结果只含可见节点;CF 生产 `~search` 与 Node 宿主 `~search` 同 query 行为对等;Dashboard 搜索面返回同样结果。
- [ ] **E2E-D**(Case D:本地一键栈 + Dashboard 可维护):`docker compose up` 起完整栈端到端 smoke 通过;Dashboard 拆分后 `pnpm verify` 全绿 + 真实浏览器四面证据(桌面/移动路由、树请求边界、键盘导航、无 console error/warning)通过。
