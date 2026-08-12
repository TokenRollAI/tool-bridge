# 从 open-connector 迁移 provider

open-connector 有 1329 个 provider、约 104 万行,且基本是逐个写出来的(全仓只有 1 个带
`generate.ts`),没有"改生成器重跑"这条捷径。

本流程的产物是**我们自己的 tool-bridge 插件源码** —— Zod schema、`plugin.tools().register()`、
`TBError`、自有的出站防线。不是运行时包一层适配器:那样 vendored 代码永远是外来的,
风格、校验、错误语义全靠适配层临时翻译,欠债只会越滚越大。

## 一个迁移产物长什么样

```
src/<service>/
  schema.ts               # Zod 声明 + 语义标注 —— 由流水线生成,之后归本仓库所有
  api.ts                  # 业务逻辑 —— 人工机械改写
  index.ts                # 装配 —— 把两张表对起来
  upstream.snapshot.json  # 迁移时的上游 schema 快照 —— 等价闸门比对它
  handwritten.json        # 可选:手写豁免清单
```

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
  JSON Schema,与 `upstream.snapshot.json` 逐 action 比对。这是让批量迁移可信的东西:
  1329 个 provider 不可能靠人肉 review,这条测试把它变成 CI 里的机器判定。
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

### 已知缺口:`credentialValidators` 整体没有落点

上游每个 provider 都带一个 `credentialValidators`,在**存凭证时**打一个最便宜的接口验证
key 可用,并回填 `profile`(账号身份)与 `grantedScopes`。迁移产物**一个都没迁**——不是遗漏,
是 tool-bridge 的插件契约里没有对应的生命周期钩子:凭证由平台 `tb secret set` 存入
SecretStore,挂载时只写 `authRef`,插件侧要到**第一次调用**才拿得到它。

后果:配错的 key 不会在 `secret set` 或挂载时报错,而是等到第一次调用才 401。这对 agent
消费者不算致命(错误消息说得清),但比上游体验差一档。

要补的话是平台侧工作,不是流水线能解决的,大致两条路:
- plugin 协议加一个可选的 `Validate` 动词,`system/secret` 或挂载时调用;
- 或挂载时按 `~describe` 里声明的某个 read 动作做一次真实探活。

在此之前,迁移产物里凡是上游有 `phase: 'validate'` 分支的(把 4xx 压成 400 之类),
一律**不迁那条分支** —— 它只服务于 validator 路径,execute 路径本来就走不到。

### 下一批的建议

剩余 ~170 个"codegen 全干净 + 纯 api_key + 单文件"的候选可以直接照这个流程跑。
再往后要先在 codegen 里支持 `allOf`/`not`/顶层 `$schema`,或接受它们走手写豁免。
`oauth2`(42 个)与 `custom_credential`(54 个)需要平台侧先补凭证通道,不在流水线射程内。
