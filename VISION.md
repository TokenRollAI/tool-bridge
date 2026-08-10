# Vision

> tool-bridge 从"能跑通的 v1"走向"别人愿意接入"的一轮架构演进:先清掉挡部署的安全阻断项,再把 Plugin/SDK 地基重铸干净,加一个对外 MCP 出口让存量 Agent 客户端零门槛接入,补上按意图搜工具,最后收敛组件抽象与本地开发栈。面向的是 tool-bridge 的维护者与未来的接入者(Plugin 开发者、Agent 客户端用户、自部署者)。

## 要解决的问题

1. **上不了线**:当前分支有 4 个安全阻断项(Secret Reference 授权缺失、DO/Node 连接替换 TOCTOU、Node bootstrap 不 fail closed、canonical origin 不对等),整棵树只适合 Draft、不得部署。所有新功能都被这道墙挡在生产之外。
2. **Plugin/SDK 开发样板过多、地基有历史债**:一个 Plugin 只能有一个隐式 export(不能同时导出 tools 和 context);SDK 强制开发者实现 `List/Get/Call` 与 Context 四方法(纯样板);ToolProvider.Get 是协议泄漏;Context 能力写死而非按 handler 推导;`connect()` 上报丢失 virtualize/readOnly/capabilities 语义;飞书 plugin 手写了 health/describe/help/envelope/auth/dedupe/JSON Schema 等本应属于 SDK 的东西。
3. **几乎没人用,缺接入杠杆**:tool-bridge 对外是 HTBP,而存量 Agent 客户端(Claude Desktop、Cursor)只会 MCP。没有一个对外 MCP 出口,别人就得先支持 HTBP 才能消费这棵树——这是采用门槛。
4. **树一大就搜不到工具**:现有 Search 只有 `tb ctx search`/`tb skill search`(内容型),没有跨节点的按意图搜工具;`~tree` 只能结构化下钻,树一大渐进发现的 token 优势被路径深度吃掉。
5. **开发体验与组件边界待收敛**:本地起一套完整开发栈(网关 + plugin + mock 上游)没有一键路径;Dashboard 的 Registry/Plugins/SK 大页把 config builder、kind 子表单、视图混在一起,难维护。

## 要做什么

五个有序阶段,逐阶段 PR、A 解冻后增量上线(每阶段完成即部署)。核心前提:**项目未发布、几乎无人用 → 无兼容负担 → breaking 改动一步到位,不付"保留旧接口"的成本**。

- **阶段 A — 安全阻断项解冻**:清 4 个部署 blocker,恢复可部署。其一(Secret Reference 授权)落在 Provider/注册边界,为阶段 B 清地基。
- **阶段 B — Plugin SDK / OperationRegistry 地基**(breaking 一步到位):底层统一 Zod 驱动的 OperationRegistry;Plugin v2 多 export(kind 移出 manifest,`/~describe` 返回 exports,profile 区分 tools/context);Context 按 handler 推导能力;新发 `@tool-bridge/plugin-sdk`(Web 标准兼容);飞书 plugin 用新 SDK 重写验证;顺带收敛 TB/宿主装配面(方向 3 层 1)。删掉 legacy provider API / v1 adapter / 强制四方法 / ToolProvider.Get。
- **阶段 E — 对外 MCP 出口**:gateway 加一个 MCP server 端点,把整棵树按 SK scope 裁剪后 flat 暴露为 MCP tools;存量 Claude Desktop/Cursor 配 endpoint + SK 即用。不依赖 Search,紧跟 B。
- **阶段 C — Search 0+1**:协议 `~search` 保留段进契约;第五个宿主注入点 SearchIndex(CF=D1,Node=better-sqlite3);FTS5 + trigram + 短查询 LIKE 兜底;索引 tool name/description + `~feedback`(加权 name>description>feedback);索引原始 ToolSpec,虚拟化/可见性/Authorizer.Check 放返回前后处理;三入口对等(`tb search` + Dashboard 搜索面)。
- **阶段 D — 组件抽象收尾**:Dashboard 大页拆纯 config builder / kind 子表单 / 共用 section(层 2);Docker Compose 本地开发栈(层 3),生产仍单容器不动。

边界示意(阶段与依赖):

```
A(解冻,清 Secret Ref 授权地基)
└─> B(Plugin SDK / OperationRegistry,改 ToolSpec 派生形态)
    ├─> E(对外 MCP 出口,只读现有 tool list,flat 暴露)
    └─> C(Search,索引 ToolSpec)
        └─> D(Dashboard 拆分 + Compose,依赖 B/C 接口定稿)
```

## 非目标

- **不做 rate limit / HttpOnly session + CSRF + BFF**:是安全增强,非部署 blocker,记路线图,不占本轮。
- **不做 Search 正则(阶段 2)与语义检索(阶段 3)**:先上基础搜索拿反馈,记路线图未排期。
- **MCP 出口不做 meta-tool 式(SEARCH_TOOLS)**:那是树大了才需要、且依赖 Search 的解法;本轮只做 flat 全暴露。
- **不做 Agent Runtime / 事件总线(triggers)/ 模型托管计量 / 预授权 SaaS 目录 / 多云抽象**:延续 project-brief 既定非目标(前四项属 Watt 或与产品主张冲突,多云初期仅 CF+Docker)。
- **通用化托管 OAuth 不在本轮**:review 标"值得做"但用户本轮未纳入,记路线图。
- **生产 Docker 形态不动**:单容器已自洽,Compose 只用于本地开发栈。

## 成功标准

每条都可被一条命令或一个 User Case 检验:

1. **A**:`pnpm verify` 全绿且新增 TOCTOU 竞态回归 + fail-closed 用例通过;受限注册者无法写入引用不属于自己的 `skRef/authRef`(有钉死用例);Node/Docker 缺 `TB_BOOTSTRAP_ADMIN_SK` 时进程拒绝启动(退出非 0);清完后生产 `pnpm smoke` 通过、部署解冻。
2. **B**:`@tool-bridge/plugin-sdk` 可发布(`npm pack --dry-run` 通过);一个用新 SDK 写的 plugin 能同时导出 tools 和 context、开发者不写任何 JSON Schema 与协议样板;飞书 plugin 经新 SDK 重写后生产全链路(create-doc/fetch-doc/update-doc)复验通过;`pnpm verify` 全绿;代码中不再存在 legacy provider API / ToolProvider.Get / 强制四方法。
3. **E**:一个 MCP client(可用官方 SDK 写的测试 client 或 Cursor)配 tool-bridge MCP endpoint + SK 后,`tools/list` 返回按该 SK scope 裁剪的工具、`tools/call` 能真实调用成功;换一个窄 scope SK 看到的工具集相应收窄(有钉死用例);生产 smoke 覆盖该端点。
4. **C**:`tb search <中文两字词>`(如"日程")与英文词都能命中(短查询走 LIKE 兜底,不返回空);搜索结果按 SK scope 裁剪(无权节点不出现);CF 侧 D1 与 Node 侧 sqlite 两条路径行为对等(各有集成测试);Dashboard 有搜索面;干净账户 `pnpm deploy:all` 不因缺 D1 绑定断链。
5. **D**:`docker compose up` 一键起 gateway + 一个 plugin worker + mock 上游,端到端 smoke 通过;Dashboard Registry/Plugins/SK 页拆出独立 config builder / kind 子表单 / 共用 section 后 `pnpm verify` 全绿且真实浏览器四面证据通过。
6. **全局**:五阶段各自一个 PR 合入 main;每阶段完成即部署上线并留生产证据;`pnpm verify` 每阶段全绿。

## User Case(验收基准)

### Case A:管理员解冻部署,受限注册者拿不到越权凭证引用

1. 开发者清完 4 个安全阻断项,跑 `pnpm verify` —— 全绿含新增竞态/fail-closed 回归。
2. 一个只有某子路径 register 权、无 admin 的 SK,尝试经 `~register` 写入一个引用了他无权使用的 `skRef` 的节点 —— 被拒(fail closed),有测试证据。
3. Node 宿主不设 `TB_BOOTSTRAP_ADMIN_SK` 启动 —— 进程拒绝启动、退出非 0,不打印随机 Admin SK。
4. 从干净工作区 `pnpm deploy:all` 部署,`TB_BASE_URL=… pnpm smoke` —— 通过,生产解冻。

### Case B:Plugin 开发者用新 SDK 一次导出 tools + context,零协议样板

1. 开发者 `npm i @tool-bridge/plugin-sdk`,用 `createPlugin` + `plugin.tools(...).registerTool(name, { inputSchema: z.object({...}) }, handler)` 注册工具,再 `plugin.context("documents", { get, list, search })` 注册上下文。
2. 开发者不写任何 health/describe/help/envelope/auth/dedupe/JSON Schema —— SDK 全接管。
3. 部署该 plugin,`tb plugin register` + 挂载 —— `/~describe` 返回两个 export(profile tools/context),`tb help <节点>` 列出工具、context 节点按真实 handler 推导只读/可写。
4. 飞书 plugin 经新 SDK 重写、重新部署 —— 生产 create-doc/fetch-doc/update-doc 全链路复验通过。

### Case E:存量 MCP 客户端零门槛接入 tool-bridge 树

1. 用户在 MCP client(测试 client / Cursor)配 tool-bridge 的 MCP endpoint + 一个 SK。
2. client 发 `tools/list` —— 得到按该 SK scope 裁剪的工具集(无权节点不出现)。
3. client 发 `tools/call` 调其中一个工具 —— 真实调用成功、拿到结果。
4. 换一个更窄 scope 的 SK 重连 —— 工具集相应收窄,越权工具不可见不可调。

### Case C:按意图搜工具,中文两字词也命中,结果按权限裁剪

1. 用户/Agent 跑 `tb search "日程"`(中文两字词)—— 命中相关工具(短查询走 LIKE 兜底,不静默返回空)。
2. 跑 `tb search "create document"`(英文)—— 命中,name 权重高于 description 高于 feedback。
3. 用一个窄 scope SK 搜 —— 结果只含该 scope 可见节点。
4. CF 生产 `~search` 与 Node 宿主 `~search` 同一 query —— 行为对等;Dashboard 搜索面返回同样结果。

### Case D:本地一键起完整开发栈,Dashboard 大页可维护

1. 开发者 `docker compose up` —— gateway + 一个 plugin worker + mock 上游同时起来,端到端 smoke(注册 plugin → 挂载 → 调用)通过。
2. 开发者打开 Dashboard 的 Registry 页挂载一个节点 —— config builder / kind 子表单是独立组件,表单行为与 CLI/builtin 对齐。
3. `pnpm verify` 全绿 + Dashboard 真实浏览器四面证据(桌面/移动路由、树请求边界、键盘导航、无 console error)通过。
