# skillhub kind:与 context 并列的 Agent Skill 仓库

> 2026-07-16。新增第八个 HTBP 节点 kind `skillhub`,把"可复用能力包(Claude Agent Skills)"补成树上一等能力:发布 skill 到服务器、任意 Agent 凭 SK + fetch 发现目录并拉取取用。

## 背景与决策

需求原话是"增加一个 skills 模块,往服务器上传 skill,通过 tool-bridge 直接获取",并明确"更像一个 skillhub,作为一个节点,和 device 并列"。三个决策(与用户确认):
1. **制品 = 多文件文本 bundle**(`<id>/SKILL.md` + 脚本/参考),非单文件、非二进制。理由:覆盖真实 skill(含 scripts/references),又避开仓库完全没有的归档/multipart/二进制上传通道。
2. **服务端解析 frontmatter**(Claude 约定 name/description)。这是 skillhub 相对"裸 context"的核心增值——`List` 直接给结构化目录、`Search` 命中 description,契合项目"渐进式发现"理念(先看目录再取正文)。
3. **Dashboard 完整集成**(挂载 + 浏览/发布/删除)。

## 关键洞察:平台自带 R2 → 零外部凭证

探索确认 `deps.objects()` 恒绑定平台 `TB_R2`(`gateway/src/app.ts`),`provider:'r2'` 的对象节点用平台自带桶、**不需要任何 authRef**。这直接决定 skillhub 建模为**内容型 kind(仿 context)**而非 builtin:builtin 的 `BuiltinDeps` 根本不带 `ObjectStore`,而 context 路径天然拿得到。于是 skillhub 几乎白嫖 context 的整套存储机制:`createObjectContextProvider`/`createR2ObjectStore` 提供 etag 版本、`$ref`/`~ref` 大对象中转、keyword Search、`skills/<path>` 前缀隔离、ttl/readOnly。**唯一净新逻辑**只有 core `skillhub/`:一个不引依赖的 frontmatter 最小解析器,和 `createSkillhubProvider` 里"以 `<id>/` 分组 + 读 SKILL.md 组装目录"这层薄语义。

## 加 kind 的接线是"照着 tool kind 走一遍"

`tool` 是最近一次端到端加 kind 的先例,路径固定:①core `types.ts` 的 `NodeKind`/`NODE_KINDS`/`NodeConfig`(注册期 `parseNodeInput` 读 `NODE_KINDS` 枚举,`assertKindConfig` 靠 config arm 自动生效);②gateway `tbApp.ts` 的 `handleInvoke` dispatch 块 + `helpModelFor`/`handleDescribe` 分支 + `assertSkillhubConfig` 两处注册校验;③`/~ref` 中继从 context 专用泛化为 context|skillhub;④CLI 命令族 + program 装配;⑤Dashboard 的 NodeKind/KindBadge/NodePage/RegistryPage/浏览器组件。**`tree/`/`visibility.ts`/`path.ts`/`registry.ts` 全 kind-agnostic,零改动**。

## 坑与注意

- **`~skill` 保留段 ≠ `skillhub` kind**:`~skill` 是任意节点的 GET 保留路径段(节点使用指南,当前 501 占位),`skillhub` 是 config.kind 判别值,二者正交无冲突。文档已显式点明,避免后人误改。
- **共用对象存储的类型收敛**:context 与 skillhub 的 config 同形,gateway 里把 `contextObjectStoreFor`/`s3StoreConfig`/`assertContextAlive`/`pruneExpiredContext` 的签名放宽到 `ObjectNodeConfig`(两者并集)复用,而不是复制一份——`ttl` 懒回收、`/~ref` 存活校验对两 kind 单点生效。
- **Publish 整体替换语义**:发布时删掉该 skill 前缀下未在本次提交的旧对象,避免残留文件泄漏到新版本;测试钉住。

## 验证

gateway `skillhub.integration.test.ts`(9 例,真实 workerd + 本地 R2:发布多文件→目录来自 frontmatter→Get 内联+清单→GetFile→Search→Remove、整体替换、缺 SKILL.md/缺 name·description 拒绝、readOnly、窄 scope、`~help`/`~describe`);cli `skillhub.test.ts`(12 例,fetch mock 断言精确 URL/body)。均全绿。相关文件:core `skillhub/{frontmatter,provider,help}.ts`、gateway `tbApp.ts`、cli `commands/skillhub.ts`。
