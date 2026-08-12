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

## 已知需要手写的形状

- `anyOf`/`oneOf` 与 `type`/`properties` **同级共存**(如 resend 的"html/text 二选一必填"):
  Zod 侧要写 `.refine()`,而 refine 无法反推进 JSON Schema,闸门判不了。codegen 在这里
  **硬失败**,交由人工写这一个 schema 并登记豁免。
- `$ref` / `$defs`:需要先决定 Zod 侧的复用形态(提取成共享常量)。当前批次没有,不臆造实现。

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
