# 从 open-connector 迁移 provider

open-connector 有 1337 个 provider、约 104 万行,且基本是逐个写出来的(全仓只有 1 个带
`generate.ts`),没有"改生成器重跑"这条捷径。

本流程的产物是**我们自己的 tool-bridge 插件源码** —— Zod schema、`plugin.tools().register()`、
`TBError`、自有的出站防线。不是运行时包一层适配器:那样 vendored 代码永远是外来的,
风格、校验、错误语义全靠适配层临时翻译,欠债只会越滚越大。

## 策展(2026-08-12):114 → 40 个产物

前三批按"流程能否规模化"选批 —— 判据是 codegen 干净、单文件 executors、纯 api_key,
**刻意不看这个 provider 有没有人用**。那批产物证明了流水线成立(114 个 / 806 action),
但目录里塞进了大量没有使用场景的冷门 SaaS(`accredible_certificates`、`bookingmood`、
`loyverse`、`jobnimbus` 这类)。

这一轮反过来按**价值**筛,删掉 74 个,保留 40 个迁移产物 + 2 个手写插件(`feishu`/`notes`)。

保留判据(满足其一):

- **一线工具**,自己或团队想得出使用场景:`openai`/`stripe`/`resend`/`clerk`/`workos`/
  `paddle`/`apify`/`brave_search`/`render`/`ngrok`/`readwise`/`front`/`dub`/`mistral_ai`/
  `cohere`/`convertapi`/`mother_duck`/`prerender`/`opengraph_io`
- **Agent 常用的基础设施类**:抓取与截图(`scrapfly`/`scrapingbee`/`screenshot_fyi`)、
  IP 与地理(`ip2proxy`/`ipgeolocation_io`/`ipqualityscore`/`shodan`/`geocodio`/`graphhopper`)、
  汇率(`currencyapi`/`fixer`/`open_exchange_rates`)、监控与事故
  (`uptimerobot`/`logsnag`/`rootly`/`firehydrant`)、通讯(`telnyx`/`lemlist`)
- **被本文记为特殊案例、删掉会丢证据**:`alt_text_generator_ai`(最小闭环)、
  `resend`(手写豁免路径)、`stripe`(form-encoded/分页/互斥)、`feishu_custom_bot`
  (多字段凭证 + 加签 + 信封错误)、`ipqualityscore`(凭证在路径段)、`zhihu`(中文社区面)

被删的都是"流程验证用完即可弃"的样本。**流程本身的证据不在产物数量里**,在三道闸门和
本文记录的根因分析里 —— 删掉 74 个产物,`schemaParity`/`producedShape` 照常运行。

删除同时要清的四处(漏一处会静默失败或闸门红):

| 位置 | 清什么 |
|---|---|
| `src/<service>/` | 整个目录 |
| `src/registry.ts` | `BUILTIN_PLUGIN_LOADERS` 的那一行 loader |
| `test/providers/<camelCase>.test.ts` | 对应的 wire 测试 |
| `migration-fingerprints.json` | `providers` 下的那个 key(否则形状闸门报"缺 index.ts") |

一个坑:`test/runtime/envNarrowing.test.ts` 曾断言 `bindings.size > 100` —— 那个数字是
当时目录规模的副产物,不是它要证明的东西。已改成对着 `BUILTIN_PLUGIN_LOADERS` 的长度断言,
策展增删目录不再需要改测试。**凡是写死了目录规模的断言都属于这类**。

## 第四批(已完成):按价值选的 57 个,97 个产物 / 1275 action

策展腾出空间后,反过来从上游按**价值**选批(前三批选的是"流程能否规模化",这批选的是
"这个 provider 有没有人用")。

选批用全量探针数据,不是拍脑袋:对 121 个候选跑 codegen + 等价比对(1949 action,
1827 等价 = 93.8%),按 provider 汇总后取"价值 ∩ 可行性"。剔除分两类 ——
脏度高不值得开豁免(clickup 16/68、qdrant 6/7、plausible_analytics 4/4、firecrawl 6/30、
googlesheets 7/40),以及与保留项能力重复(gitea↔github、serpapi/linkup↔tavily、
mailgun/sendgrid↔resend)。

**分两轮交付**(第一轮 26 个,余下 30 个因 subagent 批量中断顺延到第二轮补完)。
最终 97 个产物、1275 action、内置目录 99 个 loader。凭证形态分布(经 `~describe` 实测,
不是静态 grep —— grep 会把注释里"不能声明 X"的说明文字当成声明):

| 形态 | 个数 | 产物 |
|---|---:|---|
| 单值 api_key | 82 | 多数 |
| `credentialFields` 多字段 | 10 | confluence / ghost / jira / mattermost / shopify / trello / twilio / upstash_redis / wordpress / feishu_custom_bot |
| `oauth` 托管授权码 | 5 | sentry / gmail / googlecalendar / googledocs / dropbox |
| `credentialProbe` | 66 | —— |

互斥零违反(`oauth` 与另两者不共存)。

规模最大的三个:github(145 action,api.ts 按上游 runtime-* 拆 6 文件)、
gmail(46)、googlecalendar(37)。

### oauth2 产物要盯的一处

Google 系必须带 `authorizationParams: {access_type:'offline', prompt:'consent'}`,
Dropbox 必须带 `{token_access_type:'offline'}` —— **漏了它们上游不下发 refresh_token**,
access token 一过期用户就得手工重新授权,而这个故障要等几十分钟后才显现。
这几个值抄上游 `definition.ts`,不要凭印象写。

### 这一轮学到的

- **agent 批量中断是常态,要设计成可断点续跑**。第一轮 13 个 subagent 先后因 API 连接
  中断与**周额度耗尽**全部退出。形状闸门照例把半成品精确报了出来(缺 index.ts / 缺测试),
  但真正省事的是把未完成产物连同指纹登记撤到 `.pending-migration/`:**未完成 ≠ 要删掉
  重来**,schema 是确定性产物,值钱且可复用;补完时目录移回、指纹并回即可,codegen 不用
  重跑。第二轮正是这么做的,零重复劳动。
- **半成品不要提前接进 registry**。形状闸门按指纹清单判"这个 provider 拼得起来吗",
  半成品留在清单里(或提前加了 loader 行)会让闸门在**假问题**上长红,反而盖住真问题。
- **wire 测试绿 ≠ 类型是对的**。vitest 不做 typecheck。`compact()` 那个类型缺陷累计
  出现四次(7 + grafana + memos),都是不同 agent 独立写出的同一个错 —— 说明它是这类
  改写的天然陷阱,不是个别疏忽。31 个产物用了同款 helper,但只有 2 处真触发 tsc
  (取决于返回值有没有流进窄类型参数):**grep 会误判 29 处,tsc 才是判据**。
- **`new Response('', {status: 204})` 在 undici 下直接 TypeError**(204/205/304 是
  null body status),而那个异常冒到 plugin-sdk 会被归一成 `internal` 500 ——
  呈现出来是"插件崩了",实际是测试构造响应的那一行写错了。两个产物的测试 helper 同时
  踩到。查法:直调 handler 看原始异常,别只看 envelope 回的错误码。
- **任务书写错了要按源码纠正**。我给 `cloudflare_dns/handwritten.json` 写的 reason 是
  看 schema 截断输出推断的("按记录类型的 oneOf 分支"),实际是两条 `anyOf`
  (content/data 二选一、至少改一个字段),与记录类型无关。执行的 agent 读了源码后指出
  不符并按源码写了 refine 版本 —— 这是对的:按错误 reason 写判别联合会把契约收得比
  上游窄(TXT 记录用 `data` 给结构化内容,上游接受、判别式会拒),那是行为变更不是迁移。
- **修完缺陷要回头改那些"因它而写"的注释**。core 的 `toToolResult` 修好后,github 里
  一条"删掉 content 键以免被当成信封"的注释理由就失效了;留着它下一个人会照它推断出
  错误结论,甚至去"修"一个不存在的问题。

### oauth2 通道:平台侧早就通了,缺的是 SDK 声明面

`providerOAuth.ts` 的托管授权码流程有 16 个端到端集成测试(PKCE、state 密封、401 自愈、
卸载不继承旧令牌、注入 access token 而非 clientSecret),但**没有任何插件能触发它** ——
`plugin-sdk` 的 `ToolsExport` 上没有 `oauth()`,连那些集成测试都是手写 `~describe`
绕过 SDK 的。本轮补上了(见 `plugin-sdk` 0.3.0),并在 SDK 侧当场拒三处互斥组合
(`credentials`/`credentialProbe` 双向)—— 平台契约层本就会拒,但那要等注册时才 400,
作者看到的是个远端错误。

C 层 5 个 oauth2 provider(sentry / gmail / googlecalendar / googledocs / dropbox)
**已全部迁完**,是这条声明面的首批消费者。写这类产物时注意:
- **Google 系必须带 `authorizationParams: {access_type:'offline', prompt:'consent'}`**,
  否则拿不到 refresh_token,令牌一过期用户就得手工重授权;Dropbox 同理需要
  `token_access_type: 'offline'`。这几个值抄上游 `definition.ts`,不要自己发挥。
- handler 里照常 `requireApiKey(ctx, SERVICE)` —— 拿到的就是平台换来并按需刷新的
  access token,插件不需要知道它是 OAuth 来的。
- 这 5 个产物的 wire 测试都额外钉了一条:`~describe` 报出的 oauth 与上游端点/scope/
  授权参数逐字一致。端点错一个字符(比如 sentry 的尾斜杠)授权就会失败,而那种失败要到
  用户点授权按钮时才显现。

### 自建实例类 provider:baseUrl 走 providerConfig,不是 credentialFields

`grafana` / `memos` / `metabase` / `outline` / `wordpress` 这类"用户自己部署一份"的
provider,上游的形态是 **`api_key` + `extraFields`(`secret: false`)**,不是
`custom_credential.fields`。两者在 tool-bridge 侧的落点不同:

| 上游 | 落点 | 理由 |
|---|---|---|
| `auth[0].type === 'custom_credential'` 的 `fields` | `credentialFields` → authRef 指向的 secret | 都是凭证,泄漏有后果 |
| `auth[0].extraFields` 且 `secret: false`(baseUrl / instanceUrl / region) | `providerConfig`(`ctx.mountConfig`) | **不是密钥**;塞进 secret 通道是滥用那条通道 |

判据就一条:看 `secret` 标志。`baseUrl` 泄漏无后果,但它**必配** —— 缺了插件不知道该
打哪个实例,报 `invalid_argument` 点名要配什么。

顺带:这类 provider 的 baseUrl 由租户填写,是**现成的 SSRF 入口**。`guardedFetch` 会拦
内网地址(那是对的),但错误消息要让用户看懂是"你填的地址指向内网"而不是一句 fetch failed。
metabase 的 instanceUrl 规范化(补 https、拒非 https、去 userinfo、剥重复 `/api`)是个好样板。

### 与上游行为不一致的两处(schema 未动,故不进 handwritten.json)

`handwritten.json` 登记的是 **schema 豁免**;下面这两处 schema 没动、改的是**行为**,
故记在这里。判据是"上游的实现与它自己的声明矛盾,且同 provider 内有反例证明是漏改":

| 产物 | 偏离 | 依据 |
|---|---|---|
| `googledocs.insert_table_action` | 上游 `insertAtEndOfSegment` **声明了但零引用**(只在 `actions.ts:371` 出现,executors 里完全不读),给了它也仍按 `index` 定点插;这里按声明处理 —— 显式为 true 就追加到段尾 | 同 provider 的 `insert_text_action.append_to_end` **是生效的**(`executors.ts:615`),两个 action 同期加入、语义同构,上游那处是漏改 |
| `googledocs` 403 归码 | 配额类 reason 归 `rate_limited`(可重试)而非 `unavailable` | 与 googlecalendar 同批口径一致;语义更准 —— 配额是"等一会儿就好",不是"服务不可用" |

**不这么做的反面**:照抄一个连上游自己都没实现的声明,`~help` 会向 agent 承诺一个不存在
的能力 —— 那比行为偏离更糟,因为它不可发现。

`memos.get_current_user` 是相反的选择:上游读 `{user:{...}}` 信封,若某个 Memos 版本把
user 放顶层这里会报 `unavailable`。**照抄未加兜底** —— 没有实证支撑的兼容分支只是猜测,
猜错了反而掩盖真实的上游变更。

## 一个迁移产物长什么样

```
src/<service>/
  schema.ts               # Zod 声明 + 语义标注 —— 由流水线生成,之后归本仓库所有
  api.ts                  # 业务逻辑 —— 人工机械改写
  index.ts                # 装配 —— 把两张表对起来
  handwritten.json        # 可选:手写豁免清单
  schema.handwritten.ts   # 可选:手写的 schema
```

上游 schema 的**指纹**统一存在 `packages/plugins/migration-fingerprints.json`(一份,不按
provider 分散)—— 等价闸门比对它,`providers` 的 key 列表同时充当"哪些目录是迁移产物"的判据。
之前每个产物目录里各放一个 `upstream.snapshot.json`,读目录时分不清哪些是要维护的源码。

## 四个阶段

### 1. 抽取

直接 `import()` 上游的 `definition.ts` 求值(Node 原生跑 TS),拿到 action 表。
**不解析 AST、不做正则匹配** —— 求值拿到的就是真值,没有猜的余地。

### 2. Schema codegen

```bash
node scripts/migrate/index.mjs <open-connector 路径> <service>...
```

JSON Schema → Zod 源码。覆盖面不是猜的:上游 `core/json-schema.ts` 的 builder 能产出的
关键字是**有限集合**,`jsonSchemaToZod.mjs` 逐条对着它写。遇到表外关键字**直接抛**,
不静默降级成 `z.unknown()` —— 静默降级会让契约悄悄变宽,而这正是本流程要防的事。

生成后自动过仓库自己的 `eslint --fix`:产物要和手写代码同一风格,这是"归本仓库所有"的
实际含义 —— 它得能通过和其他源码一样的闸门。

`effect` 上游没有这个轴,生成时按 action 名前缀**播种**(保守:只有明确读前缀才 `read`,
删除前缀 `destructive`,其余一律 `write`),之后人工校正。

### 3. 业务逻辑机械改写

`executors.ts` → `api.ts`。逻辑本体保留,三处本地化:

| 上游 | 本仓 |
|---|---|
| `context.getCredential(service)` / `context.apiKey` | `requireApiKey(ctx, service)`(平台经 `authRef` 注入,插件不自持凭证) |
| `context.fetcher` / 全局 `fetch` | `guardedFetch`(`_runtime/guardedFetch.ts`) |
| `ProviderRequestError(status, msg)` | `upstreamError(status, msg)` → `TBError` 七码 |

这一步**刻意不自动化**:生成出来的 handler 骨架只会掩盖"没迁完"的事实。

### 4. 两道闸门

- **`test/migration/schemaParity.test.ts`** —— 契约有没有在翻译中漂移。生成的 Zod 反推回
  JSON Schema、归一、取 sha256,与 `migration-fingerprints.json` 里的指纹逐 action 比对。这是让
  批量迁移可信的东西:1329 个 provider 不可能靠人肉 review,这条测试把它变成 CI 里的机器判定。

  存**指纹**而非完整 schema:最初落盘上游 schema 原样拷贝,clerk 一个 197 KB、15 个产物
  446 KB —— 1329 个全迁完是 ~40 MB 的仓库重量,而它与 `schema.ts` 本就是同一份信息的两种
  表示。指纹留住闸门的全部作用,体积降到 1/15(30 KB)。实证:把某个字段的 `.min(1)` 去掉
  (放宽契约),闸门精确红在那一个 action 上。

  指纹取在 **normalize 之后** —— 那些可论证保语义的等价写法不该让指纹白白失配。代价是
  改动 normalize 规则会让全部指纹失效,故用 `normalizeVersion` 显式标记:改规则就 +1 并
  重新生成,闸门会先检查版本一致。
- **`test/providers/<service>.test.ts`** —— 迁完还能不能用。经真实 envelope 断言
  `~describe`/`List`/`Call`/入参校验/错误码/凭证缺失。

两者不可互相替代:一个管"迁得对",一个管"迁得能跑"。

## 归一化:哪些差异算等价

闸门比对前两边过同一个 `normalize`,每一条都是**可论证保语义**的:

| 差异 | 为什么算等价 |
|---|---|
| `additionalProperties: true` vs `{}` | JSON Schema 里都表示"任意值" |
| `propertyNames: {type:'string'}` | JSON 对象的键本来只能是字符串,同义反复 |
| `z.int()` 带的 `±2^53-1` 边界 | 该范围外 JS 的 number 无法精确表示 |
| `z.email()/z.url()` 除 `format` 外自带的正则 | 两边都在表达同一格式约束;差别是迁移后 Zod **真的执行**校验 |

其余任何差异都会让闸门红。想收紧/放宽某个 schema,手改后登记进 `handwritten.json` ——
**漂移只能是声明过的,不能是意外的**。

## 全量长尾实测(1329 provider / 13956 action)

`scripts/migrate` 对全部上游 provider 跑过一遍 codegen + 等价比对,结果:

| 指标 | 数值 |
|---|---|
| provider 完全干净 | 1029 / 1329(77.4%) |
| action 完全等价 | 12962 / 13956(92.9%) |

剩余 ~1000 处按根因分布(前几名):

| 次数 | 影响 provider | 根因 | 处置 |
|---:|---:|---|---|
| 437 | 150 | `anyOf`/`oneOf` 与兄弟键共存 | 手写豁免(见下) |
| 93 | 28 | `allOf` | 待支持 |
| 86 | 1 | 顶层 `$schema`(全在 googledrive) | 待支持 |
| 44 | 25 | `not` | 待支持 |
| ~150 | 分散 | `anyOf` 顶层联合(整个 action 二选一入参形状) | 待评估 |

这份数据的用途:**先把根因修在 codegen 里,再 fan-out**。首轮实测时干净率只有 62.9%,
其中前两名(`pattern` 漏进 HANDLED 集合、空 `properties: {}` 噪声)都是流水线自身的疏漏,
修完直接涨到 77.4%。批量迁移前跑一遍全量探针、按根因排序处理,比逐个 provider 试错快得多。

## 已知需要手写的形状

- `anyOf`/`oneOf` 与 `type`/`properties` **同级共存**(如 resend 的"html/text 二选一必填"):
  Zod 侧要写 `.refine()`,而 refine 无法反推进 JSON Schema,闸门判不了。codegen 在这里
  **硬失败**,交由人工写这一个 schema 并登记豁免。
- `$ref` / `$defs`(10 处 / 2 provider):需要先决定 Zod 侧的复用形态(提取成共享常量)。
- `allOf`(93 处 / 28 provider)、`not`(44 处 / 25 provider):同理,组合子在 Zod 侧要么
  没有直接对应物、要么反推不回去。

## 一条踩过的坑:`additionalProperties` 缺省不等于 `false`

上游多数 schema 由 `s.object()` 生成、显式写了 `additionalProperties: false`,但有一批是
**手写的裸 JSON Schema** 不带这个键 —— 按 JSON Schema 语义那是"放行额外属性"。最初一律
生成 `z.strictObject` 会**收紧契约**:调用方原本能传的字段开始被 400 拒掉。等价闸门抓到了
这 278 处(集中在 dokploy/postman/unifapi 三个 provider),现在缺省生成 `looseObject`。

这正是闸门存在的意义 —— 这类漂移人眼扫代码是看不出来的。

## 不该走这条路的 provider

迁移前先看一眼它是不是**本来就有原生 kind**:

- `cloudflare_docs` 在上游是个 MCP 代理(转发到 `https://docs.mcp.cloudflare.com/mcp`)。
  tool-bridge 有原生 `kind:'mcp'` 节点,直接挂 URL 即可 —— 迁成 plugin 等于在 MCP 客户端
  外面再套一层 plugin 协议,平白多一跳,还要自己维护会话复用。**这类一律不迁。**
- 同理:纯 HTTP 转发且工具表固定的 provider,评估一下 `kind:'http'` 是否够用。

## 首批(已完成)

| provider | 形态 | 覆盖到的东西 |
|---|---|---|
| `alt_text_generator_ai` | api_key,1 action | 最小闭环;纯文本 / JSON 字符串双形态响应 |
| `stripe` | api_key,18 action | form-encoded 方括号嵌套、cursor 分页、路径参数、跨字段互斥、深层嵌套 schema |
| `resend` | api_key,1 action | **手写豁免路径**:Zod 无法反推的 anyOf 组合约束 |

三个产物合计 21 例 wire 测试 + 21 个 action 过等价闸门。

## 第二批(已完成):12 provider / 73 action

验证流程能规模化。做法:**先跑确定性的 schema codegen,再 fan-out subagent 只做业务
逻辑改写**。schema 是机器活、有闸门兜底,不该占 agent 的预算;业务改写才是判断密集的部分。

选批用脚本从 1329 个里筛(纯 api_key + codegen 全干净 + 单文件 executors + 非 MCP 代理
+ 非 proxy),得 182 个合格候选,再跨规模均匀取 12 个(133~419 行 executors、1~15 action)。

logsnag / meituan / screenshot_fyi / coinranking / telnyx / langbase / clerk /
ipqualityscore / brave_search / lightfield / opensea / fathom

### 这一轮学到的

- **批量核查不能只看测试绿**。收尾要 grep 一遍:有没有人 import 上游 helper、有没有裸
  `fetch(`、是不是都走了 `guardedFetch`/`requireApiKey`、有没有人改了不该改的文件
  (`git status` 里不该出现 ` M`,agent 只该新增)。
- **形状闸门是必需的**。这轮有一个 agent 只产出了 `api.ts`,漏了 `index.ts` 与 wire 测试。
  测试全绿(因为它的测试压根不存在),是形状闸门把它抓出来的。
- agent 产出质量好于预期:注释解释与上游的**有意偏离**及理由。例如 clerk 指出上游
  `createClerkError` 把 403 压成 401、404 压成 400,迁移后交回 `upstreamError` 统一归一。

### 凭证进 URL 的 provider(部署侧需知)

多数上游把 API key 放请求头,但有一批放在 URL 里 —— 这是**上游 API 的设计**,换成 header
会直接 401,迁移没有选择余地:

| 位置 | provider |
|---|---|
| query 参数 | `cincopa`(api_token)、`eodhd_apis`(api_token)、`fixer`(access_key)、`graphhopper`(key)、`gumroad`(access_token)、`ipgeolocation_io`(apiKey)、`moosend`(apikey)、`realphonevalidation`(token)、`scrapfly`(key)、`scrapingbee`(api_key)、`screenshot_fyi`(accessKey)、`shodan`(key) |
| **路径段** | `ipqualityscore`(`/api/json/<family>/<apiKey>/<value>`) |

后果:凭证会出现在出站 URL 里,可能落进网关访问日志、上游日志,以及任何中间代理。
挂载这些 provider 前应确认部署侧的日志策略(URL 是否脱敏、是否外发)。

`guardedFetch` 的错误消息不回显 URL,这一点上没有额外泄漏;但常规请求日志会。

**怎么查新产物属不属于这一类**:`grep -n requireApiKey src/<service>/api.ts`,看它是流进
`searchParams` / 路径模板,还是流进 `headers`。别信静态正则的批量扫描 —— 凭证常经 helper
函数间接传入(`buildUrl(path, requireApiKey(...), params)`),行级 grep 会漏。

### 凭证是裸 Authorization 的 provider

`chorus` 与 `stormglass_io` 的 Authorization 头**不带 `Bearer ` 前缀**,凭证原样放进去
(与上游一致,已核对)。存 secret 时不要自己加前缀,否则上游 401。

查法:`grep -oE "authorization.*requireApiKey" src/<service>/api.ts`,看有没有 `Bearer`。

### 凭证探针:`credentialValidators` 的落点(已实现)

上游每个 provider 都带 `credentialValidators`,在存凭证时打一个最便宜的接口验证 key 可用。
tool-bridge 此前没有对应钩子 —— 凭证经 `tb secret set` 存进 SecretStore、挂载只写 `authRef`,
插件要到**第一次业务调用**才拿得到它,配错的 key 要等 agent 真去用时才 401。

现在 tools/v1 的 export 可以声明一个探针,挂载时平台用注入的凭证真实调它一次:

```ts
createProviderPlugin({
  description: 'Clerk',
  actions: clerkActions,
  credentialProbe: 'count_users',   // 只读、零副作用、无必填入参
  handlers: { ... },
})
```

选探针的三个条件(前两个有代码校验,第三个靠人判断):
- **已注册的工具** —— `probeCredentialWith` 在注册期就查,拼错名字当场炸;
- **`effect: 'read'`** —— 挂载不该产生业务副作用,`_runtime/plugin.ts` 装配期校验;
- **无必填入参** —— 平台空参调它,有必填字段会被 Zod 拦成 invalid_argument,
  那个错误看起来像凭证问题,实际是探针选错了。

选不出合适的 action 就**不写**(例如全部 action 都要必填业务 id,拿不到一个"空转"调用)。
迁移时顺手看一眼上游 `credentialValidators` 打的是哪个接口,通常就对应到某个 list/count action。

错误分账:401/403 → `invalid_argument`(这次挂载的错,当场拒,消息点名是哪个 secret);
上游 5xx 或网络故障 → `unavailable` + retryable(不因上游抖动永久拒绝挂载)。

**首批 15 个产物里只有 clerk 声明了探针**,其余待逐个补 —— 补的时候对着上游的
`credentialValidators` 看它打哪个接口即可。

### 两个上游状况(迁移改不了,但要知道)

**1. 34.3% 的 action 没有 `required` 声明**

实测:上游 12474 个带入参属性的 action 里,4278 个(涉及 1049 个 provider)的 inputSchema
完全没有 `required` —— 但它们的 executor 里常有 `requiredString(input.xxx)` 之类的断言。
也就是**上游的 schema 与其实现本来就不一致**。

codegen 忠实反映 schema(全部生成 `.optional()`),这是对的:等价闸门的前提是"不改变契约"。
处置是在 `api.ts` 里保留上游的必填断言,抛 `invalid_argument`:

```ts
function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TBError('invalid_argument', `${field} 不能为空`)
  }
  return value
}
```

代价:`~help` 露出的 schema 说这个字段可选,实际调用会被拒。想修就得收紧 schema 并在
`handwritten.json` 登记 —— 那是**声明过的**契约变更,闸门会照常放行。**不要**在 codegen 里
按 executor 推断必填:那是猜,而且会让"schema 是唯一真源"这条失效。

**2. 66 个 provider 依赖 `transitFiles`(二进制文件中转)**

上游有一套本地中转文件存储:action 产出二进制(音频、PDF、截图)时存进去,返回
`{fileId, downloadUrl, sizeBytes, ...}`。tool-bridge 有 ObjectStore 与 `$ref` 大对象通道,
但**没有接到 plugin 面** —— `ProviderContext` 只有 `config` 与 `upstreamAuth`。

这类 provider 现在**跳过不迁**,不要写成"调用即抛 unavailable"的幽灵工具(与
`_runtime/plugin.ts` 装配期校验的原则相反)。要迁得先在插件契约里开一个文件中转出口。

## 第三批(已完成):99 provider + feishu_custom_bot

验证流程在**百量级**下仍然成立。累计 114 个产物、806 个 action、116 个内置插件。

选批脚本化:从 1329 个筛出 168 个合格候选,跨规模均匀取 99 个,按 executors 行数均衡分 12 组
(每组约 2600 行)。100/114 个产物带了 credentialProbe。

### 这一轮学到的

- **agent 会中途挂**。三个 subagent 因 API 连接中断退出,留下 10 个只做了一半的 provider。
  形状闸门是发现它们的手段(`producedShape.test.ts` 会报"缺 index.ts"),之后补跑即可。
  **批量 fan-out 必须有这么一道机器检查**,否则半成品会静默混进提交。
- **pre-commit 的全仓 typecheck 会被在途文件挡住**。agent 还在写的时候提交不了 —— 这是
  hook 在正确工作,但要把提交安排在整批结束后,别中途试。
- 上游 provider 里有一类"拿某一个 action 的 `z.infer` 当共有入参类型"的错误抽象
  (intelliprint 的 `BaseListInput`)。同名字段的**枚举各 action 不同**,钉死一个就把其余的
  合法取值排除了。typecheck 会抓到,但要读懂它在说什么。

### 飞书

三个上游 provider,只有一个现在能迁:

| provider | auth | actions | 状态 |
|---|---|---|---|
| `feishu_custom_bot` | api_key | 5 | **已迁** |
| `feishu_app_bot` | custom_credential | 330 | 待平台侧补多字段凭证通道 |
| `feishu` | oauth2 | 396 | 待平台侧补 oauth2 通道 |

> 这张表是第三批当时的状态。两条"待平台侧补"**都已解决**:多字段凭证见本文
> 「多字段凭证(custom_credential)」一节,oauth2 见「oauth2 通道:平台侧早就通了,
> 缺的是 SDK 声明面」。`feishu_app_bot` / `feishu` 本身仍未迁。

`feishu_custom_bot` 有三处值得注意的处置:凭证两种形态都收但校验 origin(防 webhook token
被发给第三方)、加签从 `node:crypto` 改 Web Crypto(算法产物一致)、HTTP 200 但业务码非 0
也算失败(飞书用信封表达错误)。

本仓另有一个 `feishu` 插件是**代理型**(转发到飞书官方 MCP,140 行)。按决定:迁完
`feishu_app_bot` 后替掉它 —— 自实现的 330 个 action 能力面远大于代理的默认 8 个工具。

## 规模实测(116 个内置插件)

> 这组数字实测于策展前的 116 个插件目录。策展后目录是 42 个,但**结论不变** ——
> 有意义的是每插件均摊 8.3 ms 这个斜率,而不是当时的总数。

"可用 ≠ 实例化"这条决策的实际数字:

| 操作 | 耗时 |
|---|---|
| `builtinPluginBindings()` 装配 116 个 binding | **0 ms**(只建 Map + 闭包,不 import) |
| 首次调用一个 binding(加载 + 实例化) | ~216 ms |
| 全量加载 116 个 | ~964 ms(均 8.3 ms) |

懒加载确实生效 —— 装配零成本,只有被真正调用的插件才付加载代价。但**全量数字外推到
1000 个是 ~8 秒**,这对 Workers 的启动预算是硬约束:CF 侧必须靠构建期的 `include` 裁剪
集合(决策文档已记),不能指望运行时懒加载兜住。

## 有状态插件的分区键

`export default createXxxPlugin()` 是**模块级单例**,同一部署会服务多个挂载。有状态的插件
必须自己分区,否则跨挂载串号。

**分区键不是 `mountPath`**。这一点我们踩过:notes 的两个 export(tools 写、context 读)
刻意挂在不同路径,它们本该看到同一份数据 —— 那正是"一个部署同时导出动作面与内容面"的
意义。按 mountPath 分会把这条能力切断(pluginExample 集成测试抓到了)。

正确做法是让**挂载方声明归属**:`providerConfig: { workspace: 'team-a' }`。同 workspace
共享,不同的互不可见,没声明的落默认区(单团队零配置)。KV/D1 的 key 带这个前缀。

114 个迁移产物**全部无状态**(已核:`api.ts` 里没有模块级可变状态),所以这条只对手写的
有状态插件成立。

## 一次设计 review 的结果(2026-08-12)

三轮迁移 + 三个新能力(credentialProbe / credentialFields / oauth)叠加后做了一次 review。
**已修**的按严重性:

| # | 问题 | 处置 |
|---|---|---|
| A1 | 插件 env = 宿主全环境,一行 `ctx.env.TB_SECRET_ENCRYPTION_KEY` 拿主密钥 | 收窄成白名单;生产宿主尚未接线,趁早钉 |
| A2 | 跨源重定向把凭证带给新 origin(33 个产物凭证在 header) | 换 origin 剥凭证头;同源保留 |
| A2b | `EgressBlockedError` 是裸 Error → SSRF 拦截对外成 internal 500 | 继承 TBError,归 invalid_argument |
| A3 | `credentialProbe` 的"只读/无必填入参"零校验,而平台每次挂载真调它 | 平台从 List 核验形状 |
| A4 | 未配 PLUGIN_TOKEN 时只要求 Bearer 非空(fail-open) | fail closed + 显式开发开关 |
| B9 | binding 传输没有 30s 超时(114 个产物走这条) | 补上,与网络分支同一常量 |
| — | OAuth 挂载的探针把 client secret 发给插件 | 契约拒该组合 + 挂载层纵深 |
| — | `invalidateProviderOAuth` 写了没接,同路径重挂继承旧令牌 | 三处清理点补齐 |
| — | notes 样例多挂载数据串号 | 按 `providerConfig.workspace` 分区 |
| B5 | 不返回 `expires_in` 的 provider 令牌失效后**永久坏死** | 401 触发强制刷新并重试一次 |
| B6 | 加签密钥走 `providerConfig`(明文进节点记录) | 改用 `credentialFields`;契约写明 mountConfig 定位 |

**未修、已登记**(按优先级):

- **B7**:单值凭证无法声明"必需",漏配 `authRef` 挂载照过,运行时 `unavailable`(可重试)
  把配置错说成服务故障。应加"本 export 必须有凭证"的声明,且 `requireApiKey` 改
  `invalid_argument`。
- **B8**:`X-TB-Context` 把调用方完整 scope 拓扑送给每个插件。插件只需要
  traceId/mountPath/mountConfig/exportId。1000 个插件里有一个恶意的,这就是现成的侦察数据。
- **B10**:`RequestDedupe` 的键只有 requestId,不含 mountPath/凭证指纹。今天靠
  `randomUUID()` 不碰撞,任何宿主改用确定性 id 就是跨租户结果重放。成本极低,该补。
- **C11~C16**:`configSchema`/`mountConfigSchema` 零消费点、`context/v1` 不能声明
  credentialFields、保留 secret 命名空间可经 authRef 使用、`List` 返回值零校验、
  `catalog` 全量扫 KV(1000 个注册就是 1000 条)、`httpStatus` 跨信封丢失。

### review 给出的结论(值得原样留着)

> 最大风险:**插件是特权代码,但整套契约把它当普通配置对待。** 平台把插件的声明当可信输入
> 直接执行,进程内形态又让插件与网关同权;而真正的凭证边界 —— 探针只读、凭证不进
> providerConfig、模块级缓存按凭证键控、出站重定向不带凭证 —— 全靠作者纪律与迁移期人工
> 评审维持,机器上一处都没有。
>
> 114 个产物由同一批人在同一周内写完,纪律还在;1000 个、尤其掺入社区插件之后,只剩声明。

这一轮把其中四条(A1/A2/A3/A4)变成了机器可执行的约束。B6/B8/B10 仍是"靠纪律"的状态。

### 下一批的建议

剩余 ~170 个"codegen 全干净 + 纯 api_key + 单文件"的候选可以直接照这个流程跑。
再往后要先在 codegen 里支持 `allOf`/`not`/顶层 `$schema`,或接受它们走手写豁免。
`custom_credential`(54 个)**通道已通**(见下),可以开始迁;`oauth2`(42 个)仍需平台侧
先补托管授权码流程。

> 后续修正:oauth2 那句**已过时**。平台侧的托管授权码流程当时其实已经落地
> (`app/src/providerOAuth.ts`,16 个端到端集成测试),真正缺的是 `plugin-sdk` 的
> `oauth()` 声明面 —— 已在第四批补上(plugin-sdk 0.3.0)。

## `mountConfig` 与凭证的分界

`providerConfig`(插件侧 `ctx.mountConfig`)**只发给该节点对应的 plugin**,随本次调用的信封
下发,插件之间不共享 —— 同一 plugin 部署的不同挂载各自收到自己那份。

但它**不是密钥通道**。实测:`system/registry get` 对一个**只有该节点 `read` 权限**的窄 SK
也原样回显整个 `config`,`providerConfig` 里的东西是明文。这绕过了三条防线:SecretStore
的只写不读、`assertSecretRefUse` 的 secret admin 要求、以及静态加密。

| 放什么 | 去哪 |
|---|---|
| region / baseUrl override / 功能开关 / workspace 归属 | `providerConfig` |
| API key / 密钥 / token / 任何泄漏有后果的东西 | `authRef` 指向的 secret(多字段用 `credentialFields`) |

`feishu_custom_bot` 的加签密钥曾走 `providerConfig`(当时只有单值凭证通道),已改。
决策文档 `plugin-hosted-install` 记的"mountConfig = 每挂载非敏感配置"是对的 —— 是实现
一度违反了它。

## 多字段凭证(custom_credential)

上游的 `custom_credential` 形态(多个凭证字段)现在有落点。产物侧只需在装配时声明字段:

```ts
createProviderPlugin({
  description: 'Feishu App Bot',
  credentialFields: [
    { key: 'appId', label: 'App ID', required: true },
    { key: 'appSecret', label: 'App Secret', required: true, secret: true },
  ],
  actions: ...,
  handlers: ...,
})
```

handler 里用 `requireCredential(ctx, SERVICE, 'appId')` 取字段(单值 provider 继续用
`requireApiKey`)。字段缺失由 SDK 在解析时按声明拦下,`requireCredential` 只处理"整份凭证
没配"。

写入:`tb secret set --name x --field appId=a --field appSecret=b`,落库是一个 JSON 对象。
平台在**挂载时**校验字段齐全,缺了当场拒并点名缺哪个 —— 不等到第一次调用。

迁移时对着上游 `definition.ts` 的 `auth[0].fields` 抄字段名与 required/secret 即可。
**字段名要与上游一致**:handler 里取的键就是上游 executor 从 `credential.values` 里取的那些。
