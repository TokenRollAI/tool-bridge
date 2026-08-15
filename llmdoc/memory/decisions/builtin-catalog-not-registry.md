# 决策:内置插件走编译期 catalog,不落库;读路径结构上不可写

> 用途:记录 2026-08-14 拍板的 builtin plugin 重构设计(Integration Redesign 提案的修订版),
> 供 catalog codegen、调用链改造与后续 Integration 编排面实现引用。
> 更新时机:阶段落地、求值前提被推翻或决策被替换时。

## 背景

99 个内置插件走的是"外挂 HTTP plugin"那套注册机制:探活 → 抓 `~describe` → mint token →
落 `plugin:` / `pluginmeta:` / `pluginhealth:` 三个 KV key。对同进程代码这套里只有
`~describe` 缓存有信息量,其余三件是仪式。由此长出四个缺陷(取证见 `.llmdoc-tmp/builtin-*.md`):

- **A1 读路径写库**:`requirePluginExport` 的 `manifest ??= autoRegisterBinding(deps, id)`
  让 help/call 这类读操作写 KV → 删除后一次读即"复活";且 7 个调用点里 4 个传 `deps`
  (会写)、3 个传裸 `store`(不写),**行为取决于先碰哪个端点**。
- **A2 两套状态机**:显式 register 做 7 件事,auto 做 3 件,落库形状不同且无对账。
- **A3 契约永久陈旧**:`pluginmeta:` 只在 endpoint/healthPath/protocolVersion 变更时刷新,
  而内置插件升级三者都不变。与 `toolcache:<path>` 的 300s TTL **时效不一致** ——
  升级后工具表 5 分钟自愈、export 契约永久陈旧,这才是"陈旧契约让不存在的 export 挂载成功"
  的完整机制。
- **A4 部署形态改变产品能力**:唯一装配点是 `gateway/src/deployEntry.ts`,
  `packages/server` 连 `@tool-bridge/plugins` 依赖都没有 → Node/Docker 官方镜像 catalog=0。

## 决策

1. **内置插件目录是编译期常量,不是运行时状态**。`~describe` 求值产物落
   `catalog.generated.ts` 提交入库;builtin 不再写 `plugin:` / `pluginmeta:` / `pluginhealth:`。
   A3 随之消失(descriptor 与代码同一份构建产物,不可能陈旧)。
2. **读路径无写由函数签名保证,不靠调用点传参**。解析函数只接受 catalog 与只读 store,
   **结构上拿不到写能力** —— 而不是"约定读路径要传裸 store"。这是 A1 的唯一彻底解法。
3. **免注册体验由 catalog 兑现,不由自动补注册兑现**。`autoRegisterBinding` 直接删:
   它存在的唯一理由是"describe 缓存在 KV 里",catalog 把那个前提消掉了。
4. **`system/plugin` 收窄为 external-only**,不再接受 `binding:` endpoint;
   新增只读 `system/catalog`(read scope)承担目录浏览。

## 求值前提(已实测,2026-08-14)

用 `scripts/probeDescribe.ts` 对全部 99 个插件求值:

- `~describe` **99/99 成功**,零网络、零凭证、零 env,产物合计 **18.9 KiB** → 可提交入库。
- **`dynamic: true` 不在 `~describe` 里**:`plugin-sdk` 只在 `help()` 输出它,`describe()`
  刻意让 proxyTools 与静态 tools **对外同一形状**(那是有意的协议设计)。故 codegen
  **无法从 descriptor 判断哪个 export 可静态化**。
- 静态 tools `List` 求值 98/99 成功,唯一失败是 feishu(proxyTools,缺凭证 503)。

**由此否决提案 4.1 的 `actions[]` 字段**:action 表求值产物 **2.49 MiB**,与
`packages/plugins/src` 的 schema 源码是同一份数据的两个副本,而工具表运行时本就走
`toolcache:<path>`。放进 catalog = 仓库与 Worker bundle 各多背 2.5 MiB,且 digest 会对
"改一行 description"敏感。**catalog 只存 descriptor**。

## 与提案的其余偏离

- **`configSchema` 改用 `mountConfigSchema`**:`core/src/plugin/package.ts` 已有 `configSchema`
  且语义相反(安装时收集、值注入为插件 Worker secrets = 凭证),`mountConfigSchema` 才是
  "每挂载非凭证配置"。同名反义会造陷阱;这两个字段当前零消费点,一并接线。
- **digest 两级**:per-entry digest + 覆盖 id 集合的 catalog-level digest。单级全量 digest
  会让任一 provider 的文案改动触发全局红灯,"三宿主一致"退化成噪声。
- **B2 在 P0' 只做 CLI**。B1-X 之后 `secret` 降为展示语义,Dashboard 表单**失去了机器可判的
  依据**来区分"字段进 secret 还是进 providerConfig",自由 k=v 文本框比现状更难自我解释。
  Dashboard 的 providerConfig 输入口等一个声明面落地后一次做对。**2026-08-15 更新**:那个声明面
  是 export 级 `mountConfigFields`(扁平字段,`core/src/plugin/contract.ts`),**不是**这里预期的
  包级 `mountConfigSchema`(那是插件包安装分发层,仍 P3 零消费点)。Dashboard `IntegrationDialog`
  已据 `mountConfigFields` 渲染带标签输入。契约面见 `reference/protocol-contract.md` 8/8a 节、
  边界与通道分工见 `guides/plugin-design-and-migration.md` 第二节。
- **A4 的措辞修正**:`opts.include` **是接了线的**(`registry.ts` `opts.include ?? Object.keys(…)`),
  没接线的是调用方(`deployEntry.ts` 不传)。

## 红线(继承提案第 11 节,不得越过)

- `node:`(NodeRegistry)与 `secret:`(SecretStore)是唯一权威存储;catalog 与 instance 都是派生视图。
- `Authorizer.Check` 是唯一权限判定入口,catalog 的 read scope 判定同样走它。
- 凭证不出网关;挂载内联凭证只经 SecretStore 通道。
- wire 兼容:已挂载节点的 `~help`/List/Call/envelope 零变化,存量 agent 无感。

## 关系

- 承接 [plugin-in-process-catalog.md](plugin-in-process-catalog.md):那份定了"可用 ≠ 实例化、
  单进程装载",本决策定"可用目录到底存在哪里"(答案:编译期产物,不是 KV)。
- [plugin-hosted-install.md](plugin-hosted-install.md) 的托管安装仍走 external 通道,不受影响。
