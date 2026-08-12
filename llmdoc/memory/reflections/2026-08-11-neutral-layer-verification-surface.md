# 反思:把中立层的验证面搬到中立宿主——测试跑在哪里,决定了它在验证什么

## Task

- 承接 `[[2026-08-11-host-neutral-layer-extraction]]`:中立层已抽成 `@tool-bridge/app`,但它的行为仍全靠 gateway 的 workerd 套件覆盖。用户批准建议 #2:把只经 `SELF.fetch` 驱动的集成测试迁到普通 Node vitest,直打 `createTbApp`。结果 13 个文件搬到 `packages/app/test`(app 12 文件 121 例 ~1.2s;gateway 剩 6 文件 76 例),新增 `harness.ts` + `memorySearchIndex.ts`,四个 publish workflow 的 test 闸门重排。

## Durable Lesson

1. **先数"这套测试实际用到了多少宿主能力",再决定它该跑在哪。** 判断 workerd 池买到了什么保真度,靠的不是读测试标题,是几条 grep:`runInDurableObject` / `listDurableObjectIds` / `env.TB_R2` / `env.ASSETS` / `env.TB_DEVICE` 在这 13 个文件里出现 **0 次**,唯一的宿主接触面是 `SELF.fetch(url, init)`。而 `app.request(url, init)` 与它签名一致——迁移因此是机械替换,不是重写。**"这批测试跑在真实运行时里"是个容易自我感动的说法;要问的是它们碰没碰只有那个运行时才有的东西。**
2. **中立性该被执行验证,不只是被静态约束。** 上一轮的 `types: []` 只保证"源码里写不出 `KVNamespace`";这一轮让同一棵树在 Node 下真跑起来,才排除运行期才暴露的宿主耦合。把 `test/` 一并纳入 `types: []` 是同一条逻辑的延伸:测试若能用 `process`/`Buffer` 写断言,它就不再是中立面的见证人。**静态约束管"写不出",执行验证管"跑得动",两者不能互相替代。**
3. **迁移暴露的三处失败,全是宿主装配的缺口,不是树的 bug——这本身是收获。** `/~mcp` 只在注入 SearchIndex 时才投影 `tb_search`、`/~search` 缺索引直接 404、OAuth 的 `redirect_uri` 断言硬编码了 `wrangler.jsonc` 里的**生产域名**。前两条说明"哪些能力是可选注入点"这件事此前只被隐式满足(gateway 恰好接了 D1),换宿主才显形;第三条是测试对部署配置的真实耦合,借这次拆掉。**换一个宿主重跑,和换一层严格类型重编译一样,是廉价的存量问题探针。**
4. **补一个内存实现,比把用例留在旧宿主更划算。** 为了不丢搜索相关用例写了 `MemorySearchIndex`,刻意复用 core 的序列化 / digest / query 预处理 / cursor 加解密,只把全文匹配换成子串——**适配器之间的一致性应当来自共享代码,而不是各自复制同一套规则**。副产品是第三个 `SearchIndex` 参考实现(D1 / SQLite / 内存),证明该注入点既不绑 SQL 也不绑 CF。它有资格提升进 core 当 SDK 的默认内存搜索,本轮克制没做——那是独立决定,不该混进一次测试迁移。
5. **"某某套件是不是发布闸门"随包边界变化,必须逐个 workflow 重算。** app 的产物被 gateway / sdk / server 三者 bundle,所以 app 的 Node 套件是这四个包**共同**的闸门;反过来 gateway 套件不再是树行为的闸门,只覆盖 CF 适配那一层。这个映射没有工具兜底,只能在包边界变动时手动过一遍每个 `publish-*.yml`。
6. **worktree 里写文件,写完要确认写进了哪一份工作树。** 上一轮的 `publish-app.yml` 落在了主仓库 checkout 而不是本 worktree,未被任何提交收录,直到这轮编辑报 `File not found` 才发现。`git status` 在正确的工作树里是干净的,**"没报错"和"改对了地方"是两回事**;新建文件后一次 `git status` 就能兜住。

## Promotion Candidates

- 测试实践指南可加一条**宿主选择准则**:集成测试默认跑在最中立的宿主上,只有真正触达宿主专属原语(DO / 真实 KV·R2 binding / Static Assets / env 开关的 opt-in)的用例才付重型运行时的启动开销;新增用例先自问"它碰了什么只有那个运行时才有的东西"。
- 可补一条**注入点参考实现准则**:每个可选注入点至少要有一个不依赖外部服务的内存实现,且共享逻辑下沉到 core,适配器只负责存储/查询原语。
