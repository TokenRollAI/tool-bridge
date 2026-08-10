# DECISIONS(grill 共识落盘)

> 用途:motocortex `/grill` 阶段与用户澄清后的共识,供 `/frame` 写 VISION/DOR 依赖,不依赖会话记忆。
> 日期:2026-08-10。项目:tool-bridge。分支:architecture-planning-pre。

## 背景 goal

把"接下来最想做的三件事"变成一套可由 agent 自主执行的开发引擎。原始三件事:
1. Search(按意图搜工具)
2. Plugin SDK / TB SDK
3. 更好的组件抽象 + 本地 Docker / Docker Compose 支持

关键前提:**项目还没对外发布,几乎没有人在使用**。这是整个规划最大的杠杆——没有兼容负担,breaking 改动应一步到位,不付"保留旧接口"的成本。

## 已定型(现有栈 / 约定,一句话确认即可)

- **选型表已成熟,无更好替代**:Hono(CF+Node 同 app)/ @modelcontextprotocol/sdk(上游 MCP)/ aws4fetch(S3 签名)/ zod / DO WebSocket Hibernation(云侧设备 WS)/ ws + partysocket(端侧)/ commander(CLI)/ @hono/node-server + better-sqlite3(Node 宿主)/ React 19 + Vite + Tailwind + shadcn/ui + @rjsf + TanStack Query(Dashboard)/ Vitest + @cloudflare/vitest-pool-workers / wrangler。
- **架构基座已定**:core 纯逻辑(唯一运行时依赖 zod)→ gateway/sdk/cli/server 装配;四个宿主注入点(StateStore/ObjectStore/SecretStore/DeviceTransport)收敛 CF 与 Node 差异;`Authorizer.Check` 唯一权限判定入口;凭证不出网关(SecretStore 只写不读,节点存 authRef/skRef 引用名)。
- **工程纪律**:`pnpm verify` 全绿是底线;测试是验收法官,不伪造进度;成熟框架优先;三入口对等(Agent/CLI/Dashboard),CLI 做不到而 Dashboard/API 做得到 = 管理旁路 = 缺陷;少量多次 commit。
- **当前 main 是干净的安全边界版**:7 个误合提交(meego plugin / 飞书登录换 key / pod-diag / 域名迁 fantacy.live)已整体 revert;当前分支在 revert 点上,工作区干净。
- **三份 review 都只是只读结论,未落代码**:Plugin SDK 设计(review-plugin-sdk-design worktree,工作区全干净)、Composio 对比(composio-toolbridge-compa,有未提交 composio-comparison.md)、Search 审计(check-cli-search-support,有未提交审计反思)。三个方向同处"想清楚了、没动手"起跑线。
- **Search 选型已实测**:D1 与 better-sqlite3 两侧 FTS5 + trigram 均可用。两条硬约束:①tokenizer 必须 trigram(unicode61 对中文基本不可用);②query 短于 3 字符(「日程」「日历」这类两字词)必须走 LIKE 子串扫描兜底,否则静默返回空(比报错更糟)。
- **当前有 4 个安全阻断项挡部署**:阻断项修复前整棵树只适合 Draft、不得部署。

## 已拍板(逐条:决策 + 理由)

1. **起点 = 先清安全阻断项(阶段 A)**。理由:4 个阻断项挡着所有部署,后续功能不清掉它们上不了线;且其一(Secret Reference 授权)落在 Provider/注册边界,正是阶段 B Plugin SDK 要重构的那块,先清 = SDK 建在正确授权模型上不返工。

2. **阶段 A 只清 4 个部署阻断项**,不含更大安全面。四项:①Secret Reference 使用授权(两条注册通道校验写入者对 skRef/authRef 的使用权 + resolve 失败 fail closed,去掉静默匿名降级)②DO/Node 连接替换 TOCTOU(跨 await 后复核活动连接 + 校验 scope/registerPaths 收紧)③Node/Docker bootstrap fail closed(缺 TB_BOOTSTRAP_ADMIN_SK 拒绝启动,不随机生成写 stdout)④canonical origin 对等(非法配置不静默回退,Node/SDK 与 Workers 对齐)。理由:分布式 rate limit、HttpOnly session + CSRF + BFF 是增强非部署 blocker,记路线图不占这轮。

3. **阶段 B(Plugin SDK / OperationRegistry)breaking 一步到位**。删 legacy provider API / v1 adapter / 强制四方法接口 / ToolProvider.Get 样板。飞书 plugin 用新 SDK 重写做首个迁移验证。理由:无发布无用户,兼容层是 review 最贵的部分,现在不用付;阻断项修复期生产本就冻结,breaking 迁移窗口与之重叠,不影响任何活跃用户。合并方向 3 层 1(TB/宿主装配面收敛)进本阶段,同源。

4. **纳入"对外 MCP 出口"(新阶段 E),形态 = flat 全暴露**。整棵树按 SK scope 裁剪后 flat 暴露为 MCP tools,存量 Claude Desktop/Cursor 连上即用。理由:针对"几乎没人用"的处境,这是最低成本获客杠杆;flat 不依赖 Search,能紧跟 B 早出;meta-tool 式(SEARCH_TOOLS)是树大了才需要、且依赖 Search 的解法,本轮不做。

5. **阶段 C(Search)只做 0+1**。阶段 0 = 协议 `~search` 保留段进契约 + HTBP Draft 同步 + `~describe` 声明能力 + mode 沿用 keyword|semantic 不新造枚举;阶段 1 = D1/sqlite FTS5 + trigram + 短查询 LIKE 兜底 + 第五个宿主注入点 SearchIndex(CF 用 D1,Node 用 better-sqlite3,同库不同表)+ 索引 tool name/description + ~feedback title/detail(加权 name>description>feedback)+ 索引原始 ToolSpec(虚拟化/可见性/Authorizer.Check 放返回前后处理,over-fetch 填页,cursor 语义进契约)+ wrangler.jsonc 加 d1_databases + provision.mjs 补幂等 D1 分支 + 三入口对等(tb search + Dashboard 搜索面)。理由:先把基础搜索上线拿反馈;正则(阶段 2)与语义检索(阶段 3)记路线图未排期。

6. **阶段 D = 方向 3 层 2 + 层 3**。层 2:Dashboard 组件拆分(Registry/Plugins/SK 大页拆纯 config builder / kind 子表单 / 共用 section)。层 3:Docker Compose 本地开发栈(一键起 gateway + 一个 plugin worker + mock 上游;生产仍单容器不动)。理由:两块都依赖 B(Plugin v2 挂载配置形态)和 C(搜索面)接口定稿,先做会返工。

7. **执行顺序 = A → B → E → C → D**。E 紧跟 B(flat 不依赖 Search);C 在 E 后(C 索引 ToolSpec,B 改 ToolSpec 派生形态,C 必须在 B 后;E 只读现有 tool list 亦在 B 后);D 最后(依赖 B/C 接口定稿)。

8. **A 解冻后增量上线**。A 清完 4 个阻断项 → 立即部署解冻;之后 B/E/C/D 每个完成即部署上线。理由:获客目标下 MCP 出口一好就能让人用;DOD 验收可用生产 smoke(而非仅本地 miniflare/Docker)。

9. **逐阶段 PR 合入 main**。每阶段一个 PR,A 必须最先独立合并解冻。理由:符合少量多次 commit 纪律,每阶段可独立回滚,与增量上线一致。

## 记录在案的假设(用户已全部追认,无待追认项)

- 无。本轮 5 个 AskUserQuestion(起点 / 组件抽象三层 / B breaking 度 / Search 深度 / 邻近机会 / 安全 scope / MCP 出口形态 / 部署节奏 / 交付粒度)全部由用户显式选定,无静默默认值。

## 技术栈新增结论(落 DOR 技术就绪)

- **阶段 C 新增第五个宿主注入点 `SearchIndex`**:CF = D1(FTS5 + trigram),Node = better-sqlite3(已在 packages/server,SQLite 3.53.2 已编入 fts5+trigram,无需换依赖),建议同库不同表,不违反 SqliteStateStore 单表 kv 纪律。miniflare 从 wrangler.jsonc 读 d1 绑定自动起本地 D1,集成测试零额外配置。
- **阶段 E 对外 MCP server 面**:复用 @modelcontextprotocol/sdk 的 server 侧(已是上游 client 依赖),在 gateway 加一个 MCP server 端点,内部转发到现有树调用分发 + Authorizer.Check 裁剪。不引新框架。
- 其余全部沿用现有选型表,无新增依赖。
