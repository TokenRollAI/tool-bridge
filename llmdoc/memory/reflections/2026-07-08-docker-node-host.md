# 反思:Docker/Node 宿主部署路径全量交付

## Task

- 新增 `packages/server` 包(Node 宿主),交付 Dockerfile 与 `publish-server.yml` / `publish-docker.yml` 双 CI,分 5 个阶段独立提交。
- 验收:全量 `pnpm verify` 绿 + 本机 Node 进程与 Docker 容器双重验收(smoke / verify-device / verify-plugin 全过,`docker restart` 持久化断言过)。

## Expected vs Actual

- 预期:core/gateway 已宿主中立,server 包主要是薄注入层 + 打包/CI 平移既有发布模式。
- 实际:功能面按预期达成,但被一起**与本任务代码完全无关的环境污染**烧掉大量排查时间;另踩到 dts 构建、鸭子类型流接口、端口 env 解析、pnpm deploy 四个真实实现坑。

## What Went Wrong

1. **环境污染型测试失败排查走了大弯路(最大教训)**。gateway 集成测试全量启动失败,报 `The requested module '@vitest/expect' does not provide an export named 'ChaiStyleAssertions'`。我按"版本不兼容"直觉依次排除:业务代码、vitest-pool-workers 版本、vitest 版本 pin、node 版本、`pnpm dedupe`——全部无效。真正根因(后台 worktree agent 用 `NODE_DEBUG=vitest-pool-workers:module-fallback` 日志抓到):7 月 5 日有工具在仓库根跑过 `npm install`,在 pnpm 仓库的 `node_modules` 里留下 vitest 3.2.6 时代的 npm 实体目录(非 symlink);miniflare 的 module fallback service 做 Node 向上解析时命中了这份旧 `@vitest/expect`。修复 = `rm -rf node_modules && pnpm install`。
2. **tsup dts `resolve: true` 打坏 node 内置模块类型**:server 包 dts 构建把 `http.Server` 降级成 `undefined`(rollup-dts 试图内联 `node:http`)。修复 = `dts.resolve` 收窄为数组,只内联 workspace 包(`['@tool-bridge/core','@tool-bridge/gateway']`)。sdk 此前没踩到,只因其公开面不含 node 内置类型——不是模式本身安全。
3. **core 最小流接口缺可选 `cancel`,Node 宿主炸 unhandled error**:tbApp 把 ObjectBodyStream 强转 ReadableStream 交给 Response。Workers 下 R2/S3 body 是真 ReadableStream 无事;Node undici 收尾会调 `reader.cancel` → TypeError。且内容已送达、测试全绿,只有 unhandled error 冒出,极易漏掉。修复 = core `bytesToObjectStream` 补可选 `cancel`。
4. **`TB_PORT=0` 被 `positiveIntEnv` 吞掉**:0(OS 分配临时端口)不是正整数,被静默回落到默认 8787,两个测试文件并行时撞端口。端口解析需单独允许 0。
5. **pnpm v10+ `pnpm deploy` 需要 `--legacy`**(未设 `inject-workspace-packages` 时),Dockerfile 首次构建即报错。

## Root Cause

1. 排查弯路的根因是**假设空间缺了一个维度**:症状措辞("does not provide an export")强指版本不兼容,于是所有假设都在"声明的版本矩阵"里打转;而实际故障在"磁盘上的 node_modules 与 lockfile 声明不一致"这一层。当版本矩阵全部核对正确而症状不消失时,应立即切换到检查安装产物本身:pnpm 仓库顶层 node_modules 出现**非 symlink 实体目录**或 `.package-lock.json`,即是被 npm/yarn 污染的铁证。
2. dts 坑的根因是 `resolve: true` 是"全内联"语义,遇到解析不了/不该内联的 node 内置模块会静默降级类型而非报错;正确姿势是白名单式只内联 workspace 包。
3. 流接口坑的根因是"结构兼容"鸭子类型按**最宽松**消费方(Workers)对齐了形状,而跨宿主后新消费方(undici)会调用可选协议方法。宿主中立接口应按**最严消费方**补齐全部可选方法。
4. 端口坑的根因是复用通用 env 解析器时未审视语义边界:0 在"正整数"校验里是非法值,在端口语义里是合法特殊值,且失败路径是静默回落默认值,不报错。
5. pnpm deploy 坑是工具大版本行为变更,属查表事实。

## Missing Docs or Signals

- llmdoc 无任何"pnpm 仓库被 npm 污染"的识别/诊断/预防记录;`NODE_DEBUG=vitest-pool-workers:module-fallback` 这个诊断利器此前不为人知。
- `guides/npm-publish.md` 的 tsup dts 一节未提 `resolve: true` 对 node 内置类型的破坏,以及"公开面含 node 内置类型的包必须用数组白名单"。
- 无"宿主中立接口按最严消费方补齐可选方法"的设计守则记录。
- Dockerfile / pnpm deploy 路径此前完全无文档(本次是首个 Docker 交付)。

## Promotion Candidates

应由 recorder 提炼进稳定文档:

1. **node_modules 污染排查法** → 建议入 `guides/workers-kv-pitfalls.md`(其已含 vitest-pool-workers 条目)或新開排障小节:
   - 症状指向"版本不兼容"但版本矩阵全对时,查 node_modules 是否被 npm/yarn 污染(看是否有 `.package-lock.json`、顶层非 symlink 实体目录);
   - 诊断利器:`NODE_DEBUG=vitest-pool-workers:module-fallback` 打印 workerd 内 bare specifier 的真实解析路径;
   - 纪律:**永远不要在 pnpm 仓库根跑 `npm install`**(这条够硬,可考虑进 `must/` 工程纪律)。
2. **tsup dts resolve 白名单守则** → `guides/npm-publish.md`:公开面含 node 内置类型的包,`dts.resolve` 必须用数组只列 workspace 包,`true` 会把 `node:*` 类型静默打坏。
3. **宿主中立接口按最严消费方补齐可选方法**(undici 会调 `reader.cancel`)→ 可入 `architecture/modules-and-boundaries.md` 的宿主注入点细则,或 guides 设计守则。
4. **查表事实**:pnpm v10+ `deploy` 需 `--legacy`;端口类 env 解析须允许 0 → 随 Docker/Node 部署 guide(若 recorder 新建)或 `must/current-state.md` 常用命令区。

留在 memory 即可的:本次排查弯路的完整时间线与逐项排除清单(提炼出守则后原始过程无需进 guide);`TB_PORT=0` 的具体撞端口现象。

## Follow-up

- recorder:更新 `guides/npm-publish.md`(dts resolve 白名单)、补 node_modules 污染排障条目、评估是否新建 Docker/Node 宿主部署 guide(涵盖 pnpm deploy --legacy、双 CI、双重验收流程);`must/current-state.md` 同步 server 包与两个新 workflow。
- 可选加固:加一个 CI 或 pre-commit 检查,发现仓库根 `.package-lock.json` / `package-lock.json` 即报错,把"npm 污染"从排障问题变成准入问题。
- 流程亮点保留复用:计划前深探索预判 FsObjectStore 多根语义 vs 平坦 key 空间的不匹配,落地薄适配器一次通过;设备胶水(`processDeviceHello`)提取共享而非双份实现,Phase 0 纯重构独立提交由既有 85 个 gateway 集成测试守护零回归;后台 worktree agent 并行排查环境问题不阻塞主线。
