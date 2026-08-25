# 开源组件替代与大幅代码精简审计

> 审计日期：2026-08-25–26
> 代码基线：`main@c4972b9`；实施分支从该点开始，§22–23 的数字包含其后全部正式改动。
> 审计性质：§1–21 是方案审计，§22–23 记录按审计结论完成的实现、反证与验收。
> 结论可信度：代码数量和重复模式来自当前工作树；删除量是区间估算，只有 PoC 的净 diff 才能作为立项承诺。
> 文档状态：情景 A 的已实施项是当前代码事实；情景 B/C 与文末剩余候选仍需独立 ADR/PoC。
> 复核修订：已吸收独立 review，并对 `74c02ba..c4972b9` 新增的 Default Store/object storage 整链路做了二次专项审计；同时修正 Ky 对照组、JOSE 需求矩阵、OpenConnector 净删口径、Dockerfile 平台约束和 Hono precompressed 验证前提。

## 1. 执行结论

重构前主线约有 **138,535 行 TypeScript/TSX 源码**，完成两轮后为 **136,567 行**。真正能实现“数量级代码精简”的区域高度集中：基线 `packages/plugins/src` 有 **82,791 行**，约占全部源码 **59.8%**；再加插件测试和迁移脚本，相关受维护代码约 **119,208 行**。

rebase 带入的 Default Store 是一次净增 **6,091 行生产源码 + 3,592 行测试**的大改动。专项 review 的结论是：它的 CAS、capability、幂等、可撤销 share、relay/direct 和清理状态机是产品语义，不宜被 tus、Uppy、S3 SDK 或通用状态机整体替换；但 CLI/Dashboard/SDK 的 Store wire parser 与上传编排明显重复，另有一批尚未启用的持久化字段和可合并的 1:1 object/upload session，是新的高价值精简面。

因此，结论不是“给每个自研模块找一个 npm 包”，而是分成三条不同收益/风险的路线：

| 路线 | 删减口径 | 风险 | 本报告判断 |
|---|---:|---|---|
| 仓内收敛：复用现有 Zod、Hono、Commander、RJSF、SDK | 约 3k–6k 源码 | 低到中 | 应先做，确定性最高 |
| 共享传输 + OpenAPI/官方 SDK：减少 provider 与三端重复 | 约 8k–20k 源码 | 中到高 | 主推荐路线，按 PoC 分批推进 |
| 外置 OpenConnector catalog/runtime | 全外置毛删上限约 119.2k tracked 行；混合模式初步净删 48k–96k | 极高 | 只做架构级试点，不应直接删除内置 catalog |

这三个区间不能简单相加，部分候选会覆盖同一批代码。

最平衡的建议是：

1. 先用仓库已有组件消除重复定义和重复编排，并把 Store 的中立 wire schema/上传原语收口到 SDK；
2. 建立唯一的 `guardedFetch` 可注入 provider HTTP client 接口，用同一批 5–10 个简单 provider 对照比较零依赖实现与 Ky 包装，再根据净 diff 选型；
3. 对固定控制面建立 Zod/OpenAPI 真源，生成 neutral client，停止 Dashboard、CLI、SDK 手抄 wire 类型和 HTTP 层；
4. 单独做 OpenConnector sidecar PoC，验证安全、凭证、动作形状和三入口对等后，再决定是“保留内置 catalog”“混合模式”还是“外置 catalog”；
5. 不替换 HTBP、权限顺序、SecretStore/authRef、`guardedFetch`、canonical search/hydrate、设备 generation/presence/reclaim、MCP 投影等产品核心。

## 2. 审计范围与方法

### 2.1 覆盖范围

- 核心与应用：`packages/core`、`packages/app`
- 运行时：`packages/server`、`packages/gateway`
- 客户端：`packages/dashboard`、`packages/cli`、`packages/sdk`
- 插件：`packages/plugin-sdk`、`packages/plugins`
- 部署与工具：`deploy/`、`template/`、`scripts/`、Dockerfile、Wrangler/Helm 配置
- 测试：重点检查 provider wire tests、三宿主 store/search contracts、OAuth、设备与静态资源集成测试

### 2.2 调查路径

本次先通过 llmdoc V3 建立架构地图，再回到代码与测试验证：

- `llmdoc/architecture.mdx`
- `llmdoc/protocol/htbp-contract.mdx`
- `llmdoc/protocol/security-boundaries.mdx`
- `llmdoc/plugins/plugin-runtime.mdx`
- `llmdoc/plugins/designing-and-migrating-plugins.mdx`
- `llmdoc/search/search-index.mdx`
- `llmdoc/app-runtime/state-store.mdx`
- Dashboard、CLI、设备、宿主与发布相关 llmdoc

当前 llmdoc 基线为 `3b9205c`，落后 HEAD 10 个提交，但 `status` 识别为 0 篇 impacted、0 篇 needs-review；这 10 个提交已同轮补入 Default Store 等新文档。本报告仍坚持“代码 + 测试为准，llmdoc 用于识别不变量”。

还执行了以下结构化检查：

- 分 package 统计源码与测试行数；
- 扫描 provider 中的 request、URL、response、JSON 与错误处理模式；
- 用 `jscpd` 检查插件精确复制粘贴重复；
- 用 Knip 做未使用文件/依赖初筛；
- 检查 Dashboard/CLI/core 的重复 wire 类型；
- 检查 server/gateway 配置、StateStore、SearchIndex、设备与部署实现；
- 联网核验候选项目的官方文档、运行时支持、许可与当前发布快照。

### 2.3 一个重要方法结论

插件的精确 clone 比例只有约 **2.24%**（1,066 个重复行）。因此，不能把 4 万行 provider API 代码都描述成“复制粘贴”。真正的问题是 **语义重复**：每个 provider 都各写一套 URL/query/header、响应读取、JSON 解析、错误 envelope 与 transport 异常映射。这类重复需要共享 transport 或生成式契约解决，普通去重工具不会自动解决。

## 3. 当前代码量画像

### 3.1 源码规模

| Package | TS/TSX 源码行数 | 主要职责 |
|---|---:|---|
| `app` | 8,565 | 宿主中立装配、HTBP 路由、MCP/OAuth/provider/Store adapter |
| `cli` | 7,665 | 命令、设备运行时、Store、Cloudflare 初始化、输出 |
| `core` | 13,535 | 协议、权限、树、Store 状态机、搜索、builtin |
| `dashboard` | 19,152 | Canvas、系统管理、Store、node/context/skill UI |
| `gateway` | 1,570 | Workers/D1/R2/DO 宿主 |
| `plugin-sdk` | 726 | plugin/v2 作者面和安全 envelope |
| `plugins` | 82,791 | 99 个内置 provider 的 schema、API 与注册 |
| `sdk` | 2,138 | 设备连接、Store 上传等客户端能力 |
| `server` | 2,393 | Node/SQLite/PG/Redis/WS/FS object/静态资源宿主 |
| **合计** | **138,535** | |

### 3.2 插件目录分解

| 形态 | 行数 | 文件/目录证据 |
|---|---:|---|
| Provider API 实现 | 40,828 | 117 个 `api.ts`/`api/*.ts` |
| Schema | 35,296 | 105 个 schema 文件 |
| Provider `index.ts` | 5,576 | 99 个入口文件 |
| Provider wire tests | 34,315 | 约 99 个测试文件 |
| 全部插件测试 | 35,576 | |
| 迁移/生成脚本 | 841 | |

重复模式的直接证据：

- 97 个 API 文件调用 `guardedFetch`；
- 95 个文件手工读取 `response.text()`；
- 94 个文件手工 `JSON.parse`；
- 98 个文件使用 `upstreamError`；
- 按 `function/const request*` 启发式统计，86 个文件定义自己的 request 层；
- 98 个 provider 测试文件直接替换全局 fetch。

上述 API 口径是 `packages/plugins/src/**/api.ts` 和
`packages/plugins/src/**/api/*.ts`，包括 GitHub/Gmail/Google Calendar/Google Docs 的
`api/shared.ts`。先前使用 `-g 'api/*.ts'` 会漏掉这 4 个嵌套文件，从而得到 93；
可复核命令为：

```bash
rg --files packages/plugins/src -g 'api.ts' -g '**/api/*.ts' | wc -l
rg -l 'guardedFetch' packages/plugins/src -g 'api.ts' -g '**/api/*.ts' | wc -l
rg -l 'response\.text\(' packages/plugins/src -g 'api.ts' -g '**/api/*.ts' | wc -l
rg -l 'JSON\.parse' packages/plugins/src -g 'api.ts' -g '**/api/*.ts' | wc -l
rg -l 'upstreamError' packages/plugins/src -g 'api.ts' -g '**/api/*.ts' | wc -l
rg -l 'function request|const request|async function request|request[A-Z].*=' packages/plugins/src -g 'api.ts' -g '**/api/*.ts' | wc -l
rg -l 'globalThis\.fetch\s*=|stubGlobal' packages/plugins/test -g '*.test.ts' | wc -l
```

这使 provider catalog 成为本轮唯一值得投入架构级 PoC 的区域。

### 3.3 其它明显重复面

| 区域 | 证据 | 判断 |
|---|---|---|
| Builtin/context/skillhub | schema、运行时校验、scope 表、`switch(cmd)` 多份定义 | 用现有 Zod + `OperationRegistry` 收敛 |
| Dashboard/CLI/SDK | Store wire、HTTP、TBError、relay/direct/complete 上传编排已三份实现 | 先建 neutral `@tool-bridge/sdk/store`，再生成其他固定控制面 client |
| Dashboard system UI | `pages/system` 7,538 行 + add-tool 1,076 行，合计 8,614 行 | 扩用现有 RJSF，但 StorePage 是二进制传输/能力操作而非 schema CRUD，明确排除 |
| CLI | 79 个 action 中 78 个重复 `guard()`（另 1 处为定义） | 用 Commander 单一 catch |
| 设备客户端 | CLI 与 SDK 各有 PartySocket supervisor | CLI 复用 SDK |
| Server/Gateway config | TTL、整数、allowlist 等解析镜像 | 用现有 Zod 建共享 schema |
| Node UI assets | 172 行静态文件、压缩、ETag、缓存 | 用现有 Hono + 构建期预压缩 |
| Dockerfile | 服务镜像两份 45 行变体只差 `VOLUME`；另有 64 行 `Dockerfile.cli` | 保留服务变体并用注释/契约测试互指；CLI 镜像用途不同，不合并 |

## 4. 哪些成熟组件已经用对了

为了避免“为了换库而换库”，以下基础设施应保留：

| 领域 | 当前组件 | 结论 |
|---|---|---|
| HTTP | Hono、`@hono/node-server` | 保留并扩大复用 |
| Schema | Zod 4、Ajv/CF JSON Schema validator | 保留并建立单一真源 |
| MCP | 官方 `@modelcontextprotocol/*` | 已经把线协议交给官方 SDK |
| Dashboard state/router/canvas | TanStack Query、React Router、React Flow、dagre | 保留 |
| 动态表单 | RJSF + Ajv8 | 保留并扩展到更多管理表单 |
| CLI | Commander、Clack、p-retry | 保留，集中使用错误能力 |
| WebSocket 重连 | PartySocket | 保留，减少重复接线 |
| Node/数据库/Redis | better-sqlite3、postgres.js、ioredis、ws | 当前抽象足够薄 |
| S3 签名 | aws4fetch | 当前问题在手写 S3 REST/XML，不在 SigV4 本身 |
| Plugin 作者面 | `@tool-bridge/plugin-sdk` | 726 行语义密度高，不应换通用框架 |

## 5. 推荐目标架构

```text
固定控制面：Zod / OperationRegistry / OpenAPI
                         │ 生成
                         ▼
              neutral protocol client
                 │        │        │
                 ▼        ▼        ▼
               CLI    Dashboard    SDK

provider adapter / generated client / selective official SDK
                         │
                         │ custom fetch, retry = 0
                         ▼
                    guardedFetch
                         ▼
                    upstream API

可选架构试点：OpenConnector runtime
                         │ HTTP Action API / SDK
                         ▼
                Tool Bridge proxy adapter
```

关键点：`guardedFetch` 仍是内置 provider 的唯一出站安全下界。OpenConnector 若作为外部 runtime，则是一个新的独立信任域，必须使用它自己的凭证、action policy、egress policy、审计与网络隔离；不能把两者写成“等价实现”。

## 6. P0：先做不引入或少引入依赖的确定性收敛

### 6.1 Zod + `OperationRegistry` 统一命令定义

#### 当前问题

`packages/core/src/builtin/*`、context、skillhub 和部分路由同时维护：

1. 手写 JSON Schema；
2. `requireString`/`requireObject` 等运行时校验；
3. `switch(cmd)` 派发；
4. scope 映射；
5. Help 中的命令元数据。

仓库已有 `OperationRegistry`，支持 Zod → JSON Schema、`safeParse`、handler 和 ToolResult 包装，但平台 builtin 尚未完整复用。

#### 建议

- 给 registry 增加 `scope`、返回形状、HTBP Help adapter；
- schema 必须 `.strict()`，继续拒绝未知写参数；
- `cmd.path` 保持完整路径；
- 先迁 `status/federation/annotation/secret`，再迁 registry/catalog，最后迁 plugin；
- context/skillhub 用同一注册表生成 Help 和 dispatch。

#### 预计收益

净删 **700–1,100 行**，并消除比 LOC 更重要的 schema 漂移。风险为中等，主要风险是 Help JSON 的 `required`、`additionalProperties`、description 等公开形状变化。

### 6.2 Commander 集中错误处理

CLI 79 个 action 中 78 个重复包裹 `guard(asJson, fn)`。`main.ts` 已经使用 `parseAsync` 和 `exitOverride`，应让 action 自然 reject，在一个 catch 中区分 help/version、CommanderError、CliError 和未知 Error。

预计净删 **150–250 行**。必须用现有参数契约测试锁住 root/group/leaf 三个位置的 `--json`、`--` 后裸参数、help/version 和退出码。

### 6.3 CLI 复用 SDK device supervisor

CLI 的 `deviceRuntime.ts` 和 SDK 的 `device/connection.ts` 都实现 PartySocket、Bearer header、heartbeat、reconnect、ready/closed。SDK 版本更完整，CLI 应只保留 shell/fs provider、信号、daemon 状态和输出映射。

预计净删 **150–250 行**。保留 `DeviceClient` 的 hello/call/result/idempotency/generation 语义。

### 6.4 三端共用 Store 中立 client，Context 只共用最低层 PUT 原语

新 Store 功能已把重复面从“presigned PUT”扩大成三阶段协议：创建 session、relay/direct 上传、direct complete。SDK 的 `device/storeUpload.ts` 已覆盖 rotating credential、call capability、Node stream、AbortSignal、大小推断和错误脱敏，但 CLI 和 Dashboard 又各自实现了同一套 grant/descriptor parser 与 relay/direct/complete 编排。

建议在现有 SDK 中新建 neutral `@tool-bridge/sdk/store` 子入口：

- `wire`：严格 Store URI、grant、descriptor、read/share parser；
- `transport`：可注入 fetch、TBError、Abort、`credentials: 'omit'`和 secret redaction；
- `upload`：唯一的 create → relay/direct → complete 状态机；
- `client`：stat/list/read/download/share/revoke/delete；
- device、CLI、Dashboard 只保留 credential、argv/UI、文件流和错误类适配。

当前已经出现实际漂移：core 只接受 22–64 位 base64url object id，device SDK/CLI/Dashboard 的 parser 更宽；Dashboard 会给缺失的 descriptor 字段填默认值；CLI `sanitizeStoreOutput` 使用敏感字段黑名单，弱于白名单重建对象。因此这不只是 LOC 优化，也是正确性修复。

两组独立审计对这一项的估算分别为 **320–500** 和 **420–620 行生产源码**，差异来自是否同时计入 CLI/Dashboard 的白名单投影和小 helper。立项按更保守的 **320–500 行**记账，已扣除新子入口、三端 adapter 与构建配置。Context `create_upload` 没有 session/relay/complete，只复用“校验 HTTP(S) grant + 安全 PUT + 不读错误体”的最低层 helper；不应把两种业务协议强行合并。

### 6.5 Zod 统一 server/gateway/device 环境变量

`server/config.ts` 与 `gateway/app.ts` 明确互相镜像，device 又有第三份正整数解析。直接复用仓库 Zod，不需要再引 `envalid`。

预计净删 **70–110 行**。迁移必须保留当前“非法值回默认”与 `TB_PORT=0` 的特殊行为；不能让 Zod 默认抛错悄悄改变部署兼容性。

### 6.6 保留 Dockerfile 平台变体，只收敛主题实现

- 撤下“合并 Dockerfile”的删行建议。`Dockerfile` 的 `VOLUME /data` 保留了裸
  `docker run` 的持久化提示，而 Railway Metal builder 不接受 `VOLUME`，因此
  `Dockerfile.railway` 必须删去该指令。改成 build arg 会新增分支与测试，放弃 `VOLUME`
  则会改变现有部署行为，都不是无遗憾精简。
- 保留现有“两份文件互指 + `scripts/dockerfile-contract.test.mjs` 限定仅一行差异”的做法，不计入 LOC 收益。
- 仓库还有 64 行 `Dockerfile.cli`，它用 Bun 编译独立 `tb` CLI 镜像，与服务镜像
  的 runtime、入口和发布用途不同，不属于可合并副本。
- Dashboard 已依赖 `next-themes`，Sonner 也在读它，但应用仍有自研 theme store；
  补 ThemeProvider 后删除自研主题真源，属于小而确定的收敛。

## 7. P0/P1：建立统一 provider HTTP client

### 7.1 先确定共享边界，再在零依赖与 Ky 之间选型

“建立统一 provider HTTP 薄层”和“选用 Ky”是两个独立决策。**4k–10k 的潜在删除量主要来自共享薄层，不能归因于 Ky。** 本项目要关闭 Ky 的默认重试，并自己约束 custom fetch、redirect 和错误映射；这会覆盖它的一部分核心价值，所以不应预设引入依赖一定更简洁。

先定义一个不泄露底层库的项目接口，例如：

```ts
createProviderHttpClient({
  fetch: guardedFetch,
  errorMessage(payload, status) {},
})
```

然后实现两个对照组：

1. **A 组：零依赖 `createProviderHttpClient`**。基于标准 `fetch`/`Response`，只实现共享
   query、body decoder、稳定错误和可注入 hook，目标控制在约 100 行。
2. **B 组：Ky 包装**。使用 [Ky](https://github.com/sindresorhus/ky) 2.0.2（MIT、
   Fetch 原生）实现同一接口，显式设 `retry: 0`，且不允许 provider 直接依赖 Ky。

在有可信 OpenAPI 时，[openapi-fetch](https://openapi-ts.dev/openapi-fetch/) 是另一条“生成式客户端”路线，不参与这个手写 REST 薄层的 A/B 归因。

两个对照实现都必须保证：

- 底层 fetch 强制注入 `guardedFetch`，绝不回退到裸 `globalThis.fetch`；
- 不自动重试；Ky 组必须显式 `retry: 0`，禁止写操作被客户端自动重放；
- redirect 仍由 `guardedFetch` 逐跳处理；
- 统一 JSON/text/empty decoder；
- query 支持重复 key；
- transport error 和上游 error 映射为稳定 TBError；
- 异常不回显 URL、header、body 或 credential；
- provider 可以覆盖特殊 error envelope、multipart、GraphQL 与非 JSON 行为。

### 7.2 试点范围

首批选择 5–10 个单 base URL、JSON REST、header/Bearer key、无 multipart/GraphQL 的 provider。A/B 组必须从同一基线迁移同一批 provider，避免用样本差异“证明”某个候选。不要先迁 Airtable、Google、Gmail、Telegram、PostHog 等特殊 wire provider。

逐个比较：

- URL、method、query、headers、body 完全一致；
- 204/205/304、空 body、invalid JSON 一致；
- 401/403/404/409/429/5xx 映射一致；
- transport error 不泄密；
- SSRF/redirect 测试仍经过相同入口；
- bundle 未因每个 provider 实例化 client 而显著增长；
- 分别报告生产源码净 diff、测试净 diff、minified+gzip bundle、依赖/转移依赖数、
  Node/Workers build 和特殊 error hook 所需逃生代码。

### 7.3 预估收益与边界

按上述启发式统计，86 个文件有自有 request 层。按每个减少 50–120 行估算，共享薄层的目标可设为净删 **4k–10k 行**，但这是 PoC 待校准区间，**与最终选零依赖实现还是 Ky 无关**。

选型规则：只有 Ky 在同等 wire/安全契约下带来可见的额外净删量，且 bundle、Workers 兼容和特殊 provider 逃生代码不劣于零依赖组，才引入 Ky；否则合并零依赖薄层。

不能删除的部分：provider 的 credential 映射、action 输入/输出投影、effect/confirm、特殊分页、稳定错误语义。统一 transport 不等于删除全部 40,828 行 API 实现。

## 8. P0/P1：生成式 neutral protocol client

### 8.1 当前问题

Dashboard、CLI、SDK 分别维护 wire types、HTTP、TBError 和上传 grant：

- Dashboard `types.ts` 377 行、`api.ts` 578 行、`queries.ts` 511 行；
- CLI `types.ts` 206 行和自有 `apiFetch/apiJson`；
- SDK 另有上传协议解析；
- 多处 `as HelpJson`、`as TreeJson`、`as Page<T>`，只有编译期断言，没有响应运行时验证。

### 8.2 推荐方案

1. 先用 Zod 表达固定管理端点和 lifecycle endpoint，并让 Store wire/runtime parser 成为单一真源；
2. 用 [`@hono/zod-openapi`](https://hono.dev/examples/zod-openapi) 生成 OpenAPI，或维护独立 OpenAPI artifact；
3. 用 `openapi-typescript` + `openapi-fetch` 生成/消费 neutral client；
4. Dashboard 的 TanStack Query 只保留 query key/cache policy；
5. CLI 只保留 argv、交互和展示；
6. 动态 HTBP path 继续使用 `call<TInput,TOutput>(path,input)`，schema 来自运行时 `~help`；
7. Store 先不直接生成 OpenAPI client：当前 Help 只有 input schema 和文字 `returns`，还没有权威 response/error/security schema。先收敛 canonical parser，再补 artifact 并对照 openapi-fetch 的净 diff。

[Hono RPC](https://hono.dev/docs/guides/rpc) 也支持共享 server/client 类型和自定义 fetch，但不应作为默认方案：它会让客户端依赖 app 的类型布局；动态 path、全局错误类型和 public artifact 边界仍要额外处理。对当前仓库，稳定的 OpenAPI artifact 更适合作为 CLI/Dashboard/SDK 的中立契约。

### 8.3 收益与风险

不含 Store 专项的其他固定控制面，直接可删除/生成替代约 **500–1,200 行**。Store neutral client 的保守 **320–500 行**与这个区间存在交叉，不能相加。更大的价值是终止三入口协议漂移。

不能为了迎合 OpenAPI 把 HTBP 改回命令 envelope。必须保留：

- `POST /<full-command-path>` + 裸 arguments body；
- Accept JSON/Markdown/text；
- 不存在或不可见 read 返回 404；
- command path、Help 和动态 schema；
- TBError 七类语义。

## 9. P1：Dashboard 表单扩用现有 RJSF

Dashboard system pages 与 add-tool 约 **8,614 行**，包含大量显式 setter/onChange；而动态命令表单已经使用 [RJSF](https://github.com/rjsf-team/react-jsonschema-form) + Ajv8。

推荐分层：

1. schema 能表达的基础字段由 RJSF 渲染；
2. `credentialFields`、`mountConfigFields`、OAuth descriptor 生成统一 field model；
3. SK scope、repeatable 配置若 RJSF 不自然，再局部引 React Hook Form + Zod；
4. 一次性 token、文件上传、OAuth 跳转、destructive confirmation 使用自定义 widget；
5. `integrationPlan`、`managedCredential`、secret 写入/回滚继续保留为纯业务 compiler。

优先迁 PluginManifest、SK scope、plugin mountConfig、registry 基础字段；Catalog/Integration 凭证事务最后迁。新增 `StorePage` 主要是文件选择、上传/下载、短期 bearer 交付、分享撤销和删除确认，不是 JSON 配置表单；不应用 RJSF、Uppy Dashboard 或 TanStack Table 重写它。

预计净删 **1.5k–3k 行**。不建议引 React Admin/Refine：当前页面大量操作不是标准 CRUD，且已有自己的 Canvas、设计系统和事务语义，引入整套 admin framework 很可能净增适配层。

## 10. 战略选项：把内置 provider catalog 外置到 OpenConnector

### 10.1 为什么它是唯一的数量级候选

当前 99 个 provider 很大一部分来自 `oomol-lab/open-connector` 的迁移。上游 [OpenConnector](https://github.com/oomol-lab/open-connector) 当前提供：

- provider/action catalog；
- API key、OAuth2、自定义 credential 与连接管理；
- action allow/block policy、runtime tokens、connection grants；
- HTTP Action API、OpenAPI、MCP 和 Web Console；
- Docker/Node/Cloudflare 部署；
- 出站/私网策略与运行审计。

其 [Runtime API](https://github.com/oomol-lab/open-connector/blob/main/docs/runtime-api.md) 提供：

- `GET /v1/actions`
- `GET /v1/actions/:actionId`
- `POST /v1/actions/:actionId`
- `GET /openapi.json`
- `POST /mcp`

因此，可以用一个薄的 Tool Bridge proxy adapter 动态 list/get/call action，而不是继续把整个 catalog 复制到仓库。官方还提供薄 TypeScript connector SDK；核验日 npm 快照为 `@oomol-lab/connector@1.1.0`、MIT，但项目较年轻，必须精确锁版本。

### 10.2 两种接入方式

#### 方式 A：直接挂 OpenConnector MCP

实现最少，但 OpenConnector MCP 暴露的是 `list_apps/search_actions/get_action_guide/execute_action` 等少量元工具。它不会自然保留 Tool Bridge 中每个 provider action 的独立工具身份、effect/confirm 与 HTBP path。

结论：只适合“允许元工具 UX”的新入口，不适合无感替代现有 catalog。

#### 方式 B：HTTP Action API + Tool Bridge `proxyTools`

`plugin-sdk` 已有动态 `proxyTools` 能力。adapter 可以：

- list OpenConnector actions；
- 将 action schema 映射成 HTBP tool；
- call `/v1/actions/:actionId`；
- 传递独立 runtime token、connection alias 与 idempotency key；
- 把 response/error 转成 ToolResult/TBError。

这更可能保留每个 action 的工具身份，但 adapter 仍需处理 schema、effect、确认、错误、分页、缓存和身份映射。

### 10.3 最大风险：这是信任边界迁移，不是普通依赖替换

外置后会发生以下实质变化：

- provider credential 从 Tool Bridge SecretStore/authRef 移到 OpenConnector connection store；
- provider 出站不再经过 Tool Bridge `guardedFetch`，改由 OpenConnector 的 egress/private-network policy 承担；
- action allowlist 与 scope 需要两套系统做明确映射；
- OAuth 管理、连接 UI、审计和 token 生命周期可能出现双控制面；
- OpenConnector action 更新可能改变公开 tool schema；
- 两服务部署、升级、健康检查、网络故障与备份成为新运维面；
- Cloudflare 下可能需要第二个 Worker/Service Binding，Node 下需要 sidecar/container；
- MCP 元工具与现有单 action 工具的 agent 体验不同。

所以，不能把“删掉 8 万行”写成无成本收益。它是把 provider catalog 的维护责任移到上游服务，同时改变 Tool Bridge 的 credential 与 egress 信任模型。

### 10.4 必须做的 PoC

选择五类代表 provider：

1. no-auth；
2. 单 API key；
3. OAuth + refresh rotation；
4. multi-field credential；
5. self-hosted/custom base URL。

对每个 provider通过：

- descriptor/action/schema 等价；
- action 名、description、input/output、effect/confirm 形状；
- wire 请求与错误语义；
- credential 不进入 Tool Bridge `providerConfig`、日志、URL、错误；
- SSRF/redirect/private network 边界对照；
- revocation、scope 收紧、connection grant 即时生效；
- API、CLI、Dashboard、MCP 入口可见性一致；
- OpenConnector 不可用时 fail closed，不能降级为裸上游调用；
- 固定 image digest/SDK 版本，action schema fingerprint 变化阻止静默升级。

### 10.5 数量级估算

若完全外置，理论删除上限为：

- 插件源码：82,791 行；
- 插件测试：35,576 行；
- 迁移脚本：841 行；
- 合计约 119,208 行；
- 这是 **毛删除上限**，尚未扣除 proxy adapter、契约测试、部署与运维代码。

更现实的混合模式是保留高价值/强集成/特殊语义 provider，把标准 SaaS catalog 外置。为避免把毛数写成净收益，ADR 应使用下列口径：

| 口径 | 初步区间 | 包含内容 |
|---|---:|---|
| 毛删除 | **60k–100k tracked 行** | 被外置 provider 的源码、wire tests 和相关迁移代码 |
| 新增 | **4k–12k tracked 行** | proxy/schema/effect/error/auth adapter 约 1.5k–4k；五类 credential 的形状/wire/故障契约测试约 2k–6k；Node sidecar + Cloudflare service 配置、健康检查和升级脚手架约 0.5k–2k |
| 净删除 | **48k–96k tracked 行** | 毛删除减新增；只是 ADR 前的宽区间，不是交付承诺 |

这些区间仍需 PoC 按“保留 provider 列表”和实际 adapter diff 重算，并分开报告生产码、测试、配置与生成物。

比一次性迁移成本更重要的是 **双控制面的长期运营税**：SecretStore/authRef 和 OpenConnector connection store 各自有凭证配置、轮换/撤销、审计、备份恢复和权限故障。ADR 必须为此建立可度量基线，至少包括：

- 需要在两处配置凭证的 provider/用户占比，以及每次轮换/撤销的操作步数和平均耗时；
- 两条审计记录通过 trace/idempotency key 关联的成功率，以及无法归因的失败数；
- 两套服务的部署/升级次数、schema drift 阻断次数、凭证故障 MTTR；
- 两个 credential store 的备份覆盖率、恢复演练频率、RPO/RTO 和运维人时。

若这些指标未达团队事先设定的上限，即使 LOC 净删区间成立，也不应批准混合模式。

### 10.6 本报告建议

把它列为架构 ADR 的三个可选决策，而不是直接落地：

- 保留内置 catalog，只共享 transport/codegen；
- 混合模式：少量原生 provider + OpenConnector catalog；
- 全外置 catalog。

默认推荐先走第二种的试验分支，但在安全/形状/wire 三道闸门、净删口径和双控制面运营预算通过前，不删除任何内置 provider。

## 11. P2：按 provider 引入官方 SDK 或 OpenAPI 生成

不要给 99 个 provider 各引一个 SDK。应按“净删代码 / bundle 增量 / Workers 支持 / custom fetch / 重试可控”排序。

| Provider | 当前源码约数 | 候选 | 初判 |
|---|---:|---|---|
| GitHub | 6,952 | Octokit/OpenAPI generated client | 最值得 PoC，必须注入 guarded fetch |
| PostHog | 4,073 | 官方 OpenAPI/typed client | 先核验管理 API 覆盖 |
| Google Calendar | 3,365 | Discovery/OpenAPI generation | 避免无条件引入庞大 `googleapis` |
| Linear | 2,724 | `@linear/sdk`/GraphQL codegen | 高价值，核验 custom fetch/Workers |
| Gmail | 2,688 | Discovery generation | MIME/附件/分页仍需 adapter |
| Telegram | 2,254 | Bot API schema/codegen | 适合声明式生成，错误 envelope 保留 |
| Notion | 1,240 | 官方 SDK | 核验版本 header、fetch、输出归一 |
| OpenAI | 1,022 | 官方 SDK | 只有净 diff 为正时采用 |
| Stripe | 758 | 官方 SDK | 当前实现较小，SDK 可能净增 |
| Anthropic | 323 | 官方 SDK | 不值得只为统一引大依赖 |

统一准入条件：

- 支持 custom fetch 并强制经过 `guardedFetch`；
- 自动重试写操作可关闭；
- 不把 credential 放到全局 singleton；
- Node/Workers 双宿主可构建；
- 错误不会泄露 URL/header/body；
- action 名、schema、effect/confirm 不变；
- wire tests 断言真实 HTTP，而不是只 mock SDK 方法。

对有稳定 OpenAPI 的 provider，轻量的 `openapi-typescript` + `openapi-fetch` 通常比重 SDK 更适合。[@hey-api/openapi-ts](https://heyapi.dev/docs/openapi/typescript/get-started) 可生成 client、Zod 和 TanStack Query，但核验日仍处于 0.x 快速开发期，应锁精确版本并先用于生成实验，不作为 catalog 的唯一长期真源。

## 12. P1/P2：安全与外部协议的成熟实现

### 12.1 先按 artifact 定义安全保证，再决定是否引入 JOSE

当前三种 artifact 虽然都用 WebCrypto/base64url，但不是同一类 token。不应先以“格式统一”为目标选 JWE，而应先固定威胁模型：

| Artifact | 当前载荷/实现 | 必需保证 | 保密性判断 | 默认候选 |
|---|---|---|---|---|
| `/~ref` token | 节点路径、对象 key、过期时间；当前是域分离 HMAC | 完整性/来源认证、短 TTL、路由约束、失败统一 404 | 当前协议已向 token 持有者暴露载荷；只有新威胁模型要求隐藏 path/key 时才加密 | JWS/HMAC + `exp`/用途绑定；需保密时再单独评估 JWE |
| OAuth state | 节点路径、PKCE `code_verifier`、redirect URI、过期时间；当前是域分离 AES-GCM | 完整性、保密性、短 TTL、回调/用途绑定 | `code_verifier` 是敏感值，必须保密 | JWE + `exp`/用途绑定，或保留现有 AES-GCM |
| search cursor | query digest、mode、revision、offset；当前是 AES-GCM | 防篡改、绑定 query/mode/revision、offset 上限和格式版本 | 载荷不含 credential，query 来自请求者；默认不要求保密 | **JWS/HMAC**，不默认 JWE；若 ADR 明确要隐藏 revision/offset 再改判断 |

[`jose`](https://github.com/panva/jose) 是零依赖、tree-shakeable ESM，并支持 Node、浏览器和 Cloudflare Workers，但当前代码已用域分离密钥和 WebCrypto 完成 HMAC/AES-GCM。因此 JOSE 从“可直接批准的删行项”降为 **需求与协议 PoC**，不再预估 180–280 行净删。

PoC 必须分别比较 token 长度、bundle、验证代码量、Node/Workers 算法可用性和密钥轮换方案。ref/state 的格式迁移必须支持至少一个最长 TTL 的旧格式验证窗口；search cursor 没有独立 TTL，需要旧格式 dual decoder 或明确的 revision/epoch 切换策略。否则在途 artifact 会集中失效。SecretStore 持久密文不要与短期 token 同一 PR 迁移。

### 12.2 `oauth4webapi` 替 provider OAuth 标准骨架

`core/plugin/oauth.ts` + `app/providerOAuth.ts` 共约 553 行。[`oauth4webapi`](https://github.com/panva/oauth4webapi/blob/main/docs/README.md) 可接管 PKCE、authorization code/refresh grant、client auth 与标准 token response。

必须保留：

- 非标准 provider response envelope；
- StateStore/SecretStore 持久化；
- refresh token rotation；
- TBError 和 secret 脱敏；
- 固定端点与 scope 分隔符兼容；
- `guardedFetch` 边界。

预计净删 **180–300 行**，风险高。MCP OAuth 已经使用官方 MCP client，不要与 provider OAuth 合并重写。

### 12.3 成熟 IP parser 只替解析，不替 policy

`packages/plugins/src/_runtime/ipPolicy.ts` 自己解析 IPv4/IPv6。可直接依赖固定版本的 [`ipaddr.js`](https://www.npmjs.com/package/ipaddr.js)，让它负责 parse、kind 和 mapped 地址归一；本项目继续维护 blocked ranges、metadata、CGNAT、文档网段等 fail-closed policy。

预计净删 **70–100 行**，收益主要是安全正确性。不能直接采用库的笼统 `isPrivate` 作为完整安全策略。

### 12.4 S3 REST/XML 客户端

`s3Object.ts` 已增长到 316 行，手写 HEAD/GET/PUT/DELETE/ListObjectsV2、XML、错误映射和 Store direct upload 需要的 exact presign 语义。三种策略：

1. 保守：继续 aws4fetch，只用 `fast-xml-parser` 替正则 XML，净删约 20–50 行；
2. 轻量 `@bradenmacdonald/s3-lite-client@1.0.0`：当前直接否决。其官方 signer 明确排除 `Content-Length` 和 `Content-Type`，即使传入 extra headers 也不会进 signed headers，违反 Store exact grant 下界；
3. 完整 AWS SDK v3：协议覆盖成熟，可能净删 90–180 行，但 `@aws-sdk/client-s3` 本包已约 3.3 MB unpacked 并带 Smithy 依赖。默认保留 65 KB 级的 `aws4fetch`；只在团队愿意用产物体积换协议覆盖时做同契约 A/B PoC。

必须验证 custom endpoint、R2 `region=auto`、path style、streaming GET、metadata、ETag 条件写、ListObjectsV2 cursor/delimiter、presigned GET/PUT 和错误脱敏。Store 还要求 presigned PUT 同时签名精确 `Content-Length`、`Content-Type` 和 create-only 条件；候选库不支持时不得为了换库降级。AWS SDK PoC 还必须 `maxAttempts: 1`，且 gateway gzip 增量不超过 100 KiB、device closure 为 0、最终净删至少 120 行，否则保留现状。

## 13. P0/P2：运行时与部署精简

### 13.1 Hono 静态文件 + 构建期预压缩

`packages/server/src/assets.ts` 172 行手写路径、缓存、FNV ETag、请求期 Brotli/Gzip。锁文件当前固定 `@hono/node-server@1.19.14`；该版本发布包的类型声明和实现都包含 `serveStatic({ precompressed?: boolean })`，但实现对 `Accept-Encoding` 做 token 精确匹配，而仓库没有对这套行为做过契约验证。**不把“实现了选项”当作“已满足本项目语义”的证据。**

该 PoC 的第一步是直接在锁定的 1.19.14 上建最小 fixture，验证 `.br/.gz` 选择、`gzip;q=1`、`br;q=0`、`Content-Encoding`、`Vary`、Range/HEAD、representation-specific ETag、304 和 fallback；只有通过后，才让 Dashboard build 生成预压缩文件，并用 `serveStatic({precompressed:true})` 替代请求期压缩。业务层仍要保留 hash asset `immutable`、index `no-cache` 和 SPA fallback。

预计净删 **90–130 行**，并把请求期同步 Brotli 变为构建期。必须对拍 `br;q=0`、Range/HEAD、encoded representation ETag、304 headers 和 `/ui` 前缀。

### 13.2 Wrangler 自动 provisioning

当前 `provision.mjs` 自行 list/create/backfill D1/R2。Cloudflare 官方 [Wrangler 配置文档](https://developers.cloudflare.com/workers/wrangler/configuration/) 已提供 D1/R2 等自动 provisioning，但当前仍标记 Beta；锁定 Wrangler 4.107 的相关 experimental flags 默认开启。

潜在可删 **150–230 行**脚本/测试/CI 接线，但必须在一次授权的临时账户验证：

- `TB_STATE` 与 `TB_SEARCH` 两个 binding 指向同一个 D1；
- 第二次 deploy 幂等；
- custom domain 与账户中立配置；
- CI 最小权限不被扩大；
- dashboard deploy 无 writeback 时的资源 ID 恢复策略。

这项不能只靠本地源码判断；真实外部资源验证每轮最多一次并保留脱敏证据。

### 13.3 Helm schema 与 Dockerfile 平台契约

- 用 Helm `values.schema.json` 承担形状与多数组合校验；领域错误文案和危险组合 fail-closed 保留；
- 可进一步评估 library chart，但 deployment/statefulset 自动推断、PDB/HPA/Redis/secret 契约较特殊，必须做资源级 golden diff；
- 保留 `Dockerfile` 和 `Dockerfile.railway`：前者的 `VOLUME /data` 保持裸 Docker 语义，
  后者受 Railway Metal builder 不接受 `VOLUME` 的平台硬约束。继续用互指注释和
  `scripts/dockerfile-contract.test.mjs` 限制除该行外保持同形，不承诺 LOC 收益。
- `Dockerfile.cli` 是独立 Bun CLI 发布产物，与两份服务镜像变体分开维护。

### 13.4 设备反向注册：不要用 Socket.IO 全链替换

这条链路并不是从 TCP 开始“手写 WebSocket”：Node 已使用 `ws`，SDK/CLI 已使用 PartySocket 处理重连，Cloudflare 已使用官方 Durable Object WebSocket Hibernation，帧校验使用 Zod。自研主体是注册/鉴权、generation fencing、调用幂等、cancel、presence/reclaim 与跨副本唯一所有权；换传输库后这些语义仍然存在。

直接相关的实现约 **3,785 行**、测试约 **3,517 行**。Socket.IO 全面迁移至少触碰 **2,774 行核心源码**和 **2,692 行直接协议/传输测试**，不是低风险的 import 替换。

#### 13.4.1 为什么 Socket.IO 不合适

[Socket.IO 官方说明](https://socket.io/docs/v4/how-it-works/)：它是 Engine.IO + Socket.IO 自有协议，而不是 raw WebSocket；现有 SDK、CLI、React Native adapter、Node 和 Workers 端必须同步换协议或长期双栈。

| 维度 | Socket.IO 提供什么 | 本项目仍需自行实现什么 | 判断 |
|---|---|---|---|
| 心跳、重连、ack | 成熟内建能力 | credential refresh、suspend/resume、generation、requestId 幂等和 cancel | 与现有 PartySocket/core 状态机高度重叠 |
| 多 Node 副本 | Redis adapter 可跨节点转发、广播与 ack | `deviceId → replicaId` TTL、owner-safe release、跨副本唯一 generation、保守 reclaim | 不能删除当前所有权层 |
| 状态恢复 | 临时断线 recovery | 授权重验、树注册同步、业务结果幂等 | [经典 Redis Pub/Sub adapter 不支持 recovery](https://socket.io/docs/v4/connection-state-recovery/) |
| Cloudflare | 无官方 Workers/DO server | hibernation attachment、auto-response presence、alarm reclaim、唤醒恢复 | 官方讨论认为需要新 engine 和大量改造 |
| wire 兼容 | 可把 DeviceFrame 再包成 event payload | 全部 raw WS 客户端兼容 | 多包一层却不删领域协议 |
| rooms/broadcast | 很适合聊天、房间广播 | 一台设备只能有一个权威 active connection | 广播反而可能把 call 发给顶替窗口中的两条连接 |

[Socket.IO 多节点文档](https://socket.io/docs/v4/using-multiple-nodes/)还表明：只有启用 polling 才需要 sticky session；当前本来就是 WebSocket-only，因此其 fallback/sticky 体系没有带来现有链路缺少的能力。[Redis adapter](https://socket.io/docs/v4/redis-adapter/)负责消息转发，不是设备 owner/lease 数据库。官方对 [Cloudflare Workers/DO 的讨论](https://github.com/socketio/socket.io/discussions/5019)至今也没有可直接采用的官方 hibernation server 实现。

所以，只有产品未来明确需要浏览器 polling fallback、namespace/room 广播，并愿意放弃或长期自维护 Workers/DO 等价层时，才应把 Socket.IO 作为“新协议/新端点”立项；不应以代码精简名义原地迁移已稳定端点。

#### 13.4.2 更合适的局部精简

| 优先级 | 方案 | 预计净删 | 风险与门禁 |
|---|---|---:|---|
| P0 | CLI 复用 SDK connection supervisor | **90–160 行** | raw wire 不变；保持动态凭据、错误帧退出、心跳、suspend/resume 与 generation 测试 |
| P1 PoC | Cloudflare 仅用 PartyServer 接管生命周期胶水 | **70–120 行** | 必须验证强制休眠恢复、attachment、auto-response timestamp、alarm、授权撤销、顶替竞态和结果持久化 |
| P2 随升级 | `@hono/node-server` v2 内建 `upgradeWebSocket` | **30–60 行** | 不单独为几十行做 major 升级；验证 auth middleware、101 headers、代理和 malformed handshake |

[PartyServer](https://github.com/cloudflare/partykit/blob/main/packages/partyserver/README.md) 是唯一能保留现有 raw DeviceFrame、同时贴合 Durable Object hibernation 的局部候选，但它最多替 `deviceSession.ts` 的 WebSocketPair/attachment/event 分发外围。bootstrap、hello/search 同步、generation guard、授权重验、auto-response presence、alarm reclaim 和结果持久化都必须保留。若无法稳定访问 auto-response timestamp、alarm 和 hibernation attachment，PoC 直接判失败。

Node 侧不要新增已 deprecated 的 `@hono/node-ws`；[Hono 当前文档](https://hono.dev/docs/helpers/websocket)已把 Node WebSocket helper 并入 `@hono/node-server`。仓库锁定的 1.x 尚无该导出，为这点收益立即升级不划算，当前继续使用 `ws` 更稳。

MQTT/NATS 只有在产品主动改变部署拓扑时才值得重审：MQTT 适合大规模 IoT、QoS 与离线命令，NATS 适合已有消息总线的 request/reply；二者都会新增 broker、凭据/ACL 和运维面，也不会删除注册树、授权、generation 与 reclaim。

### 13.5 Drizzle 只做 state/metadata PoC，不碰搜索核心

[Drizzle](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1) 支持 D1，也有 better-sqlite3 和 postgres.js adapter，可统一表定义、迁移和普通 CRUD。

但当前三宿主实现必须保留：D1 request-scoped session/batch/metrics、PG `COLLATE "C"`、原子 `putIfAbsent`、prefix cursor，以及 SearchIndex 的动态 SQL、query budget、advisory lock 和 canonical hydrate。

因此，若试验，只迁 StateStore 的普通 schema/feedback/annotation metadata；不要承诺 ORM 能替换 search scoring。预计净删仅 **80–180 行**，优先级低。

### 13.6 Default Store 增量专项审计

#### 13.6.1 增量与复杂度来源

`74c02ba..c4972b9` 在各 package `src` 中净增 **6,091 行**，在 `test/tests` 中净增 **3,592 行**，绝大部分是新的 deployment-level Default Store。以 Store 主链文件口径单独计数，约为 **5,677 行生产源码 + 3,393 行直接测试**；两组数字不同是因为前者还包含配置、宿主装配和其他同批改动。

| 层 | 代表文件 | 主链源码 |
|---|---|---:|
| core 状态机 + builtin | `objectStoreService/*`、`builtin/store.ts` | 2,164 |
| app route/token/S3 | `store.ts`、`routes/store.ts`、`storeRefToken.ts`、S3 adapter | 1,203 |
| 宿主 driver | R2 adapter + Node FS | 498 |
| SDK | management client + device upload | 961 |
| CLI + Dashboard | Store 命令 + StorePage | 851 |

最大单文件是 1,608 行的 `StoreService`。它的主要代码量并不是 HTTP 上传语法，而是下列安全/分布式契约：

- `store://default/<objectId>` 是稳定身份，不是 bearer，物理 driver key 不公开；
- owner 与 producer 分离，call upload 绑定 caller/device/callId/MIME/数量/字节上限；
- call/upload/share capability 可撤销或过期，只持久化 hash，不进 body、URL 或日志；
- 普通上传与 call 上传的 idempotency domain 隔离；
- object/session/capability/share 状态以 StateStore `compareAndSwap` 为权威；
- direct 只在已知精确 size 且能签 `Content-Length` + `Content-Type` + create-only 时开放；
- relay 逐块限额，越界 cancel，外部字节成功后才 CAS ready；
- cleanup 有界分页、持久化进度、竞争复查，绝不在共享 ObjectStore 里猜测 orphan。

这些都必须保留；不能因为代码多就将它们归类为“手写上传库”。

#### 13.6.2 P0/P1：先收敛客户端协议与 schema

| 动作 | 净删估算 | 判断 |
|---|---:|---|
| neutral `@tool-bridge/sdk/store` 供 SDK/CLI/Dashboard 共用 | **320–500 行生产源码** | 按两组审计中更保守的口径立项；同时修复 URI/descriptor/grant 校验漂移 |
| Store builtin 迁 Zod + HTBP OperationRegistry adapter | **50–90 行** | 适合作为全仓 schema/scope/dispatch 单一真源的首个试点 |
| 已有 Zod 对持久记录做 runtime parser | **15–50 行** | 只做小 PoC；净删低于 25 行就撤，且要保留滚动部署的未知字段 |
| CLI 复用仓内 MIME helper、Dashboard 抽 `formatBytes`、app route 小 helper | **25–50 行** | 可选；不为这些小面引新依赖 |

上述区间存在 parser/schema 重叠，不能相加。客户端 + builtin 的立项目标先按净删约 **380–590 行生产源码**记账；PoC 再用真实 diff 决定是否能接近独立客户端审计的 480–700 行乐观区间。测试只应合并重复 parser fixture，三端 adapter/output/DOM 契约和安全 wire 断言必须保留。

正确顺序是 canonical wire parser → Store builtin strict Zod → response/error/security schema → OpenAPI 对照。直接上 Hono RPC/openapi-fetch 不会自动获得严格运行时校验；当前动态 HTBP Help 只有 input schema 和文字 `returns`，也不足以生成权威 client。

#### 13.6.3 状态模型内部精简候选

这一层不需要新 npm 包，但需要比客户端收敛更强的 CAS/崩溃恢复证明：

- `UploadSession.attempts` 只初始化为 0，从未读取或递增；
- `UploadSession.idempotencyKeyHash` 只被计算并写入，真正幂等 lookup 使用独立 `IdempotencyBinding` key/fingerprint；
- `StoreCleanupCursors.driverObjects` 固定返回 null，没有 driver object scan；
- `StoreCleanupResult.deletedOrphans` 固定为 0，没有递增路径，与“不猜测 driver orphan”的安全约束一致。

这四项已有跨文件 `rg` 证据，可以小 PR 直接删除，预计净删 **15–30 行**。其他看似未使用的时间戳/审计/预期字段未纳入承诺，必须先证明滚动部署、对外 descriptor 和崩溃恢复不依赖它们。这一批是“删未实现的未来面”，不应趁机改动已生效的 capability 和 cleanup 语义。

更大但风险更高的候选是合并 1:1 `StoreObject`/`UploadSession`：当前 objectId 和 uploadId 各自随机生成，但一个 object 只对应一个 session，导致两份 expected 字段、两次 CAS、双向完整性检查和两路 cleanup scan。在对外协议仍保留 `uploadId`、token domain 与 object URI 的前提下，可 PoC `uploadId = objectId` 并将 session 字段并入 pending object record。这是可能的 **180–300 行生产源码 + 60–120 行 fixture/测试样板**净删，但只适合在持久化格式尚能版本化/迁移时做 P1 架构 PoC，不得直接重写现有 keyspace。必须保留 `complete×abort`、`complete×cleanup`、`delete×read/share`、idempotent begin replay 竞态，并证明“direct 字节已落地但 metadata CAS 未成功”能再次 complete 收敛。

可再小范围抽 typed `revisionedCollection`/`scanCleanupPage` helper，统一最多 32 次 get/parse/reducer/CAS 循环，并让 caller 显式选择 `must-retry` 或 `best-effort`；预计净删 **80–150 行**。但 helper 不得隐藏“外部 ObjectStore side effect 在 CAS 前还是后”的顺序，也不得把 object cleanup 的 delete/`bytesDeletedAt` 恢复逻辑塞进通用 CRUD。它与合并 object/session 高度重叠，收益不另行相加。

#### 13.6.4 开源候选的明确取舍

| 候选 | 能替换的层 | 净变化估算 | 结论 |
|---|---|---:|---|
| tus client/server | resumable wire | 当前 **净增 300–1,200 行** | 不作精简；只在弱网/大文件指标触发时做新能力 ADR |
| Uppy/TanStack Table/RJSF 改 StorePage | 选文件/上传 UI | 净增或微小 | 不采用；复杂度在 capability workflow，不在 UI primitive |
| AWS SDK v3 S3 | S3 REST/XML/presign | 可能净删 **90–180 行** | 只做同契约 PoC；`maxAttempts:1`、exact presign、S3-compatible、Workers bundle 和 device closure 必须过门 |
| AWS `lib-storage`/multipart | 服务端 multipart | 净增 | 不能替 Store 持久 session 与不可信客户端分片签名；不采用 |
| Apache OpenDAL | Node FS/S3 | 保留 R2/SDK/签名后仅约 50–180 行 | Node-only N-API、平台二进制约 54–84 MB、无 exact presign；拒绝 |
| unstorage | KV/object 抽象 | 净增 80–250 行 | 无 stream/ETag/CAS/presign/cleanup 契约；拒绝 |
| XState / `@xstate/store` / Effect | 进程内状态/编程模型 | 净增 | 不提供分布式 CAS 和外部字节副作用恢复；拒绝 |
| UploadThing/Transloadit | 托管上传数据面 | -500–+400 行且多一信任域 | 只有产品主动采购托管服务时做 build-vs-buy ADR |
| Node core stream + 仓内 FS primitive/Web stream bridge 复用 | FS stream pump 与 server/core/app/gateway 重复 | **100–190 行** | 不引第三方 atomic-write 库；必须保留 fsync、temp cleanup、`O_NOFOLLOW`、no-replace、cancel 与 backpressure |

结论：Store 专项的主线不是新增一个大型上传/存储库，而是用已有 SDK + Zod 收敛三端协议，再对 1:1 持久化模型做独立 PoC。按全链路审计去重后，近期合理的唯一口径是 **650–950 行生产源码 + 200–350 行测试样板**；并发/安全黑盒断言不在可删范围。此区间已主动留出重叠，不与报告其他 neutral client/schema 数字相加。

## 14. Knip 与测试基础设施的快速收益

Knip 初筛发现：

- 5 个 Dashboard shadcn UI 文件可能未使用；
- gateway/sdk/server 中若干 `@cfworker/json-schema`、MCP、aws4fetch 依赖可能未使用；
- plugin migrate/verify 辅助脚本有候选未引用文件。

但 Knip 对 CLI entrypoint、public exports、Wrangler virtual module 和构建脚本会产生假阳性。正确做法是：

1. 先补 Knip entry/project/ignore 配置；
2. 对每个依赖用 `rg`、build graph 和 package entry 验证；
3. 删除后跑 verify + build；
4. 不把“unused export”批量当作可删公开 API。

Provider 测试可以引入 MSW 或统一 fetch mock helper，替换 97 个文件各自的 stub/`sent()`/reply queue，预计删除 **2k–5k 测试样板**。它不减少生产 bundle，但能显著降低迁移成本。wire test 仍必须断言真实 method/URL/header/body，不能只 mock SDK 方法。

## 15. 明确不建议替换的代码

### 15.1 权限 matcher

scope matcher 只有约 73 行，却定义段级 `*`/`**`、deny-first、默认拒绝和复杂度上限。通用 glob 会额外支持 extglob、字符类和 escape，可能扩大授权语言。保留。

### 15.2 HTBP 树、Help 和路径语义

树 registry、自动 directory、owner、非空删除、完整 command path、JSON/DSL/Markdown 三表现和不可见 404 都是产品契约。Trie、模板引擎或通用 RPC 不会删除这些语义。

### 15.3 Canonical search/hydrate

当前搜索不仅是字符串匹配，还包括 D1/SQLite/PG 持久索引、CJK、revision cursor、last-known-good、canonical audit，以及每次结果重新检查 read/call/virtualize。Orama/MiniSearch 不能直接满足多实例强一致；Meilisearch/Typesense 会新增生产服务。除非产品主动改变部署模型，否则保留。

### 15.4 MCP bridge

已经使用官方 MCP SDK。剩余代码负责 modern/legacy 协商、Workers-safe schema validation、HTBP visibility/scope/virtualize 投影和结果映射。FastMCP 一类高层框架只会再套一层。

### 15.5 `plugin-sdk` 与 `guardedFetch`

`plugin-sdk` 拥有 plugin/v2 descriptor、OperationRegistry、authRef、fail-closed token、dedupe 和 TBError；Hono/Fastify 无法替代。`guardedFetch` 是 SSRF、逐跳 redirect、跨源 credential 剥离的安全边界；任何 HTTP client/SDK 都必须在它上面。

### 15.6 设备状态机与 Redis DeviceRouter

generation/TOCTOU、授权重验、presence、hibernation、reclaim、owner-safe lease 和跨副本 request-reply 都是领域正确性。当前底层已经使用 `ws`、PartySocket 和 Durable Object Hibernation；保留 core DeviceFrame/状态机不等于坚持手写底层网络库。Socket.IO/BullMQ/Redlock 不匹配现有 wire 与路由语义。

### 15.7 Store 状态机与 R2/FS ObjectStore 安全契约

StoreService 不只是“文件上传”：它使用 StateStore CAS 实现 owner/producer、幂等绑定、call quota reservation、可撤销 share、relay/direct complete、终态保留和有界 cleanup。任何 tus/S3 SDK/通用状态机都只能替换其中一层，不能接管这些权威语义。

R2 adapter 本身已很薄；FS 实现包含 root containment、防穿越/防 symlink、临时文件 + fsync + no-replace、ETag 条件写、delimiter/cursor 和 staging cleanup。通用 KV/文件库通常缺这些契约。可用 Node core stream API 局部减少手写 pump，但不得因此降级原子性和反穿越保证。

### 15.8 整体迁移到 React Admin、oclif 或外部搜索

这些方案会引入新的页面/命令/运维框架，而现有代码量主要来自领域行为，不是框架样板；大概率只是移动复杂性。

## 16. 三种可选实施情景

### 情景 A：保守、保持现有部署与 catalog

实施：

- Zod/OperationRegistry；
- neutral Store SDK、CLI/SDK/upload 收敛；
- Hono static 锁版 PoC、config/Helm 收敛与 Dockerfile 契约固化；
- provider HTTP client；
- generated neutral client；
- RJSF 管理表单；
- artifact 威胁模型评审、IP/S3 PoC；JOSE 只在评审后有明确收益时立项。

合理目标：净删约 **8k–15k 源码**，不改变 credential 所有权和部署拓扑。其中 Store 专项去重后约 650–950 行，已与 neutral client/OperationRegistry 的总体口径去重，不再叠加。维护收益高，数量级不如外置 catalog。

### 情景 B：混合 catalog

实施情景 A，并：

- 保留具有强领域投影、特殊安全或战略价值的原生 provider；
- 标准 SaaS provider 通过 OpenConnector proxy；
- 固定 action schema fingerprint 和 runtime 版本。

初步口径：毛删 **60k–100k tracked 行**，新增 adapter/契约测试/双部署编排 **4k–12k tracked 行**，对应净删 **48k–96k tracked 行**。该区间还没有计入双凭证控制面的长期人力/故障成本；ADR 必须带上凭证配置占比、轮换耗时、审计关联成功率、MTTR 和 RPO/RTO 基线。若 PoC 成功且运营预算可接受，这才是“代码大幅精简”与“保留核心差异化”之间的候选平衡点。

### 情景 C：完全外置 provider catalog

删除内置 provider 源码、wire tests 与迁移脚本，只保留 proxy adapter 和契约测试。理论毛删上限接近 **119k tracked 行**；若暂用同一 **4k–12k** 新增区间，净删的粗略上限约为 **107k–115k tracked 行**，仍必须由全外置 PoC 重算。

代价：Tool Bridge 不再拥有 provider credential/egress/action 运行时，产品边界发生根本变化。只有团队明确接受“Tool Bridge 是协议/权限/编排层，OpenConnector 是连接器运行时”时才成立。

## 17. 建议实施路线

### Phase 0：冻结度量和契约

- 保存各 package source/test LOC、bundle bytes 和依赖数；
- 固定 builtin/context/skillhub `~help` exact fixtures；
- 固定三入口 API/CLI/Dashboard/MCP 对等；
- 固定 provider 等价/形状/wire 三道闸门；
- 固定 authRef、redirect/SSRF、unknown field、error redaction；
- 选择 provider PoC 样本集。

### Phase 1：无遗憾收敛

1. Commander 单一错误路径；
2. CLI 复用 SDK device connection；
3. 三端共用 neutral Store client，同时只抽取 Store/Context 都需要的最低层 safe PUT；
4. next-themes 单一主题真源；
5. Zod env schema；
6. 保留两份服务 Dockerfile 的平台差异，固化互指注释/契约测试；
7. 先验证锁定 `@hono/node-server@1.19.14` 的 precompressed 语义，再决定 Hono static 迁移。
8. 删除 Store 中经跨文件读取证明未使用的持久化/返回字段，一字段一测试证明，不顺手改状态机。

### Phase 2：协议单一真源

1. 先用跨端 fixture 固定 Store URI/full-safe descriptor/grant/error redaction，修正现有 parser 漂移；
2. 落地 neutral `@tool-bridge/sdk/store` 子入口，先迁 Dashboard，再迁 CLI；
3. 给 OperationRegistry 增加 HTBP adapter，以 Store builtin 作为首个严格 Zod 试点；
4. 逐个迁其他 builtin/context/skillhub；
5. 定义其他固定控制面的 Zod/OpenAPI；
6. 生成 neutral client，迁 Dashboard/CLI/SDK 手抄类型和 HTTP；
7. Store 只在补齐 response/error/security schema 后再做 OpenAPI 对照，不用生成器替三阶段上传 workflow。

### Phase 3：Provider transport

1. 先固定 `createProviderHttpClient` 的中立接口和安全/wire 门禁；
2. 从同一基线建零依赖 A 组与 Ky（`retry: 0`）B 组；
3. 两组迁同一批 5–10 个简单 provider；
4. 分别用生产/测试净 diff、bundle、依赖数、Node/Workers build 和 wire test 决定选型；
5. 只合并获胜实现，再迁普通 REST；
6. GraphQL/multipart/特殊 query 留专用 adapter；
7. 同步建立统一 provider fetch test harness。

### Phase 4：生成与官方 SDK

1. GitHub、Linear 做头部 PoC；
2. 三个稳定 OpenAPI provider 做生成式 engine PoC；
3. effect/confirm、credential、错误继续人工声明；
4. 只有单 provider 的净 diff、bundle、Workers 均为正才合并。

### Phase 5：OpenConnector 架构试点

1. 建独立 adapter，不删原 provider；
2. 五类 credential/provider 对拍；
3. Node sidecar 与 Cloudflare service 两种部署；
4. 故障、升级、action drift、备份/恢复演练；
5. 报告毛删/新增/净删，并度量凭证双配置、轮换耗时、审计关联、MTTR 和 RPO/RTO；
6. 输出 ADR，选择 A/B/C 情景并明确双控制面的运营预算；
7. 只有 ADR 批准和契约全绿后才批量删除 catalog。

## 18. 每个替换 PR 的验收门禁

### 18.1 通用

- 净行数必须按生产源码、测试、生成物分开报告；
- 对比依赖数、bundle、cold start、构建时间；
- `pnpm verify`；
- 改 public package、依赖或打包配置时 `pnpm turbo run build`；
- 可发布 package 变更按 artifact ownership bump version；
- 不在未合入分支打 tag。

### 18.2 协议与权限

- JSON/Markdown/text Accept；
- 404 不存在/不可见顺序；
- TBError code/status/retryable；
- `cmd.path` 完整路径和裸 arguments body；
- scope deny-first、unknown field、secret 不泄露；
- API、CLI、Dashboard、MCP 对等。

### 18.3 Provider

- descriptor/catalog/help/schema 等价；
- authRef/SecretStore/providerConfig 分流；
- `guardedFetch` 是唯一内置 provider egress；
- redirect 不跨源携带敏感 header/body；
- `PLUGIN_TOKEN` 未配 fail closed；
- retry=0，除非单独证明幂等；
- wire fixtures 完全一致。

### 18.4 Dashboard/CLI/SDK

- profile/query cache/history 隔离；
- secret 不进 localStorage、URL、toast、错误；
- CLI 全局 option 位置和 JSON 输出；
- direct upload URL 不进错误；
- Store URI 严格为 22–64 位 base64url，read/share/complete 返回的 URI 必须与请求/grant 一致；
- Store descriptor 按 full/device-safe 白名单投影，未知字段不进 CLI JSON、Query cache 或 device handler；
- relay 只携 upload capability，direct PUT 不携 SK/call/upload credential，capability 路径显式 `credentials: 'omit'`；
- `alreadyCompleted` 不得重复 PUT，CLI `--out` 继续 create-only，share `$ref` 只由显式 share 命令交付；
- Device closed/ready/suspend/resume/generation 行为一致。

### 18.5 运行时与部署

- Node/Workers 双 build；
- D1/SQLite/PG contracts；
- S3/R2/FS object contracts；
- Miniflare/Node 设备测试；
- Helm standalone/HA golden render；
- Wrangler/S3/真实 hibernation 等外部资源验证每轮最多一次并留脱敏证据。

## 19. 候选依赖快照与选型意见

版本是 2026-08-25 的核验快照，不是自动升级授权。

| 候选 | 快照 | 用途 | 意见 |
|---|---|---|---|
| Ky | 2.0.2 / MIT | provider Fetch client | 与零依赖薄层做同样本对照 PoC，不作默认选型；强制 custom fetch、retry=0 |
| openapi-fetch | 0.17.0 / MIT | typed neutral/provider client | P0/P1 |
| `@hey-api/openapi-ts` | 0.99.0 / MIT | client/Zod/Query codegen | P2，锁精确版本 |
| `@hono/zod-openapi` | 1.6.1 / MIT | 服务端 OpenAPI | P1，与现有 Hono/Zod 对拍 |
| `jose` | 6.2.10 / MIT | JWS/JWE/JWT | 先做 artifact 威胁模型/格式 PoC，不默认迁移；cursor 默认 JWS/HMAC 而非 JWE |
| `oauth4webapi` | 3.8.7 / MIT | Provider OAuth primitives | P1/P2，安全 spike |
| `tus-js-client` / `@tus/server` | 4.3.1 / 2.4.4 / MIT | resumable upload 协议 | 当前净增 300–1,200 行；只由大文件/弱网指标触发新能力 ADR |
| `@aws-sdk/client-s3` | 3.1117.0 / Apache-2.0 | S3 client/presign | 默认不迁；只做 `aws4fetch` 同契约/产物 A/B PoC |
| `@bradenmacdonald/s3-lite-client` | 1.0.0 / MIT | 轻量 Fetch S3 client | 当前否决；signer 不签 Content-Length/Type，不满足 Store exact grant |
| Apache OpenDAL Node binding | 0.49.7 / Apache-2.0 | 统一 Node FS/S3 | 否决；Node-only N-API、54–84 MB 平台二进制、不能替 Workers/exact presign |
| Drizzle ORM | 0.45.2 / Apache-2.0 | D1/SQLite/PG schema/CRUD | P3，仅 metadata/store PoC |
| PartyServer | 0.5.10 / ISC | DO WebSocket lifecycle | P2，仅外围 glue |
| Socket.IO | 4.8.3 / MIT | Node 实时通信、房间与多副本 adapter | 不迁移现有设备协议；仅需求/宿主发生变化时重审 |
| Execa | 10.0.1 / MIT | 子进程 | P2，随 CLI init 重构 |
| `@oomol-lab/connector` | 1.1.0 / MIT | OpenConnector HTTP client | 架构 PoC，项目较年轻 |
| OpenConnector runtime | 当前活跃 / Apache-2.0 | 外置 provider catalog | 仅 ADR 级试点，锁 image digest |
| RJSF | 仓库已依赖 | schema-driven forms | 扩用，不新增体系 |
| ipaddr.js | 2.5.0 / MIT | IP parser | P1，只替 parser |

依赖引入前还需检查：npm provenance、Security Advisories、transitive licenses、Node 22/26、workerd、ESM、是否使用 eval/new Function、minified+gzip bundle 与退出成本。

OpenConnector 相关代码/迁移来源需要单独复核 Apache-2.0 的 NOTICE/归属要求；这不是法律意见，但不应只看仓库根 MIT 就略过上游许可。

## 20. 最终建议

建议批准以下方向进入 PoC：

1. **立即推进**：Zod/OperationRegistry、Commander 单一错误、neutral `@tool-bridge/sdk/store`、删除四个已证明的 Store dead fields、共享 env schema、主题收敛；Dockerfile 保留平台变体及现有互指契约，不以合并换 LOC；
2. **主线 PoC**：统一 provider HTTP 薄层 + 5–10 provider，必须做零依赖实现 vs Ky 同样本对照；Store object/session aggregate + typed CAS；其他固定控制面 OpenAPI + neutral client；RJSF system forms；锁定 Hono 1.19.14 的 static/precompressed 语义验证通过后再迁移；
3. **选择性 PoC**：GitHub/Linear 官方或生成 client、provider OAuth、S3、Wrangler provisioning；S3 默认保留 `aws4fetch`，AWS SDK v3 只做严格产物/契约对照；JOSE 退回 artifact 威胁模型论证，不预设三种 token 统一迁移；
4. **架构 PoC**：OpenConnector 混合 catalog，按毛删/新增/净删报告，并将双凭证控制面的运营指标写入 ADR；完成 ADR 前不删内置 provider；
5. **明确不做**：替换 HTBP、权限 matcher、canonical search、MCP bridge、plugin-sdk、guardedFetch、设备领域状态机；不用 tus/Uppy/OpenDAL/XState/Effect 整体替换当前 Store。

如果团队的第一目标是降低维护成本且保持产品边界，选择情景 A；如果第一目标确实是删除数万行并愿意接受第二个连接器运行时，重点验证情景 B。情景 C 的数字最好看，但它同时移走了 credential、egress 和 provider 执行的产品所有权，不应仅以 LOC 决策。

## 21. 主要参考资料

- [OpenConnector 仓库](https://github.com/oomol-lab/open-connector)
- [OpenConnector Runtime API / MCP / OpenAPI](https://github.com/oomol-lab/open-connector/blob/main/docs/runtime-api.md)
- [OpenConnector 配置与安全策略](https://github.com/oomol-lab/open-connector/blob/main/docs/configuration.md)
- [Connector SDK](https://github.com/oomol-lab/connector-sdk)
- [Ky](https://github.com/sindresorhus/ky)
- [openapi-fetch](https://openapi-ts.dev/openapi-fetch/)
- [Hey API OpenAPI TypeScript](https://heyapi.dev/docs/openapi/typescript/get-started)
- [Hono RPC](https://hono.dev/docs/guides/rpc)
- [Hono Zod OpenAPI](https://hono.dev/examples/zod-openapi)
- [Hono Node Server](https://github.com/honojs/node-server)
- [RJSF](https://github.com/rjsf-team/react-jsonschema-form)
- [JOSE](https://github.com/panva/jose)
- [oauth4webapi](https://github.com/panva/oauth4webapi/blob/main/docs/README.md)
- [Drizzle Cloudflare D1](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1)
- [PartyServer](https://github.com/cloudflare/partykit/blob/main/packages/partyserver/README.md)
- [Cloudflare Wrangler automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Execa](https://github.com/sindresorhus/execa)
- [ipaddr.js](https://www.npmjs.com/package/ipaddr.js)
- [Zod JSON Schema](https://zod.dev/json-schema)
- [tus resumable upload protocol](https://tus.io/protocols/resumable-upload)
- [tus Node server](https://github.com/tus/tus-node-server)
- [Uppy uploader selection](https://uppy.io/docs/guides/choosing-uploader/)
- [AWS SDK v3 S3 迁移与 streaming](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-s3.html)
- [Cloudflare R2 上传与 presigned URL](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [`@bradenmacdonald/s3-lite-client`](https://github.com/bradenmacdonald/s3-lite-client)
- [Apache OpenDAL Node.js binding](https://opendal.apache.org/bindings/nodejs/)
- [XState persistence](https://stately.ai/docs/persistence)
- [Node.js file system streams](https://nodejs.org/download/release/v22.16.0/docs/api/fs.html)
- [Node.js `stream.pipeline`](https://nodejs.org/api/stream.html)

## 22. 情景 A 完整实施结果（2026-08-25）

> 实施基线：`main@c4972b99043891d75671fb58d7e6d4c7297894da`。实施分支在开始时与
> `main` 为 `0/0`，因此下文的源码差异都以该提交为唯一基线。
>
> 实施范围：情景 A，即保留内置 provider catalog、现有 credential ownership、Node/Workers
> 双宿主和当前部署拓扑；Phase 5 OpenConnector 属于情景 B/C 的架构试点，不在本轮实施范围。
>
> 验收状态：生产重构、候选 PoC 与最终串行门禁均已在同一工作树固定点完成；本附录记录最终实测，
> 不把较早的局部绿灯、候选生成物或毛删除量当成完成证据。

### 22.1 实施结论

情景 A 已按“先建立单一真源，再删除消费者副本；候选只有通过安全、wire、产物和净收益门禁才进入生产”
落地。最终结构不是把自研代码机械换成更多依赖，而是：

```text
                       core Zod / HtbpCommandRegistry
                         │              │
             fixed wire + OpenAPI       └── builtin / Context / Skillhub
                         │
                         ▼
              @tool-bridge/sdk/client
                    │             │
                   CLI        Dashboard

Store wire + transport + upload + management client
                         │
                         ▼
               @tool-bridge/sdk/store
                 │        │        │
               device    CLI   Dashboard

普通 JSON REST provider
                         │
                         ▼
          zero-dependency createProviderHttpClient
                         │
                         ▼
        guardedFetch（唯一 egress、逐跳 redirect、SSRF policy）
```

主要结果：

1. Store 的 wire、响应白名单、错误脱敏和 relay/direct/complete 上传编排已收口到
   `@tool-bridge/sdk/store`；CLI、Dashboard 和 device 不再各维护一套协议实现。
2. 九个 builtin 模块、七个 Context 命令、五个 Skillhub 命令已使用同一
   `HtbpCommandRegistry` 生成 strict Zod 校验、scope、Help metadata 与 dispatch。
3. 固定控制面已有 Zod wire 真源、OpenAPI 3.1 投影和宿主中立
   `@tool-bridge/sdk/client`；CLI 与 Dashboard 已迁移。生成式 runtime client 的 PoC 因运行时验证、
   greedy path、安全默认值和高阶语义缺口被拒绝。
4. provider transport 已完成全 catalog 的普通 JSON REST 迁移：88 个 transport 文件使用共享
   `providerHttp`，只剩 14 个有明确协议理由的 raw `guardedFetch` 文件、18 个调用，并由机器可验的
   allowlist 锁住。
5. Dashboard 已使用现有 RJSF/AJV 作为唯一 schema-form runtime、使用 `next-themes` 作为唯一主题真源，
   并删除已证明未使用的 UI 文件。
6. Node/Workers/device 环境变量解析已收敛到 core Zod；Hono static、Helm schema、Dockerfile 合并等
   候选经 PoC 后没有为了形式统一而迁移。
7. 设备反向注册保留 raw WebSocket wire、PartySocket、Durable Object Hibernation、Node `ws` 与
   generation/presence/reclaim 权威状态机；CLI 只复用 SDK connection supervisor。Socket.IO 与
   PartyServer 均未进入生产。

这轮确实减少了重复，但**没有达到原报告对情景 A 的 8k–15k 生产源码估算**。以当前工作树全部
tracked + untracked 正式文件重新计算，生产 TS/TSX 净删 **1,675 行**。原因不是迁移只做了样例：
provider 普通 REST 已全量迁移，CLI/Dashboard 的副本也确实删除；差额来自此前估算低估了单一真源必须新增的
运行时校验、安全适配、neutral packaging、跨端契约测试和发布门禁。该结果比用生成物、弱化校验或删除测试
凑出 8k–15k 更符合本报告的安全前提。

### 22.2 Phase 0：度量与契约冻结

| 原计划 | 实施结果 | 证据 |
|---|---|---|
| 固定源码/测试/产物基线 | 完成。源码基线为 138,535 行 TS/TSX；provider 源码 82,791 行、测试 35,576 行；另建同 commit 的干净 worktree 作为最终产物对照 | §3；最终 bundle/cold-start/build 对照见 §22.10 |
| 固定 builtin/context/skillhub Help | 完成。迁移前既有 exact fixture 保留，另增加 registry/Help/strict unknown-field 回归 | `packages/core/test/builtin/*`、`context/commands.test.ts`、`skillhub/*.test.ts` |
| 固定控制面 wire | 完成。Help、Tree、Search、Feedback、OAuth、health/liveness/readiness、registry 与动态 invoke 都有 Zod/runtime tests | `packages/core/test/protocol/`、`packages/sdk/test/client/` |
| 固定 Store 跨端 wire | 完成。合法/非法 URI、full/device-safe descriptor、grant、read/share、URI 一致性和 secret 字段都有共享 parser 测试 | `packages/sdk/test/storeClient.test.ts`、`storeUpload.test.ts`、Dashboard/CLI Store tests |
| 固定 provider 三道闸门 | 完成。descriptor/catalog/schema 仍由既有 generation hash 与 wire suite 锁定；真实请求继续断言 method/URL/header/body | 99 个 provider generation hash；`packages/plugins/test/providers/` |
| 固定安全下界 | 完成。unknown field、authRef、PLUGIN_TOKEN fail-closed、redirect/SSRF、错误脱敏、retry=0 均有回归 | core/app/plugin/provider runtime tests |
| 选择 provider 样本 | 已从同样本 PoC 扩展到全量普通 JSON REST，不以 5–10 个演示 provider 代替完成态 | §22.5 |

Phase 0 的度量口径在实施后继续沿用：生产源码、测试、生成物、配置/脚本、文档分别报告；第三方
bundle 与源码行数不互相替代。

### 22.3 Phase 1：无遗憾收敛

#### 22.3.1 Commander 单一错误路径

- CLI 当前仍有 79 个 `.action(...)`，但 `packages/cli/src` 中 `guard(...)` 调用已从重复包裹降为 **0**。
- action 直接 reject，由 root `parseAsync` 的统一 catch 处理 Commander help/version、`CliError`、JSON 输出和
  未知异常。
- root/group/leaf 全局选项位置、`--` 后参数、help/version 和退出码继续由参数契约测试覆盖。
- 没有迁移到 oclif/yargs/citty；业务 handler 仍是主要体积，换 CLI framework 不会带来净收益。

#### 22.3.2 CLI 复用 SDK device supervisor

- `packages/cli/src/deviceRuntime.ts` 已调用 SDK 的 `openPortableDeviceConnection()`；CLI 只保留 shell/fs
  provider、daemon/signal 和 CLI 输出适配。
- heartbeat、重连、connection timeout、credential refresh、suspend/resume 与 ready/closed 状态只有 SDK
  一套实现。
- raw `DeviceFrame`、hello/call/result/cancel、requestId 幂等和 generation 语义未改变。

#### 22.3.3 Store 单一真源与状态层小步精简

新增的 `@tool-bridge/sdk/store` 分为四层：

- `wire.ts`：严格 URI、descriptor、page、read/share/create grant 的 Zod parser 与白名单投影；
- `transport.ts`：HTTP(S) base URL、`credentials:'omit'`、TBError、network/abort 与 secret redaction；
- `upload.ts`：create → relay/direct PUT → complete 的唯一状态机，同时支持 rotating SK、device call
  capability、Web/Node stream 和 AbortSignal；
- `client.ts`：stat/list/read/download/share/revoke/delete 管理面。

CLI、Dashboard、SDK management facade 和 device upload 都复用上述实现。具体修复包括：

- 所有客户端统一只接受 22–64 位 base64url `store://default/<objectId>`；
- descriptor 不再补默认值或静默丢损坏字段，未知/敏感字段不进入 CLI JSON、Query cache 或 device handler；
- read/share/complete 返回 URI 必须与请求/grant 一致；
- relay 只携 upload capability，direct PUT 不携 SK/call/upload credential，所有 capability 请求显式
  `credentials:'omit'`；
- direct credential provider 必须包含 `Authorization`，但拒绝 Cookie、Cookie2、Proxy-Authorization 与所有
  `x-tb-*` 权威头，避免第三方 credential callback切换身份域；
- Store 的 bearer/relay/read/share URL 统一经 `resolveStoreRequestOrigin()`：正常多域名访问保留本次 alias
  host；Node 在 TLS 终止代理后只用已校验的 `TB_CANONICAL_ORIGIN` 恢复可信 protocol，不读取可伪造的
  `X-Forwarded-Proto`，也不复制 canonical host。真实 `@hono/node-server` 明文 socket + Host override 回归
  已固定 `http://public-alias` 必须签成 `https://public-alias`；
- `alreadyCompleted` 不重复 PUT；CLI `--out` 仍用 create-only 文件语义，显式 share 命令仍是唯一会交付
  `$ref` 的命令。

状态层没有引入 XState/Effect/通用 Store framework，而是采用现有 Zod：

- 五类 persisted record 对所有已知字段 fail-closed 校验；使用 loose object 保留未来未知字段，满足滚动部署；
- 增加统一 `compareRecord()`，强制 revision 只递增 1，再调用现有 StateStore CAS；
- 删除四个已证明没有读路径的字段：upload `attempts`、`idempotencyKeyHash`、cleanup
  `deletedOrphans` 与 `driverObjects`；
- Store/Context 只共享最低层 body stream/safe PUT primitive，没有把两套身份与 lifecycle 强行合并。

object/session aggregate PoC **没有合入**。隔离实现已通过 strict typecheck 与 10/10 行为测试，但真实计量
并不支持“聚合即可净删”的假设：现状可比实现为 448 physical / 439 code LOC，aggregate 稳态为
278 / 248，迁移 adapter 本身又是 285 / 259，另需 165 行兼容测试；rolling deployment 期间 production
反而增加 115 physical / 68 code LOC，连同迁移测试的总体净增约 160–220 physical LOC。更关键的是现有
object/session/capability 三 key 的逐 key CAS 无法给旧/新格式双写提供原子提交，混跑进程会留下可观察的
部分状态。因此只在未来安排维护窗口、禁止旧进程写入后才值得重新评估，不把一次性迁移成本藏在稳态数字里。

#### 22.3.4 Dashboard、环境变量与 dead-code 基线

- `next-themes` 的 `ThemeProvider` 现在是主题 storage/DOM class 的唯一真源，自研 `lib/theme.ts` 已删除。
- 新的 `SchemaFields` 和唯一懒加载 `SchemaFormRenderer` 统一 RJSF/AJV、字段白名单、翻译和 unknown-field
  stripping；registry/mount/plugin/SK/integration 表单消费同一字段模型。
- StorePage 没有被错误改造成 schema CRUD；它继续使用适合二进制传输、share capability 和 destructive
  action 的专用 UI。
- core `parseRuntimeEnv()` 统一 server/gateway/device 的正整数、端口、TTL clamp、allowlist、canonical
  origin 和 Store 配置。历史“非法值回默认”、`TB_PORT=0` 保留；`TB_MAX_HOPS` 的正小数现统一向下取整。
- 引入精确版本 `knip@6.32.2` 作为未使用文件/依赖门禁，并显式配置 public exports、Wrangler virtual
  modules 与 bundle ownership。它实际发现并删除 CLI `paths.ts`、Dashboard `checkbox.tsx` 等 dead files；
  public export 不因 Knip 的仓内引用结果而批量删除。

### 22.4 Phase 2：协议单一真源与 neutral client

#### 22.4.1 `HtbpCommandRegistry`

新增的通用 registry 让一条 `.register()` 同时拥有：

- strict Zod input schema；
- scope；
- Help 的 description/input/output/effect/confirm/returns；
- runtime handler 与统一错误映射。

在其上建立 `BuiltinCommandRegistry`，并完成九个 builtin 模块（annotation、catalog、federation、plugin、
registry、secret、sk、status、store）、七个 Context 命令和五个 Skillhub 命令的迁移。原先的手写
JSON Schema、scope 表、`switch(cmd)` 与分散的 `require*` 校验不再是并行真源。

有意保留的兼容层很小：例如未知 builtin command 的既有错误文案、Context write/update 和 Skillhub
publish 的高信息量错误。它们是公开错误契约，不是应为了行数删除的重复。

#### 22.4.2 固定控制面的 Zod/OpenAPI 真源

`packages/core/src/protocol/wire.ts` 定义固定请求/响应与 TBError 的运行时 schema；
`packages/core/src/protocol/openapi.ts` 从同一 Zod 真源投影 OpenAPI 3.1。目前 artifact 包含：

- **13** 个 path；
- **16** 个 operation；
- **19** 个 component schema；
- **10** 个 `x-tool-bridge-greedy-path`；
- `POST /{path}/~register`，body 是 `NodeInput`、返回 `RegistryNode`；
- 动态 `POST /{commandPath}` 保持裸 arguments body，没有引入 `{tool,arguments}` envelope。

OpenAPI 首次 characterization 发现动态 JSON schema 使用 `true` 不符合工具链预期；改成标准 Schema Object
`{}` 后 Redocly 结构错误为 0，重复生成 hash 稳定。`RegistryNode` 还增加了对 core `TreeNode` key 的
编译期穷尽检查，避免新增字段被手写 Pick 静默遗漏。

#### 22.4.3 `@tool-bridge/sdk/client`

SDK 新的 neutral client 被 CLI `http.ts` 与 Dashboard `lib/api.ts` 共同消费，统一：

- 每请求读取轮换 SK，且调用者不能覆盖 Authorization；
- `credentials:'omit'`、`redirect:'error'`、timeout/caller cancellation 区分；
- TBError 7 码、状态 fallback、network code 白名单和错误脱敏；
- JSON/Markdown/text 协商、readiness 503 领域语义和可选 response validator；
- logical TreePath 的逐段编码，以及 raw request path 对 `..`、编码斜杠/反斜杠、CRLF、query/fragment、
  malformed percent 的 fail-closed 拒绝；
- `registerNode(input)` 只从已校验 `input.path` 派生 URL，避免 URL path 与 body path 漂移。

SDK root、`./device`、`./client`、`./store` 有独立 public exports。三个 Web-standard 子入口使用同一
neutral tsup build 和 shared chunks；打包 verifier 会递归扫描直接入口与 shared JS/d.ts closure，禁止
Node builtin、Hono、private workspace 或意外 external 依赖藏进 neutral 产物。

#### 22.4.4 为什么没有把 runtime client 交给 code generator

`openapi-typescript@7.13.0 + openapi-fetch@0.17.0` 的隔离 PoC 可以构建 Node/browser/Workers，也生成了
1,756 行类型，但没有通过等价门禁：

1. OpenAPI 普通 path parameter 会把 HTBP greedy path 的 slash 编码掉，vendor extension 不生成 runtime
   serializer；
2. response 只有 TypeScript 断言，没有 Zod runtime validation，畸形 TBError 与额外 secret 会原样通过；
3. 默认是 `redirect:'follow'`、`credentials:'same-origin'`，仍要重写安全 adapter；
4. readiness 503 被当成普通 error；
5. `~register` 的 URL/body path 可独立传入；
6. timeout、轮换 SK、错误脱敏和高阶表示协商仍需保留。

公平口径下，纯生成 runtime 是 6,571 raw / 2,605 gzip bytes，但不是等价实现。把现有 19 个 Zod
validator 拉回后是 339,084 / 68,463 bytes，完整手写 client 是 343,677 / 69,438 bytes，仅少约
4.6 KiB raw / 1.0 KiB gzip，尚未补齐上述领域逻辑。故正式依赖和 1,756 行生成物均未进入仓库；保留
“Zod 真源 → OpenAPI artifact + 薄手写高阶 client”。

### 22.5 Phase 3：provider transport 全量迁移

#### 22.5.1 最终共享边界

`packages/plugins/src/_runtime/providerHttp.ts` 是 393 行的零额外依赖实现。它统一：

- base URL 与相对 path、重复 query key、JSON/body 互斥；
- JSON/text/empty/invalid-JSON decoder；
- accept-status 与 provider-specific error/transport hook；
- timeout、网络错误、上游错误和稳定 `TBError`；
- 从 header/query/JSON credential-like 字段收集 secret，并对原值、URL 编码、JSON escape、Basic decode
  形态脱敏；
- 强制经过 `createGuardedFetch()`，不提供 request 级裸 fetch 逃生口；
- retry=0，redirect 仍由 `guardedFetch` 逐跳处理。

薄层实际超过原先“约 100 行”的占位目标，因为原估算没有包含完整的 secret redaction、timeout 分类、
invalid JSON、动态 base URL 与特殊 error hook。即便如此，全量迁移仍取得生产净删。

#### 22.5.2 全 catalog 结果

| 指标 | 基线 | 当前 | 变化 |
|---|---:|---:|---:|
| provider transport 文件 | 97 | 97 | 范围不变 |
| raw `guardedFetch` 文件 | 97 | **14** | -83 |
| raw `guardedFetch` 调用 | 106 | **18** | -88 |
| 引用 `createProviderHttpClient` 的文件 | 0 | **88** | +88 |
| 普通 JSON REST 的 raw 直调 | 大多数文件 | **0** | 全部迁移 |

其中 83 个文件完全迁入 `providerHttp`；另有 5 个 mixed adapter 的 JSON 路径迁入共享层，二进制/流/
multipart 等路径保留 raw 调用。14 个例外通过 `provider-http-exceptions.json` 逐项登记文件、类别、理由和
精确调用数：binary 3 文件/4 调用、form 3/3、GraphQL 2/2、mixed 3/6、multipart 1/1、signed 1/1、
stream 1/1。architecture policy test 会在新增 raw 调用、文件或调用数漂移时失败。

插件净 diff：

| 口径 | 增加 | 删除 | 净值 |
|---|---:|---:|---:|
| production `packages/plugins/src` | 2,885 | 4,893 | **-2,008** |
| tests `packages/plugins/test` | 2,032 | 4,913 | **-2,881** |
| 合计 | 4,917 | 9,806 | **-4,889** |

96/98 个 provider test 文件直接复用 143 行的 `createProviderHarness`；其余特殊测试可保留专用 fixture。
该 harness 只收敛 plugin/v2 envelope 和 fetch queue，请求仍穿过真实 plugin handler、schema、credential
decode 与 `guardedFetch`，所以没有用 mock SDK 方法换掉 wire 断言。provider 子系统最终局部验证为
109 个测试文件、4,028 个测试通过，99 个生成 hash一致。

#### 22.5.3 零依赖 vs Ky

Ky 的 A/B 对照没有证明额外净收益。可复跑 PoC 选择 Brave、Resend、Airtable、Todoist、Trello、GitHub、
Vercel、Dropbox 8 个真实 provider 与 3 个 runtime 边界，共 11 fixtures/35 assertions；A/B 的 method、
URL、headers、body、decoder、TBError、redaction、redirect 与传输次数全部等价，503/network 都只调用一次。
但做到等价必须保留完整 `createProviderHttpClient + guardedFetch`，关闭 Ky retry/timeout/HTTPError/decoder；
provider callsite 净删 0，反而新增 34 物理行/23 逻辑行 adapter 和一个依赖。同条件 esbuild 产物从
22,566 raw/7,629 gzip 增至 43,359 raw/14,508 gzip，即 **+20,793 raw / +6,879 gzip bytes**。因此正式
实现选择零依赖 `providerHttp`，没有把 Ky 写入 package manifest 或 lockfile。

该结论只归因于当前安全/协议约束，不是对 Ky 通用价值的否定；如果未来需要它的 hook/retry/timeout 默认语义，
必须重新做同样本、同 wire 的净 diff，而不能把这轮共享层的删除量归功于 Ky。

#### 22.5.4 同轮安全收敛

- `guardedFetch` 按 Fetch 语义处理 redirect：301/302 只把 POST 降为 GET，303 只降级非 GET/HEAD，
  307/308 始终保留 method/body；降级时删除 body 内容头。跨源 redirect 默认 fail closed，允许策略下也会
  剥离 credential-like headers。
- `providerHttp.timeoutMs` 覆盖 fetch、响应体读取和 JSON decode 的完整 deadline，而不只等响应头；超出
  可移植 timer 上限 `2,147,483,647 ms` 的值 fail closed，任何路径仍只调用一次 transport。
- `ipaddr.js@2.5.0` 只接管 IPv4/IPv6 grammar、mapped-address 归一；blocked range 与 fail-closed policy
  仍由仓库显式维护。它是本轮唯一新增的生产第三方 runtime dependency。
- provider OAuth 的 fetch 改为宿主显式注入的 `createGuardedFetch({crossOriginRedirect:'error'})`；没有注入时
  fail closed。网络错误、错误 body 与 200-invalid-envelope 都不再透传上游 secret/URL。

### 22.6 Phase 4：生成式与官方 SDK 的真实决策

Phase 4 的目标是“只有净 diff、bundle、Workers 和 wire 同时为正才合并”，不是强制至少选一个官方 SDK。
本轮结果如下：

| 候选 | 关键实测 | 生产决策 |
|---|---|---|
| GitHub `@octokit/rest@22.0.1` | 预计 authored 净删 350–700 LOC，但 min+gzip 增加 12,736 B，安装闭包 18 包；145 个 action 投影、effect、错误与特殊 status 仍在 | 拒绝 |
| Linear `@linear/sdk@91.0.0` | high-level client 无 custom fetch；low-level 仍要手写 GraphQL transport；Workers/browser 因 `crypto` 失败，min+gzip 增加 122,578 B | hard reject |
| Stripe OpenAPI | 18 ops 裁剪后生成 15,010 LOC；等价 authored adapter 仅 -33 到 +7 LOC | 拒绝 |
| Sentry OpenAPI | 19 ops 生成 3,233 LOC；分页/alias/normalizer 后 authored 仅净删 19–59 LOC | 拒绝 |
| Cloudflare DNS OpenAPI | 8 ops 生成 1,700 LOC；HTTP 200 + `success:false` 仍需 runtime envelope 校验，authored 仅净删 21–51 LOC | 拒绝 |
| 三个 OpenAPI 样本合计 | tracked generated 路线净增约 19,948–20,058 LOC；不 tracked 则新增 32 包 build closure 且 runtime validation 不减少 | 拒绝 |
| `openapi-fetch` provider 核心 | 相对零依赖 `providerHttp` 增加 1,914 min / 771 gzip bytes，只提供编译期 path type | 拒绝 |
| `oauth4webapi@3.8.7` | custom fetch、PKCE、零 retry 通过；但 exact Basic/form/Content-Type、任意 201、缺 token_type、responseEnvelope/custom token type 与现有兼容契约不同 | 拒绝直接迁移；保留现有 OAuth 骨架并加强 egress/redaction |
| JOSE 全面统一 | ref 只需完整性，OAuth state 必须保密，cursor 默认只需防篡改；三者威胁模型和迁移窗口不同 | 不迁移；保留域分离 HMAC/AES-GCM |
| Zod Mini | 当前 wire/OpenAPI/registry 依赖完整 Zod 的 registry、JSON Schema 与现有 API；拆成双 Zod 面没有可靠净 bundle 收益 | 拒绝 |
| AWS SDK v3 / XML parser | `@aws-sdk/client-s3@3.1117.0` 的业务 wire、exact presign、stream、`maxAttempts:1`、device closure 均过；Workers/browser gzip +80,716 B，但 strict-neutral 因 11 个 `node:*` import 构建失败，且 339→233 LOC 只净删 106 行；`fast-xml-parser@5.11.0` 下界另增 20,802 gzip | 拒绝；保留 `aws4fetch@1.0.20` 与窄 XML parser |

官方 SDK/OpenAPI PoC 的数值不能与 provider HTTP 的 `-2,008/-2,881` 再相加：它们瞄准的是同一批
transport 文件。被拒绝的 generated LOC 也只报告为实验产物，未计入正式源码。

### 22.7 Dashboard、运行时与部署结果

#### 22.7.1 Dashboard

- 固定控制面调用统一走 `@tool-bridge/sdk/client`；Store management/data plane 统一走
  `@tool-bridge/sdk/store`。
- RJSF catalog 覆盖 registry kind、mount config、catalog integration、plugin manifest、managed
  credential 与 SK 表单；credential 仍通过 authRef/SecretStore，不进入 providerConfig。
- 表单只投影声明字段，`additionalProperties:false + omitExtraData + liveOmit` 防止隐藏/未知字段回写。
- profile/query key/history 隔离、secret 不进 localStorage/URL/toast、短期 share/read/upload 结果的 cache
  生命周期继续由现有 tests 固定。
- 删除旧的 node-local SchemaFormRenderer、自研 theme store，以及 card/checkbox/popover/scroll-area/
  separator/switch 等已证明无引用的 UI 文件。

#### 22.7.2 Hono static

锁定的 `@hono/node-server@1.19.14` characterization 已进入 server 测试：裸 `br`/`gzip`、HEAD、Range、
prefix/fallback 可工作，但存在以下 hard gaps：

- 不解析 `gzip;q=1` 等 q-value；
- identity response 不设置 `Vary: Accept-Encoding`；
- 没有 representation ETag/304；
- 没有当前 hash asset/index 所需的 Cache-Control。

因此保留 172 行 `packages/server/src/assets.ts`。如果在 Hono middleware 外补齐上述逻辑，主要语义和测试
仍是自有，无法兑现原 90–130 行净删；本轮不迁移，也不改变现有静态资源行为。

#### 22.7.3 Helm、Dockerfile 与 provisioning

- 完整 Helm `values.schema.json` PoC 为 241 行；当前领域 guard 只有 28 行。保留领域错误时净增 241 行，
  删除 guard 也净增 213 行且错误信息退化，因此 schema 只留在 `.llmdoc-tmp/`。
- standalone/HA golden render 在候选 schema 前后逐字一致，但这只证明兼容，不构成净收益。
- `Dockerfile` 与 `Dockerfile.railway` 继续保留：唯一差异 `VOLUME /data` 是裸 Docker 与 Railway Metal
  builder 的平台契约；已有互指注释和 contract test。`Dockerfile.cli` 是不同 artifact，不属于副本。
- 没有为了本轮减码改写现有 Wrangler provisioning、引入 Execa 或新增必须的外部部署服务；既有 D1/R2
  provisioning 和部署测试继续保留。

#### 22.7.4 正式依赖变化

| 类型 | 变化 |
|---|---|
| 生产 runtime | `packages/plugins` 新增精确 `ipaddr.js@2.5.0`；`next-themes`、RJSF、Zod、Hono、Commander、PartySocket 等均为已有依赖的扩用 |
| 开发/分析 | root 新增精确 `knip@6.32.2`，Node engine 下界同步为 `>=22.12` |
| 未进入正式依赖 | Ky、openapi-fetch、openapi-typescript、Octokit、Linear SDK、oauth4webapi、jose、PartyServer、Socket.IO、AWS SDK、fast-xml-parser、tus/Uppy、OpenDAL、XState/Effect |

### 22.8 设备反向注册最终结论

用户提出的 Socket.IO 方向已经按 Node、Cloudflare DO Hibernation、neutral SDK/RN、多副本和 raw wire 六个
维度复核。结论仍是：**稳定现状不迁 Socket.IO；最有价值的重构是 CLI/SDK supervisor 去重，已经完成。**

Socket.IO 不适合作为本轮替代的原因：

1. Socket.IO 是 Engine.IO + Socket.IO 协议，不是 raw WebSocket；现有 CLI/SDK/设备端不能保持 wire 兼容，
   必须双栈或同步升级。
2. 官方没有 Workers/Durable Object hibernation server adapter；Engine.IO session、namespace 和 adapter state
   在休眠后如何恢复仍需自写，等于重造当前最难的部分。
3. Redis adapter 的 room/broadcast/ack 不提供 `deviceId→replicaId` TTL、owner-safe compare/delete、保守
   reclaim 或 generation arbiter；跨副本双连接窗口反而可能把 call 广播给两条连接。
4. connection-state recovery 不能替代每次 wake/invoke 的授权重验、requestId 幂等、cancel、迟到 result 和
   TOCTOU 复核。
5. 完整迁移会触碰约 2,774 行核心源码；Node 侧可能局部净删 250–400 行，但 Workers 与客户端双栈会使全局
   第一阶段净增。

PartyServer 是更贴近 DO lifecycle 的局部候选，但它只能接管 WebSocketPair、attachment、hibernating callback
和 alarm 胶水，不能接管 hello/generation/reverify/presence/reclaim/result；预计净删仅 70–120 行，且当前没有
通过真实 hibernation canary，所以未合入。Node 侧也不为 30–60 行胶水单独升级到 Hono v2 WS helper。

保留的不变量：

- raw DeviceFrame 与 `/system/device/ws`；
- generation/active connection 顶替、await 后 TOCTOU 复核；
- online/stale/offline/presence/reclaim；
- requestId 幂等、deadline、cancel、迟到结果；
- 每次 invoke/hibernation wake 的凭据与 register 权限重验；
- Redis owner-safe route lease 和故障时“宁可晚删、不可错删”。

### 22.9 最终代码量：毛删除不等于净删除

以下数字以 `main@c4972b9` 与起草时工作树比较，**包含正式 untracked 新文件，排除
`.llmdoc-tmp/` PoC/cache**；文本行按 Git numstat + 新文件物理行计算。

#### 22.9.1 生产源码（`packages/*/src/**/*.{ts,tsx}`）

| Package | 基线 | 当前 | 净变化 |
|---|---:|---:|---:|
| app | 8,565 | 8,586 | +21 |
| cli | 7,665 | 6,893 | **-772** |
| core | 13,535 | 14,149 | +614 |
| dashboard | 19,152 | 18,309 | **-843** |
| gateway | 1,570 | 1,482 | **-88** |
| plugin-sdk | 726 | 726 | 0 |
| plugins | 82,791 | 80,701 | **-2,090** |
| sdk | 2,138 | 3,400 | +1,262 |
| server | 2,393 | 2,321 | **-72** |
| **合计** | **138,535** | **136,567** | **-1,968** |

按 diff 方向，生产源码是 `+11,216 / -13,184 = -1,968`。core 与 SDK 的增长是有意的集中：它们新增
command/wire/OpenAPI/neutral client 单一真源；CLI、Dashboard、provider 与宿主消费者删除副本。不能只列
消费者毛删除而不计真源新增。

#### 22.9.2 测试、生成物、配置与文档

| 口径 | 增加 | 删除 | 净值 | 说明 |
|---|---:|---:|---:|---|
| 正式测试源码 | 5,974 | 5,225 | **+749** | provider 测试净删 2,881 行，被新增的跨端、安全、路径、发布、字节预算和 characterization tests 抵消 |
| 生成式测试 fixture | 110 | 0 | **+110** | 固定控制面 OpenAPI/wire golden；不进入 production bundle |
| tracked/generated production code | 0 | 0 | **0** | OpenAPI 由 Zod 投影；不提交 codegen client/provider 类型 |
| manifest/lock/build/release/config | 1,182 | 138 | **+1,044** | neutral build、Knip、exports、release verifier 和 lockfile；不是生产源码 |
| 正式审计文档（附录前） | 978 | 0 | **+978** | 本报告是用户要求的交付物，不计入源码精简 |
| `.llmdoc-tmp` PoC/generated | 不计 | 不计 | 不计 | 临时证据，不发布、不进入知识真源 |

测试没有被当成待删负担。provider harness 删除了大量重复 fixture，但新的 strict schema、路径逃逸、credential
authority、Store capability、release tarball closure 等断言补足了原本缺失的安全证据，所以全仓测试净值接近
持平而不是大幅下降。

#### 22.9.3 为什么原估算未兑现

原 8k–15k 是方案阶段的重叠区间，不是可相加承诺。最终偏差主要来自：

- provider 4k–10k 假设按 50–120 行/文件估算；全迁后的真实生产净删是 2,008 行，credential、投影、分页、
  normalizer 和特殊错误不能删除；
- fixed client codegen 若只比较最小 transport 会显得节省数百行，但补回 Zod、安全与高阶语义后只有约 1 KiB
  gzip 下界差，故没有用 1,756 行 generated code 换取表面 authored LOC；
- Store client 去重同时补上此前漂移的严格 parser、白名单、credential-domain 和错误脱敏，单一真源本身比
  “最小 fetch wrapper”更完整；
- OperationRegistry 消除了五类并行真源，但 strict schema 与兼容 tests 让 core 增长；维护成本下降不必然表现为
  同等物理行数下降；
- 所有官方 SDK/OpenAPI、Hono、Helm、Socket.IO/PartyServer 和 Store aggregate 的预估收益都与已实施区域
  重叠或未过门，不能再加到实际删除量上。

因此最终应承诺的是 **1,675 行生产源码净删 + 单一真源/安全漂移消除**，不是回填一个靠不同口径得到的
8k–15k 数字。

### 22.10 §18 验收门禁逐项结果

#### 22.10.1 通用门禁

| 门禁 | 结果 |
|---|---|
| 生产/测试/生成物分开报告 | ✅ 见 §22.9 |
| 依赖数 | ✅ 正式 runtime 只新增 `ipaddr.js@2.5.0`；dev 新增 `knip@6.32.2`；其余候选仅在隔离 PoC |
| bundle/cold start/build time | ✅ 七个 public artifact 的 JS/CSS 合计 raw `18,258,054 → 18,656,702 B`（+398,648），逐文件 gzip `3,396,664 → 3,493,430 B`（+96,766）；Node 冷启动中位数 `101.8 → 113.1 ms`；强制 build `10.81 → 15.61 s`，见下表与口径说明 |
| `pnpm verify` | ✅ exit 0；9/9 package typecheck、ESLint、全部 package tests，以及 provision 6/6、release 35/35、Dockerfile 2/2、deploy-CI 5/5 |
| `pnpm turbo run build` | ✅ `--force` 7/7，0 cache，Node/Workers/Dashboard/neutral SDK 全部产出；当前 real 15.61 s |
| `pnpm analyze:dead-code` | ✅ Knip exit 0 |
| `git diff --check` | ✅ 无输出 |
| public artifact ownership/version | ✅ 七包均按 0.x breaking/new-capability 规则升 minor，见 §22.11 |
| 未合入分支不打 tag | ✅ 当前未打/推 release tag；必须合入 main 后逐个发布 |

JS/CSS 产物按每个 `dist` 下 `.js/.css` 物理字节求和，再对每个文件单独执行 gzip level 9（不把字体、
图片、声明文件或 tar 元数据混入）：

| Public artifact | 基线 raw / gzip | 当前 raw / gzip | gzip 变化 |
|---|---:|---:|---:|
| app | 977,759 / 184,690 B | 995,863 / 189,780 B | +5,090 B |
| cli | 801,528 / 142,054 B | 907,014 / 166,549 B | +24,495 B |
| dashboard | 1,813,990 / 548,390 B | 1,904,442 / 576,767 B | +28,377 B |
| gateway | 5,223,253 / 849,845 B | 5,253,403 / 853,999 B | +4,154 B |
| plugin-sdk | 40,900 / 12,246 B | 90,113 / 24,309 B | +12,063 B |
| sdk | 3,112,781 / 587,991 B | 3,186,210 / 606,006 B | +18,015 B |
| server | 6,287,843 / 1,071,448 B | 6,319,657 / 1,076,020 B | +4,572 B |
| **合计** | **18,258,054 / 3,396,664 B** | **18,656,702 / 3,493,430 B** | **+96,766 B** |

冷启动用 Node 26.7.0、每轮新 SQLite data dir、`TB_PORT=0`，从 spawn 计时到真实 `/healthz` body 读完，
各跑 5 次并按 baseline/current 交替执行。基线为 `143.9/102.6/100.7/101.7/101.8 ms`（中位 101.8），
当前为 `112.6/110.8/114.1/113.1/113.9 ms`（中位 113.1）。这是本机微基准，不外推为生产 SLA；它至少
说明本轮并非“删行即零运行时代价”。强制 build 同样受文件系统热缓存影响，`10.81/15.61 s` 只作为同机快照，
通过与否仍以 7/7 产物门禁为准。

#### 22.10.2 协议与权限

| 门禁 | 结果/覆盖 |
|---|---|
| JSON/Markdown/text Accept | ✅ neutral client + app invocation/representation tests |
| 不存在/不可见 404 顺序 | ✅ 既有 app/core visibility tests 保留 |
| TBError code/status/retryable | ✅ core wire + SDK client + CLI mapping tests |
| 完整 `cmd.path`、裸 arguments | ✅ OperationRegistry exact Help + OpenAPI/invoke/client tests |
| deny-first、unknown field | ✅ scope suite 保留；所有新写入 schema 使用 strict object |
| secret 不泄露 | ✅ OAuth/provider/store/client transport 的 redaction 与 hostile response tests |
| API/CLI/Dashboard/MCP 对等 | ✅ 固定控制面与 Store 已迁同一 client；MCP projection 未改并由既有 tests 覆盖 |

#### 22.10.3 Provider

| 门禁 | 结果/覆盖 |
|---|---|
| descriptor/catalog/help/schema 等价 | ✅ 99 个生成 hash + 既有 catalog/help tests |
| authRef/SecretStore/providerConfig 分流 | ✅ provider handlers 不接收明文 providerConfig secret；OAuth 仍由 SecretStore |
| `guardedFetch` 唯一 egress | ✅ 普通 JSON 0 raw；14 个协议例外逐项 allowlist 并仍调用 guardedFetch |
| redirect 不跨源泄露 | ✅ 301/302/303/307/308、跨源 header/body policy tests |
| `PLUGIN_TOKEN` fail closed | ✅ plugin harness/generation suite 保留 |
| retry=0 | ✅ providerHttp 与官方候选 503 一次调用 tests；没有引入 SDK 默认 retry |
| wire fixture | ✅ 96 个 provider tests 共用真实 wire harness，特殊 provider 保留专用断言 |

#### 22.10.4 Dashboard/CLI/SDK

| 门禁 | 结果/覆盖 |
|---|---|
| profile/query/history 隔离 | ✅ Dashboard existing + migrated query tests |
| secret 不进 localStorage/URL/toast/error | ✅ schema/store/API tests，所有错误使用白名单/稳定文案 |
| CLI option/JSON | ✅ arg semantics、phase2、各 command tests |
| direct URL 不进错误 | ✅ Store transport/upload hostile error tests |
| Store URI/descriptor 白名单 | ✅ SDK 单一 parser + CLI/Dashboard/device consumer tests |
| relay/direct credential domain | ✅ `credentials:'omit'`、hostile header、complete/abort tests |
| alreadyCompleted、`--out`、share `$ref` | ✅ SDK/CLI/Store page tests |
| Device lifecycle/generation | ✅ CLI/SDK/core/server/gateway device suites；wire 未改 |
| neutral tarball closure | ✅ `@tool-bridge/sdk@0.17.0` 真实 tarball 递归扫描 `client/device/store` 的 JS 与 d.ts shared chunks；无 Node builtin、Hono、private workspace 或意外 external 泄漏，四入口 clean install/import smoke 通过 |

#### 22.10.5 运行时与部署

| 门禁 | 结果/覆盖 |
|---|---|
| Node/Workers build | ✅ 强制构建 7/7；gateway 的 `index/full` Workers artifact、server Node artifact、Dashboard 静态产物与 SDK neutral 三入口同时通过 |
| D1/SQLite/PG contracts | ✅ 最终 `pnpm verify` 中 gateway/server/shared StateStore suites 全过 |
| S3/R2/FS object contracts | ✅ 当前 R2/FS/aws4fetch suites 全过；AWS SDK 候选只达到业务 wire/shape parity，strict-neutral 与净删门失败；当前 S3 读/删/写均显式 `retries:0` |
| Miniflare/Node device tests | ✅ gateway 102 passed/6 skipped，server 82 passed/27 skipped；Node/DO wire、generation、reclaim 与权限回归全过 |
| Helm standalone/HA | ✅ 既有 golden/negative tests；schema PoC 两份 render 与现状逐字一致但未合入 |
| 外部资源验证 | 本轮没有改变生产 Wrangler resource/真实 hibernation 路径；未以重复真实外部调用冒充本地门禁 |

### 22.11 版本、产物 ownership 与发布顺序

本轮改变了七个 public artifact 的发布内容或消费者可见行为，因此都升一个 0.x minor；private
`core/plugins` 保持 `0.1.0`，没有沿源码依赖图机械 bump。

| Public package | 基线 → 当前 | ownership 理由 |
|---|---|---|
| app | `0.15.0 → 0.16.0` | 固定 wire/Store/OAuth egress/路由行为，并 bundle core |
| cli | `0.24.0 → 0.25.0` | neutral client/Store/device、集中错误路径与消费者行为变化 |
| dashboard | `0.22.0 → 0.23.0` | 表单/主题/Store/API 与静态产物变化 |
| gateway | `0.20.0 → 0.21.0` | Workers env/OAuth/device/R2 宿主，并 bundle app/core/plugins |
| plugin-sdk | `0.6.0 → 0.7.0` | 自身 src 无 diff，但发布产物内联变化后的 core OperationRegistry；strict/raw dispatch 行为可感知 |
| sdk | `0.16.0 → 0.17.0` | 新增 `./client`、`./store`，重构 `./device` 与 shared neutral chunks |
| server | `0.16.0 → 0.17.0` | Node env/OAuth/assembly、provider bundle 与 dashboard dependency变化 |

`template/package.json` 已同步到 dashboard `^0.23.0`、gateway `^0.21.0`。发布 verifier 已补强：

- 从真实 tarball 读取 effective manifest 和入口，而不是只看 source manifest；
- Dashboard 必须包含 `dist/index.html`；
- SDK neutral entry 递归扫描 shared JS/d.ts closure；
- CLI 安装后执行 `tb --version`/`--help`；
- version-bump ownership 表覆盖被内联的 workspace 源码；
- publish workflow 使用 verifier 产出的同一 tarball，不重新 pack 一个未经验证的 artifact；
- release orchestration 自动闭包 `server → dashboard`，校验既有 tag 的 SHA，复用成功/运行中的 run，
  只重发失败或缺失的 workflow run，并在每包后等待 registry 精确版本可见。npm 精确版本可幂等跳过；当前未查 GHCR 镜像 tag 实物，因此事后删除的 CLI/server 镜像不在自动 artifact-level recovery 承诺内。

最终 pack 结果：七包 tarball 的 effective manifest、全部入口与 runtime dependency spec 均通过 verifier；
app/cli/dashboard/gateway/plugin-sdk/sdk 都完成独立 clean npm install，CLI 实执 `tb --version` 得
`0.25.0` 并通过 `--help`，SDK 的 root/device/client/store 四入口实际 import 通过。server 因
`dashboard@0.23.0` 尚未发布，先以 `--skip-install` 验 tarball，再在全新 consumer 同时安装本地
dashboard/server tarball；`@tool-bridge/server` import 及 `dist/main.js` 启动均通过，`/healthz` 返回
200、version `0.17.0`、catalog count 99。该联合 clean install 证明包间形状；正式发布仍由 workflow 在
dashboard 精确版本 registry 可见后才继续 server。修改后的 `Dockerfile.cli` 也完成真实 arm64 image build；
容器内 `tb --version` 返回 `0.25.0`，`connect --help` 包含 `--fs-readonly`，验证后已删除本地审计镜像。

合入 `main` 后的稳定发布顺序为：

1. `app-v0.16.0`
2. `cli-v0.25.0`
3. `dashboard-v0.23.0`
4. `gateway-v0.21.0`
5. `plugin-sdk-v0.7.0`
6. `sdk-v0.17.0`
7. `server-v0.17.0`

唯一硬偏序是 dashboard 先于 server；其余顺序用于可复现。只能在 PR 合入 `main` 后运行 release
orchestration；它逐个创建/推送 tag 并等待对应 artifact 完成，不能在当前 worktree 打 tag，也不能把多个 tag
一次 push。发布前必须重跑 registry-based release plan；dashboard 发布可安装后，workflow 会对 server
tarball 再做不带 `--skip-install` 的最终干净安装门禁。

### 22.12 明确保留与未扩大范围

本轮没有以“完整重构”为名扩大到情景 B/C 或改变产品所有权：

- 不替换 HTBP 树/Help/path、deny-first scope、canonical search/hydrate、MCP bridge；
- 不把 SecretStore/authRef 凭证迁到 providerConfig 或第二个 connection store；
- 不删除 `guardedFetch`，也不让第三方 SDK 绕过它；
- 不替换 device generation/presence/reclaim/Redis owner lease；
- 不替换 Store owner/producer、capability、CAS、share/revoke、relay/direct/cleanup 状态机；
- 不合并平台语义不同的 Dockerfile；
- 不提交大规模 OpenAPI generated provider/client 代码；
- 不启动 OpenConnector sidecar、双 control plane 或 credential 双配置。Phase 5 仍需独立 ADR，不能把本轮
  情景 A 的结果写成对情景 B/C 的批准。

### 22.13 最终复核命令

本附录在当前源码固定点使用的最终复核命令如下，均已执行成功：

```bash
pnpm verify
pnpm turbo run build --force
pnpm analyze:dead-code
git diff --check
node --test scripts/package-release.test.mjs
node scripts/release-plan.mjs --json
```

随后对七个 public package 分别运行 `scripts/pack-and-verify-package.mjs`。合入前 server 先做 packed
shape/entry，再与本地 dashboard tarball 联合 clean install 和启动冒烟；正式 workflow 在 dashboard registry
传播完成后再执行单包 clean install。

收口过程中没有隐藏失败：S3 PoC 暴露的 aws4fetch 读/删默认重试已改为全路径 `retries:0` 并加回归；
第一次最终 verify 暴露 Dashboard share fixture 误用了 `/~store/refs`，只修 fixture 为 `/~store/shares`，
没有放宽生产 SSRF/family 校验。独立发布审查随后发现 provider timeout 只覆盖响应头、301/302/303 方法
转换偏离 Fetch，以及 Store 在 Node TLS 终止代理/alias 下签错 scheme；三项均先写最小复现，再修为完整
response deadline、规范 redirect 和 canonical-protocol + request-host，并由原审查者复测。修复后的完整
verify/build/pack/Knip/diff-check 已重新执行并全部通过。最终独立复审确认原 1 个 Blocker、2 个
Important 与 1 个 Minor 全部关闭，未发现新的 Blocker/Important；release/recovery 快审无开放高风险项，
按本轮审查范围可以放行发布。

随后的 llmdoc 对码独立复核又指出 4 个 Important 过度承诺和 1 个 Minor：DNS 解析防线、GHCR 实物恢复、`tb status` 根错误边界、system theme 与同步 JSON parse deadline。其中 `tb status` 按结构目标修复并增加回归，其余文档收紧到实际保证；复核者确认全部关闭。

## 23. 第二轮机会扫描与实施结果

首轮完成后又对 CLI 类型层、core 固定控制面 wire、provider 二进制响应和发布编排做了一次针对性扫描。
本轮继续采用同一条准入线：只有重复契约能由一个已有真源或成熟组件接管、现有运行时语义有测试可锁、且
最终 diff 不把复杂度转移到 adapter 时才实施。结果不是再引入一批大框架，而是完成三项生产源码收敛和一项
发布正确性收敛。

### 23.1 决策摘要

| 区域 | 选择 | 生产源码净变化 | 测试/配置净变化 | 结论 |
|---|---|---:|---:|---|
| CLI Commander 类型 | 官方 `@commander-js/extra-typings@15.0.0` ambient module | **-181** | manifest/lock/Knip +21 | 合入；无新增 runtime dependency |
| core 固定 wire | 复用 `ACTIONS`、`NODE_KINDS`、`TB_ERROR_CODES` 与领域类型 | **-30** | tests +60 | 合入；同时消除 device/control-plane error schema 漂移 |
| provider response bytes | 仓内窄 helper，继续复用 Web Streams/Web API | **-82** | tests +87 | 合入；不为四个 reader 引入通用 HTTP SDK |
| release plan | 单次 registry snapshot + exact-version 判定 | +12（含 workflow） | tests +75 | 合入；这是竞态/幂等修复，不记为 LOC 精简收益 |
| **第二轮 `packages/*/src` 合计** |  | **-293** |  | 累计生产源码净删从 1,675 增至 **1,968** 行 |

CLI 的 41 行 compile-only inference fixture 位于 `src`，因此已经保守计入上表的生产路径口径；若把它按测试
资产单列，CLI 的实现与 ambient declaration 实际净删 222 行。本轮没有删除协议测试：core、plugins 与 release
新增/强化的正式测试净增 222 行。所有代码、测试和配置合并后，本轮在审计文档之外仍是净删 38 行；这说明
发布正确性测试的增加被如实计入，没有只报消费者侧毛删除。

### 23.2 CLI：让 option 定义同时成为类型真源

此前 Commander 已经是 CLI 的解析真源，但 82 个 action 的 TypeScript 参数仍靠手写 interface/annotation
维护。命令增加或修改 option 时，运行时、help 与 TypeScript 可以各自漂移；大量 command factory 还显式
返回宽泛 `Command`，主动丢掉了链式 builder 已经知道的 argument/option 类型。

本轮采用 Commander 官方推荐的
[`@commander-js/extra-typings`](https://github.com/commander-js/extra-typings#ambient-module-setup)：

- `commander` 仍是唯一运行时包；extra typings 只放在 devDependencies，通过 `commander.d.ts` ambient module
  替换编译期声明，不进入发布 tarball 的 runtime dependency closure；
- `commander` 收窄为 `~15.0.0`，与 extra typings 的 15.0 minor 线同步，避免 patch 之外的 API/声明漂移；
- `withGlobalOpts`、`withPageOpts`、`withDeviceConnectionGlobalOpts` 保留 builder 的三个泛型参数；
- `configureGlobalOpts` 使用并返回增强后的 command，避免在 wrapper 内重新把推断类型拓宽；
- command factory 不再声明宽泛 `: Command`，action callback 删除重复的 options interface 与参数注解；
- 41 行 compile-only fixture 同时覆盖 root/global、page、device、repeatable collector 和代表性字段，明确断言
  `json/cursor/tag/baseUrl/timeout` 不是 `any`，其中 `tag` 必须推断为 `string[]`；
- Knip 将该 fixture 声明为 compile-only entry，并仅忽略 ambient declaration 消费的 dev dependency。构建产物
  仍只有对 `commander` 的运行时 import。

独立 compiler API 复核遍历了全部 action，未发现 `any`/`unknown` options 或 positional 顺序错配；Node 22、
Bun binary、clean tarball install、`tb --version` 和 `--help` 也均通过。这里的主要收益是删除 155 处左右的
手写回调参数契约并防止未来漂移，不宣称 erased TypeScript 会显著缩小 JS bundle。

### 23.3 provider：统一有界读取与大字节 Base64

OpenAI、PubMed、Memos 与 Mistral 各自维护一份流式 reader：逐 chunk 计数、超限报错、拼接字节；OpenAI、
Memos、Dropbox/Google Docs 又各有一份 Base64 转换。这些副本看似短，但涉及不受信任响应的内存上限、流取消
和大数组调用栈，漂移会成为安全问题。

新增的 `_runtime/responseBytes.ts` 只承担两个稳定原语：

- `readBoundedResponseBytes` 可在可信协议允许时预检 `Content-Length`，并始终按实际流量再次计数；越界立即
  cancel，所有路径释放 reader lock，最终返回独立 `ArrayBuffer` backing 的 `Uint8Array`；
- `bytesToBase64` 以 32 KiB 分块调用原生 `btoa`，避免把大字节数组一次 spread 到调用栈；不引入 `Buffer`
  或其它 Node-only 全局，因此 Workers/browser 闭包保持中立。

Mistral 的旧契约只按实际读取字节判断，不信任/不提前拒绝声明长度；迁移时显式传
`checkContentLength:false`，没有借重构偷改兼容行为。新增 6 个测试覆盖拼接/释放、声明长度超限、实际流超限、
忽略声明长度、null body 和大数组 Base64。现有 `guardedFetch`、`retry=0`、错误映射与 credential boundary 均未改。

### 23.4 core：wire vocabulary 与错误体只保留一个定义

固定控制面 wire 曾再次手写 action、node kind 与 TBError 的枚举；device frame 又维护一份 TBError schema。
它们与 core 领域常量当前相同，但新增 error code/action/kind 时没有结构保证会一起更新。

现在 `wire.ts` 直接以 `ACTIONS`、`NODE_KINDS` 构造 Zod enum，`errorWire.ts` 以 `TB_ERROR_CODES` 建立最小错误
模块，固定控制面和 device frame 共同导入。这个最小模块只依赖 Zod/errors，没有让 device closure 反向加载完整
固定控制面 schema 图。

这里有一个由强制 build 捕获的重要边界：初版把全部 public wire types 改成 `z.output<typeof schema>`，core
自身 typecheck 通过，但 SDK declaration build 把 Zod 推断细节带给 Dashboard consumer，造成 kind lookup 可能
为 `undefined`、feedback 类型退化等错误。最终实现改为：

- schema 的 vocabulary/运行时校验复用领域常量；
- 有现成领域契约的 public type 直接 alias `Action`、`NodeKind`、`TBErrorBody`、`Presence`、`ToolSpec`、`Page`
  等稳定类型；
- 没有等价领域类型的固定 wire 继续保留显式 public interface，并用 `ZodType<T>`/exhaustive check 对码；
- 新测试同时锁 runtime vocabulary rejection、类型双向等价与 device/control-plane error schema 共用。

这也是为什么验收必须同时跑 build：`verify` 不消费打包后的 SDK `.d.ts`，单靠 package typecheck 无法发现这类
public artifact 边界回归。

### 23.5 release：一个 registry 时刻、一个 exact-version 判据

原 workflow 为人类摘要和机器 `ORDER` 分别执行一次 release plan。npm registry 若恰好在两次请求之间变化，
summary 与实际发布集合可能互相矛盾；同时只比较 `dist-tags.latest` 会把“本地精确版本已经存在、但 latest 已指向
更高版本”的合法恢复场景误判为需要重复发布。

现在的契约是：

1. `npmRegistrySnapshot` 对每包只请求一次 install metadata，同时返回 `versions` 集合与 informational `latest`；
2. `needsPublish` 只取决于本地精确版本是否在 `versions` 中；畸形 metadata fail closed；
3. `release-plan.mjs --json-file` 从同一个内存 plan 同时输出人类摘要和 JSON snapshot；
4. workflow 只调用一次脚本，后续 selection/topological order 读取该文件；
5. `buildReleasePlan` 注入 fetcher/manifest loader，测试可证明每包一次 fetch、exact/latest 漂移、首次发布和
   `dashboard → server` 偏序。

本轮只进行了一次真实 registry 验证：七个本地 minor 版本均不在 registry，latest 分别仍是上一版，计划得到
7 个待发包和正确的 dashboard/server 顺序；没有重复消耗真实外部资源。package-release suite 由 34 增至
35 项并全部通过。

### 23.6 最终门禁与失败闭环

本轮最终状态：

| 门禁 | 结果 |
|---|---|
| `pnpm verify` | ✅ 9/9 typecheck、lint、全仓 tests；release 35/35 |
| `pnpm turbo run build --force` | ✅ 7/7 public artifacts，0 cache |
| `pnpm analyze:dead-code` | ✅ Knip exit 0；compile-only fixture 已显式建模 |
| `git diff --check` | ✅ 无 whitespace error |
| 真实 `release-plan --json` | ✅ 单次执行；七包 exact-version 与拓扑结果符合 registry 现状 |
| 独立代码复核 | ✅ action 类型、response stream、wire artifact 与 release snapshot 均无开放高风险项 |

过程里没有隐藏一次失败：第一次强制 build 暴露 `z.output` public declaration 回归，修正 artifact type boundary
后先跑 core typecheck + SDK build + Dashboard build，再重跑完整 7/7 强制构建。Knip 初次也正确指出 compile-only
fixture/ambient dependency 不在运行时图；补上显式工具配置后复跑为绿，而不是用全局 ignore 掩盖 CLI 文件。

### 23.7 仍可继续，但不应混入本轮的候选

| 候选 | 粗略净变化 | 判断与前置条件 |
|---|---:|---|
| npm publish workflow 抽 reusable workflow | 约 -180–240 行 YAML | 有真实删行，但 npm Trusted Publishing 与 workflow identity 绑定；先选一个低风险包做真实 canary，再迁其余六包 |
| pack verifier 手写 argv 改 `node:util.parseArgs` | 约 -20–40 行 | 低风险、低收益；必须保留重复 option 拒绝、错误码/文案、positionals 与 `--bin × --skip-install` 契约 |
| GHCR artifact-level recovery | **新增**约 80–130 行 | 是正确性补强而非精简；需 Packages API `packages:read`、pagination、权限不足 fail closed 与实际镜像 tag 测试 |
| 扩大 response helper 到更多 provider | 视真实 diff | 只在上游协议确实同构时逐个迁移；不得统一掉 SSE/multipart/XML、特殊 status 或 content-length 语义 |
| OpenConnector 混合/全外置 | 见 §10/§16 | 仍是独立 ADR；先量化 adapter、契约测试、双凭证控制面和运营成本，不能由本轮小重构自动批准 |

设备反向注册也没有因为“再找开源包”而改成 Socket.IO。它仍使用 raw WebSocket/PartySocket + Durable Object
hibernation/Node `ws`，保留 generation、单一权威连接、reverify、presence/reclaim、deadline/cancel、迟到结果和
owner-safe lease。Socket.IO 的 Engine.IO server/rooms/ack 模型既不能直接兼容现有 raw frame，也不能替代这些
状态机；此处继续不迁移是经过对拍后的结构选择，不是遗漏。

第二轮之后，仓内已没有另一块“低风险、数百行以上、可直接由成熟包替掉”的明显重复区。接下来的真实大幅
删减主要只剩 reusable release workflow 或 OpenConnector catalog 外置，两者都需要真实发布/运营门禁；继续
为了 LOC 把产品状态机包装进通用框架，预期只会把代码搬到 adapter，并不会降低总维护成本。
