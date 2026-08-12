# Guide:Plugin 设计取舍与 open-connector 迁移

> 用途:两件事的单一入口 —— (1) 写/审 plugin 时该守的边界与已知取舍;(2) 把 open-connector
> 的 provider 迁成 tool-bridge plugin 的可重复流程与回归闸门。
> 来源:2026-08-12 三轮批量迁移(3 → 12 → 100 个 provider)+ 三个新能力(credentialProbe /
> credentialFields / oauth)+ 一次设计 review 的取证与修复。
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
| 出站只经 guardedFetch,跨源重定向剥凭证 | `plugins/src/_runtime/guardedFetch.ts` | SSRF 打内网/云元数据;或 302 一下把租户 API key 送给第三方 |
| 未配 `PLUGIN_TOKEN` 一律拒 | `plugin-sdk` `assertAuthorized` | 公网任何人自造 `X-TB-Context` 即可调该 plugin 全部 action,当匿名出站中转 |
| `credentialProbe` 必须只读、无必填入参 | `app/src/toolNodes.ts` `assertProbeShape`(从 List 核验) | 每次挂载都产生业务副作用;或永久拒绝挂载却报"稍后重试" |
| 密钥不进 `providerConfig` | 契约注释 + 作者纪律(**尚无机器校验**) | `system/registry get` 对只有该节点 read 的窄 SK 也明文回显 |

**判据**:凡是"靠作者纪律维持"的边界,在规模上都会失效。114 个产物由同一批人在同一周写完,
纪律还在;1000 个、尤其掺入外部 plugin 之后只剩声明。新增能力时先问一句"这条谁来强制"。

## 二、四条凭证通道,别混用

| 通道 | 装什么 | 谁能读 |
|---|---|---|
| `authRef` → secret(单值) | 一个 API key | 平台 resolve 后经 `X-TB-Upstream-Auth` 给该 plugin;SecretStore 只写不读 |
| `authRef` → secret(`credentialFields` 多字段) | app_id+app_secret、access key+secret+region… | 同上,SDK 按声明解析成 `ctx.credentials` |
| `authRef` → secret(`oauth` 模式) | **client 凭证**(clientId/clientSecret) | 只有平台读;插件拿到的是平台换来并刷新的 access token |
| `providerConfig`(`ctx.mountConfig`) | region / baseUrl override / 功能开关 / workspace 归属 | **该节点对应的 plugin + 任何对该节点有 `read` 的 SK** |

最后一行是关键:`providerConfig` 只发给那个 plugin(插件之间不共享),**但不是密钥通道** ——
`system/registry get` 按目标节点的 read 判定后 `return store.get(path)`,整个 config 明文回显。
放密钥进去等于绕过 SecretStore 的加密、只写不读、以及 `assertSecretRefUse` 的 admin 要求。

`oauth` 与 `credentialFields` **互斥**(契约当场拒):两者都在描述"authRef 指向的 secret 存
什么",而 oauth 模式下那个 secret 固定存 client 凭证。`oauth` 与 `credentialProbe` 同样互斥:
OAuth 的凭证可用性由授权流程本身证明,拿 client 凭证去调用既证明不了什么、又会把 clientSecret
送进插件。

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
  都走了 `guardedFetch`/`requireApiKey`、`git status` 里有没有 ` M`(agent 只该新增)。
- **agent 会中途挂**。实测三个因 API 连接中断退出,留下半成品。形状闸门是发现它们的手段。
- **pre-commit 的全仓 typecheck 会被在途文件挡住**。把提交安排在整批结束后,别中途试。
- **别信静态正则的批量扫描**:凭证常经 helper 间接传入(`buildUrl(path, requireApiKey(...))`),
  行级 grep 会漏。要判"凭证进了 URL 还是 header"就逐个看 `requireApiKey` 的数据流向。

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

| 操作 | 耗时 |
|---|---|
| `builtinPluginBindings()` 装配 116 个 binding | **0 ms**(只建 Map + 闭包,不 import) |
| 首次调用一个 binding(加载 + 实例化) | ~216 ms |
| 全量加载 116 个 | ~964 ms(均 8.3 ms) |

懒加载确实生效 —— 装配零成本。但全量外推到 1000 个是 **~8 秒**,对 Workers 启动预算是硬约束:
CF 侧必须靠构建期 `include` 裁剪集合,不能指望运行时懒加载兜住。

另有两处随注册数(而非装配数)线性增长、到 1000 会成问题:`system/plugin` 的 `catalog` 全量
分页扫 `plugin:*`;plugin 变更时 `registry.subtree('')` 全树扫反查挂载。
