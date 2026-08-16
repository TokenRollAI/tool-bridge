# Guide:Plugin 设计取舍与 open-connector 迁移

> 用途:两件事的单一入口 —— (1) 写/审 plugin 时该守的边界与已知取舍;(2) 把 open-connector
> 的 provider 迁成 tool-bridge plugin 的可重复流程与回归闸门。
> 来源:2026-08-12 三轮批量迁移(3 → 12 → 100 个 provider)+ 三个新能力(credentialProbe /
> credentialFields / oauth)+ 一次设计 review 的取证与修复;2026-08-14 内置目录改编译期 catalog;
> 2026-08-15 export 级 mountConfigFields(providerConfig 的声明面);2026-08-17 per-export auth/
> catalog 契约与飞书敏感重定向防线。
> 更新时机:plugin 契约面变化、迁移流水线改动、或新的安全/规模边界被实测出来时。
>
> **这里只写方法与判据,不记单个 plugin 的清单** —— 产物级细节(哪些 provider 已迁、各自的
> 取舍、凭证进 URL 的名单)在 `packages/plugins/MIGRATION.md`,那是随产物一起变的东西。

## 一、Plugin 是特权代码

按 [plugin-in-process-catalog](../memory/decisions/plugin-in-process-catalog.md) 决策,内置
plugin 与网关**同进程、同权**,没有任何隔离层。这条决定了下面每个边界的必要性:

| 边界 | 机器保证在哪 | 违反的后果 |
|---|---|---|
| plugin 的 `env` 只有白名单 | `plugins/src/registry.ts` `narrowPluginEnv` | 一行 `ctx.env.TB_SECRET_ENCRYPTION_KEY` 拿到 SecretStore 主密钥,「凭证不出网关」归零 |
| 出站只经 guardedFetch,敏感请求跨源重定向直接拒 | `plugins/src/_runtime/guardedFetch.ts` + ESLint 裸 fetch 禁令 | SSRF 打内网/云元数据;或 redirect 把自定义凭证头乃至 307/308 保留的 secret body 送给第三方 |
| 外挂 endpoint 未配 `PLUGIN_TOKEN` 一律拒 | `plugin-sdk` `assertAuthorized` | 公网任何人自造 `X-TB-Context` 即可调该 plugin 全部 action,当匿名出站中转。**进程内 binding 例外**:标识走 `env.TB_PLUGIN_IN_PROCESS`(宿主装配时闭包持有,网络请求碰不到)而非 header —— 用 header 表达"我是进程内"等于把 fail-closed 拆了 |
| `credentialProbe` 必须只读、无必填入参 | `app/src/toolNodes.ts` `assertProbeShape`(从 List 核验) | 每次挂载都产生业务副作用;或永久拒绝挂载却报"稍后重试" |
| 密钥不进 `providerConfig` | 契约注释 + 作者纪律(**尚无机器校验**) | `system/registry get` 对只有该节点 read 的窄 SK 也明文回显 |
| 读路径不写库 | core `plugin/catalog.ts` 的解析函数只吃 `ReadOnlyStore` | 曾靠"调用点传裸 store"维持,结果 7 个调用点 4 个传了可写的 deps:删掉一个插件后随便读一次就复活,且四条链行为各异 |

**判据**:凡是"靠作者纪律维持"的边界,在规模上都会失效。114 个产物由同一批人在同一周写完,
纪律还在;1000 个、尤其掺入外部 plugin 之后只剩声明。新增能力时先问一句"这条谁来强制"。

## 二、四条凭证通道,别混用

export 必须把凭证语义说完整:`auth:none` 明确无凭证;`auth:single` 表示单值并可声明
`required/label/description`;多字段与 OAuth 仍走各自声明。仓内 open-connector 迁移 provider 的
handler 全部以 `requireApiKey` fail closed,故共用装配器自动声明 `auth:single(required:true)`;
旧第三方 descriptor 缺 `auth` 时继续兼容成可选单值。不要从 `credentialProbe` 猜必填 —— 探针只
描述“有凭证时怎么验”,不是凭证基数。Notes 这类本地能力应显式 `auth:none`,否则管理面只能猜。

| 通道 | 装什么 | 谁能读 |
|---|---|---|
| `authRef` → secret(单值) | 一个 API key | 平台 resolve 后经 `X-TB-Upstream-Auth` 给该 plugin;SecretStore 只写不读 |
| `authRef` → secret(`credentialFields` 多字段) | app_id+app_secret、access key+secret+region… | 同上,SDK 按声明解析成 `ctx.credentials` |
| `authRef` → secret(`oauth` 模式) | **client 凭证**(clientId/clientSecret) | 只有平台读;插件拿到的是平台换来并刷新的 access token |
| `providerConfig`(`ctx.mountConfig`;声明面 `mountConfigFields`) | region / baseUrl override / 功能开关 / workspace 归属(非密钥) | **该节点对应的 plugin + 任何对该节点有 `read` 的 SK** |

最后一行是关键:`providerConfig` 只发给那个 plugin(插件之间不共享),**但不是密钥通道** ——
`system/registry get` 按目标节点的 read 判定后 `return store.get(path)`,整个 config 明文回显。
放密钥进去等于绕过 SecretStore 的加密、只写不读、以及 `assertSecretRefUse` 的 admin 要求。
输入口是 `tb tool mount --config k=v` / `tb ctx mount --config k=v` 与 Dashboard 向导的
config 行(共享 `cli/src/registry.ts` 的 `parseConfigSpecs`);值一律按字符串收,不猜类型转换。

这条通道此前只有输入口、没有**声明面** —— 该配哪些 `providerConfig` 全靠用户猜或读插件源码。
export 现在可选 `mountConfig(fields)`(plugin-sdk setter,`~describe` 落 `mountConfigFields`,
tools/context 都支持)补这个缺口:字段是扁平的 `{key,label?,description?,required?}`,管理面据此渲染带
标签输入框、必填缺失挂载前拦下(CLI `assertMountConfig`、Dashboard 向导)。与 `credentialFields`
的边界是**硬的、不是风格选择**:值明文进 providerConfig,故 `PluginMountConfigField`(core
`plugin/contract.ts`)**刻意没有 `secret` 字段** —— 给了就等于诱导把密钥塞进不加密的通道,
密钥永远走 `credentialFields`。`required` 缺省 = **非必填**(与 providerConfig "有就用没有走默认"
一致;凭证字段缺省是**必填**,方向相反 —— 少个 baseUrl 多半有云端兜底,少个凭证字段必然调不通)。
与 `credentials()`/`oauth()` **不互斥**:一个 export 可以既要凭证又要 baseUrl。catalog 的真源是
`CatalogListItem.exportDetails[exportId]`;provider 级 `mountConfigFields`/`credentialFields`/`needsOAuth`
仅为旧客户端兼容提示。任何表单或 CLI 都必须按选中的 export 读精确契约。

**`credentialFields[].secret` 是展示语义,不是通道语义。** 声明了 `credentialFields` 的
export,它的**全部字段**都进 authRef 指向的那个 secret —— 运行时 `assertToolConfig` 把整份声明
交给 core `parseCredentialValues`,后者要求每个 `required !== false` 的字段都出现在解出的 JSON
里。`secret: false` 只表示"这个值不敏感,输入框不必遮蔽"(如 baseUrl)。**按它分流进
`providerConfig` 是错的**:Dashboard 曾这么引导,照做则挂载必被拒,精确影响 8 个声明了
`secret: false` 的 provider。非凭证的挂载配置该由 export 用上面的 `mountConfigFields` 独立声明,
而不是混在凭证字段里靠一个布尔标志区分。**别和 `PluginPackage.mountConfigSchema` 混**(core
`plugin/package.ts`):那是插件包**安装分发单位**的 JSON Schema 配置(P3,当前零消费点),
`mountConfigFields` 是 **export 挂载**时的扁平字段声明,两个不同层。

`oauth` 与 `credentialFields` **互斥**(契约当场拒):两者都在描述"authRef 指向的 secret 存
什么",而 oauth 模式下那个 secret 固定存 client 凭证。`oauth` 与 `credentialProbe` 同样互斥:
OAuth 的凭证可用性由授权流程本身证明,拿 client 凭证去调用既证明不了什么、又会把 clientSecret
送进插件。这三处互斥 `plugin-sdk` 的 setter 里也拒一遍 —— 平台契约层本就会拒,但那要等
注册时才 400,作者看到的是个远端错误;在 SDK 炸,错误发生在写代码的地方。

**一条查证过的教训:"平台侧通了"不等于"能用"。** `providerOAuth.ts` 的托管授权码流程
带 16 个端到端集成测试,却有很长一段时间没有任何插件能触发它 —— `plugin-sdk` 上根本没有
`oauth()` 声明面,连那些集成测试都是手写 `~describe` 绕过 SDK 的,in-repo 零产物用过这条路。
判"某能力可不可用"要看**声明面到消费面这条链是否闭合**,不能只看流程实现与测试数;
"零产物用过"本身就是最强的信号。

## 二之二、出参形状:业务字段与信封键的碰撞

`toToolResult`(core `operation/registry.ts`)把 handler 的裸返回值包成 `ToolResult`。
它曾用"对象里有没有 `content` 键"当判据 —— 而 `content` 在业务出参里是**极常见的字段名**
(GitHub 的 reaction `{id, content:'+1', user}`、文件内容、标注正文)。后果:这些对象被
当成信封透传,顶层其余字段全部降级成 `ToolResult` 上的野键。

**这类缺陷的危险在于它不报错、不掉测试** —— 调用方只是静默少字段。实测 11 处出参声明
踩到(6 个 provider),全部靠读代码发现,没有任何一条测试红过。

判据现在是**键集合不含外来键**:`ToolResult` 是封闭形状(`content`/`contentBlocks`/
`isError`/`structuredContent`),所以 `{content, isError}` 是信封、`{content, id, user}`
是业务对象。筛查命令(新增产物后可复跑):

```bash
cd packages/plugins && node -e '
const fs=require("fs");
for (const d of fs.readdirSync("src",{withFileTypes:true}).filter(x=>x.isDirectory())) {
  const f=`src/${d.name}/schema.ts`; if(!fs.existsSync(f))continue;
  const s=fs.readFileSync(f,"utf8");
  for(const m of s.matchAll(/export const (\w+Output) = z\.(strict|loose)Object\(\{([\s\S]*?)\n\}\)/g))
    if(/^  content: /m.test(m[3])) console.log(d.name, m[1]);
}'
```

**推广的判据**:凡是"平台按某个键的存在与否推断值的语义"的地方,都要问一句"这个键名
在业务数据里常见吗"。常见就不能只看存在性 —— 要么看完整形状,要么换一个不可能碰撞的
承载方式。

## 三、错误语义:三个反复踩的错位

1. **缺配置 ≠ 服务故障**。漏配 `authRef`、探针形状不合规、出站目标是内网 —— 都是
   `invalid_argument`。归 `unavailable` 会让 agent 对一个**永远不会变**的结果反复重试
   (`unavailable` 属可重试三码)。
2. **拦截 ≠ 崩溃**。自定义错误类型若不继承 `TBError`,冒到 plugin-sdk 的归一处一律变成
   `internal` 500「internal plugin error」——"我们拦下了一次 SSRF"对运维呈现为"插件崩了"。
3. **注释里承诺的机制要真的存在**。`shouldRefresh` 曾写"靠 401 触发",而 provider 这条路上
   没有"401 → 刷新重试"的实现;同一句话在 mcp 那条**是**成立的(MCP SDK 内部会刷新)——
   跨语境搬注释是这类空头承诺的主要来源。

## 四、有状态 plugin 的分区键

`export default createXxxPlugin()` 是**模块级单例**,同一部署服务多个挂载。分区键**不是
`mountPath`**:一个部署的 tools 与 context 两个 export 会挂在不同路径,而它们本该看到同一份
数据(那正是"一个部署同时导出动作面与内容面"的意义)。

正确做法:让挂载方声明归属 —— `providerConfig: { workspace: 'team-a' }`。同 workspace 共享,
不同的互不可见,没声明的落默认区(单团队零配置)。KV/D1 的 key 带这个前缀。

机器迁移的产物**全部无状态**(配置走 providerConfig 与 authRef),这条只对手写 plugin 成立。

## 五、迁移流水线(`packages/plugins/scripts/migrate/`)

open-connector 有 1329 个 provider、约 104 万行,且基本逐个手写(全仓只有 1 个带
`generate.ts`)—— 没有"改生成器重跑"的捷径,也不可能人工重写。

**产物是我们自己的 tool-bridge 源码**(Zod schema + `register()` + `TBError` + 自有出站防线),
不是运行时包一层适配器。曾试过适配器路线并废弃:vendored 代码永远是外来的,风格、校验、错误
语义全靠适配层临时翻译,欠债只会越滚越大。

### 四个阶段

1. **抽取** —— 直接 `import()` 上游 `definition.ts` 求值。不解析 AST、不做正则匹配。
2. **Schema codegen** —— JSON Schema → Zod 源码。覆盖面不是猜的:上游 `s.*` builder 能产出的
   关键字是有限集合,逐条对着写;遇到表外关键字**直接抛**,不静默降级成 `z.unknown()`。
   生成后过仓库自己的 `eslint --fix`。
3. **业务逻辑机械改写**(刻意不自动化)—— 逻辑本体保留,只本地化三处:凭证取法、出站换
   `guardedFetch`、错误换 `upstreamError`。生成 handler 骨架只会掩盖"没迁完"。
4. **两道闸门** —— 见下节。

### 为什么 codegen 必须走 Zod 而不是 `rawInputSchema`

`OperationSpec.rawInputSchema` 收裸 JSON Schema,但走它平台**不校验入参**。1300 个 provider
全走逃生阀等于整体拆掉入参防线。所以宁可把 builder 的关键字逐条翻成 Zod。

## 六、回归闸门:三道,各管一件事

| 闸门 | 管什么 | 位置 |
|---|---|---|
| 等价闸门 | 契约有没有在翻译中漂移 | `plugins/test/migration/schemaParity.test.ts` |
| 形状闸门 | 产物拼得起来、宣告与可调用集合吻合、接线没漏 | `plugins/test/migration/producedShape.test.ts` |
| wire 测试 | 迁完还能不能用(经真实 envelope) | `plugins/test/providers/<service>.test.ts` |

三者不可互相替代。**形状闸门是批量 fan-out 的必需品**:实测有 agent 只产出 `api.ts`、
漏了 `index.ts` 与测试,而它的测试"全绿"——因为压根不存在。

### 等价闸门存指纹而非完整 schema

上游 schema 的 sha256 存在**一份** `packages/plugins/migration-fingerprints.json`。理由:
它与 `schema.ts` 本就是同一份信息的两种表示(闸门做的正是"两者应该等价"的比对),存全量是
~40 MB 的仓库重量;而按 provider 分散存会让每个产物目录多一个与业务无关的文件。

指纹取在 **normalize 之后** —— 可论证保语义的等价写法不该让指纹白白失配。代价是改 normalize
规则会让全部指纹失效,故用 `normalizeVersion` 显式标记:闸门先查版本一致,不一致直接报
"须重新生成",而不是抛一堆莫名的不匹配。

**归一化只做可论证保语义的整形**,每条都要写得出理由(`additionalProperties:true` ↔ `{}`、
`z.record` 的 `propertyNames`、`z.int()` 的 ±2^53 边界、format 自带正则)。其余任何差异一律
红灯 —— 想收紧或放宽某个 schema,手改后登记进该产物的 `handwritten.json`,**漂移只能是声明
过的**。

### 闸门有效性要实测

改动闸门实现后(比如从全量 schema 换成指纹),要注入一次真实漂移验证它还抓得住:去掉某个
字段的 `.min(1)`,闸门应精确红在那一个 action 上。绿灯本身不是证据。

## 七、批量 fan-out 的操作纪律

- **先 scout 再 fan-out**。确定性步骤(codegen)自己跑完,只把判断密集的部分(业务改写)交给
  agent。schema 是机器活、有闸门兜底,不该占 agent 预算。
- **先跑全量探针再动手**。首轮实测干净率 62.9%,而前两名根因都是流水线自身的疏漏 ——
  按根因排序修完直接到 77.4%。逐个 provider 试错要慢得多。
- **测试绿 ≠ 做完**。收尾要 grep 一遍:有没有 import 上游 helper、有没有裸 `fetch(`、是不是
  都走了 `guardedFetch`/`requireApiKey`、`git status` 里有没有 ` M`(agent 只该新增)。仓库 ESLint
  已禁止 plugin 业务源码直接调用 `fetch`/`globalThis.fetch`,新例外必须在 runtime 边界集中审查。
- **自定义敏感头或 secret body 要把跨源 redirect 设为 error**。只剥标准 Authorization 不够:
  飞书 MCP 用 `X-Lark-MCP-TAT`,租户 token body 又可能被 307/308 原样重放。调用
  `createGuardedFetch({crossOriginRedirect:'error',sensitiveHeaders:[...]})`;精确头名也会在普通
  follow 模式跨源时被剥。测试至少钉住“只打一跳、第二个 transport 未收到 body/头”。
- **agent 会中途挂**。实测三个因 API 连接中断退出,留下半成品。形状闸门是发现它们的手段。
- **pre-commit 的全仓 typecheck 会被在途文件挡住**。把提交安排在整批结束后,别中途试。
- **别信静态正则的批量扫描**:凭证常经 helper 间接传入(`buildUrl(path, requireApiKey(...))`),
  行级 grep 会漏。要判"凭证进了 URL 还是 header"就逐个看 `requireApiKey` 的数据流向。
- **要设计成可断点续跑**。agent 会因连接中断、额度耗尽成批退出(实测一轮 13 个全挂)。
  未完成 ≠ 删掉重来:schema 是确定性产物,值钱且可复用。把半成品连同指纹登记撤到
  `.pending-migration/`,补完时移回即可 —— **半成品留在指纹清单里会让形状闸门长红,
  反而看不出真问题**。
- **wire 测试绿 ≠ 类型对**。vitest 不做 typecheck。实测 7 个产物的同名 helper 各自
  独立写出同一个类型缺陷,测试全绿而 `tsc` 红。批量收尾必须单独跑一次 typecheck,
  以及 `eslint --fix`(生成/改写代码里 sort-imports 与 no-use-before-define 成片出现)。
- **选批要用数据,不要凭印象**。先跑全量探针拿到逐 provider 的干净度,再取
  "价值 ∩ 可行性";脏度高的 provider 不值得为它开手写豁免,能力与既有产物重复的直接剔。

## 七之二、两个查起来很绕的假象

- **`new Response('', {status: 204})` 在 undici 下直接 TypeError**(204/205/304 是
  null body status)。这个异常冒到 plugin-sdk 的归一处会变成 `internal` 500
  「internal plugin error」—— 看起来像产物崩了,实际是**测试构造响应**的那一行写错。
  查法:直调 handler 看原始异常,别只看 envelope 回的错误码。
- **写豁免理由时不要凭 schema 的截断输出推断**。实测把 `anyOf`(跨字段存在性约束)
  误写成"按类型的 `oneOf` 分支",据此写出的判别联合会把契约收得**比上游窄**
  (某记录类型用另一个字段给值,上游接受、判别式会拒)—— 那是行为变更,不是迁移。
  执行者读到与源码不符的任务说明,应按源码做并回报。

## 八、不该走迁移这条路的 provider

迁之前先看它是不是**本来就有原生 kind**:

- 上游的 MCP 代理型 provider(如 `cloudflare_docs` 转发到官方 MCP)→ 直接挂 `kind:'mcp'`。
  迁成 plugin 等于在 MCP 客户端外再套一层 plugin 协议,平白多一跳还要自己维护会话复用。
- 纯 HTTP 转发且工具表固定的 → 评估 `kind:'http'` 是否够用。
- 依赖上游 `transitFiles`(二进制文件中转)的 → **平台侧还没有这个能力**,跳过。不要写成
  "调用即抛 unavailable"的幽灵工具,那与装配期校验的原则相反。

## 九、两个上游状况(迁移改不了,但要知道)

- **34.3% 的 action 没有 `required` 声明**(实测 4278/12474,涉 1049 个 provider),而它们的
  executor 里常有必填断言 —— 上游的 schema 与实现本来就不一致。codegen 忠实反映 schema
  (全部 `.optional()`),必填断言保留在 `api.ts` 里抛 `invalid_argument`。**不要**在 codegen 里
  按 executor 反推必填:那是猜,且会让"schema 是唯一真源"失效。
- 一批 provider 把凭证放在 **URL**(query 参数或路径段),换 header 会直接 401 —— 迁移没有
  选择余地。这类挂载前要确认部署侧的日志脱敏策略(名单在 `MIGRATION.md`)。

## 十、规模数字(116 个内置插件实测)

> 实测于策展前的 116 个目录。目录后来按价值策展到 68 个,但**结论不变** ——
> 有意义的是每插件均摊 8.3 ms 这个斜率,不是当时的总数。

| 操作 | 耗时 |
|---|---|
| `builtinPluginBindings()` 装配 116 个 binding | **0 ms**(只建 Map + 闭包,不 import) |
| 首次调用一个 binding(加载 + 实例化) | ~216 ms |
| 全量加载 116 个 | ~964 ms(均 8.3 ms) |

懒加载确实生效 —— 装配零成本。但全量外推到 1000 个是 **~8 秒**,对 Workers 启动预算是硬约束:
CF 侧必须靠构建期 `include` 裁剪集合,不能指望运行时懒加载兜住。

另有两处随注册数(而非装配数)线性增长、到 1000 会成问题:`system/plugin` 的 `catalog` cmd 全量
分页扫 `plugin:*`;plugin 变更时 `registry.subtree('')` 全树扫反查挂载。**`system/catalog` 不在
其中** —— 它读的是内存里的编译期常量,零 KV 往返(降序代价是它只覆盖内置目录,external plugin
仍走注册表)。

## 十一、内置插件不需要注册

**内置插件的目录是编译期常量**,由构建期求值每个插件的 `~describe` 生成
(`packages/plugins/scripts/generateCatalog.ts` → `src/catalog.generated.ts`,99 条 / 35.9 KiB)。
决策与求值前提见 [builtin-catalog-not-registry](../memory/decisions/builtin-catalog-not-registry.md)。
对写/审 plugin 的人,三条直接后果:

- **别写"先 `tb plugin register` 再挂载"的文档或引导**。内置插件直接 `tb integration add`
  或 `tb tool mount --provider <id>` 即可用;`system/plugin` 那条路是给外挂 https 部署的
  (它在网络那头,探活与契约校验是必要前置)。
- **改了 export 的声明就要重跑 codegen**:`pnpm --filter @tool-bridge/plugins generate:catalog`。
  闸门在 `test/runtime/catalogCodegen.test.ts`(逐条对拍求值 digest),忘了会红在 `pnpm verify`。
  为什么闸门放 test 而不是 build:verify 比发布 workflow 的 build 早得多,漏到打 tag 之后
  返工要删 tag 重打。
- **`~describe` 必须是纯内存、零凭证、零 env 的**(现状 99/99 如此)。codegen 会真调它;
  一个需要网络或凭证才能 describe 的插件进不了目录。另注意 **`dynamic: true` 不在 `~describe`
  里** —— plugin-sdk 只在 `help()` 输出它,`describe()` 刻意让 proxyTools 与静态 tools 对外
  同形状,故 codegen 无法从 descriptor 判断哪个 export 是动态的。
