# Guide:npm 发布(cli / sdk / gateway / dashboard)

> 用途:发布 public npm 包的新版本,以及新增可发布包的首发流程。适用:发 cli/sdk/gateway/dashboard 新版本、新增可发布包、排查 CI 发布失败。现状:cli 0.1.1、sdk 0.1.0 已发布;gateway/dashboard 0.1.0 **待手动首发 + 配 Trusted Publisher**。快照见 [../must/current-state.md](../must/current-state.md)。

## 包形态(发布模式)

- **core 是 private workspace 包,不发布**(被 cli/sdk/gateway bundle)。可发布包共四个:cli / sdk / gateway / dashboard。
- cli/sdk/gateway 用 tsup `noExternal` 把 workspace 依赖 bundle 成**单文件 ESM**(workspace 包放 devDependencies,运行时 dependencies 只留真正的外部包)。配置见 `packages/sdk/tsup.config.ts`、`packages/cli/package.json`。
- **gateway 是 Worker library 包**(默认导出 app + `DeviceSession`,另 export `createApp` 与 `type Env`):tsup entry `src/index.ts`,`external: ['cloudflare:workers']`,target es2022 / platform neutral,core 被 bundle(从 dependencies 移到 devDependencies)。发布形态见下条 publishConfig 覆盖模式。
- **dashboard 是纯静态产物包**:只发 `files: ["dist"]`(Vite 全量打包产物),全部依赖在 devDependencies——消费者不装 react,拷 `node_modules/@tool-bridge/dashboard/dist` 即用。
- **publishConfig 字段覆盖模式**(适用于"包在 workspace 内被按名消费"的场景,如 sdk import `@tool-bridge/gateway/tbApp`):开发态 `main`/`exports` 保持指 `src/*.ts`,发布形态用 `publishConfig` 覆盖 `main`/`types`/`exports` 指 dist。陷阱:**`npm publish` 不应用字段覆盖,`pnpm pack` 才应用**——所以 CI 发布步骤必须是 `pnpm pack` + `npm publish <tarball>`(与 Trusted Publishing OIDC 兼容,见 `.github/workflows/publish-gateway.yml`)。
- **dts 用 tsconfig.build.json 的 paths 把 workspace 包类型内联进 `dist/index.d.ts`**——core 不随发布走,不内联则发布包的类型入口悬空。陷阱:tsup 的 `noExternal` 只影响 JS bundle 不影响 dts;`dts.resolve`(true 或数组)对 exports 指向 .ts 源的 workspace 包(如 core 的 `"." → "./src/index.ts"`)**均不生效**。唯一生效修法:专用 `tsconfig.build.json` 用 `compilerOptions.paths` 把 `@tool-bridge/core` 等映射到对方 `src/*.ts`,tsup 设 `tsconfig: 'tsconfig.build.json'` + `dts: { resolve: true }`。
- **验证类型自包含要用隔离 tsc,grep 不够**:在仓库外的隔离目录写一个只 import dist 类型的 check.ts,用仓库 `node_modules/.bin/tsc`(不开 skipLibCheck)编译通过才算数——"可独立消费性"不在常规 `pnpm verify` 覆盖内。Workers 目标包(如 gateway)额外注意:隔离 tsconfig 的 `lib` 必须只含 `["ES2022"]` 不带 DOM(`@cloudflare/workers-types` 与 lib.dom 类型冲突),`types` 要加 `@cloudflare/workers-types`;软链依赖要指向**包自己的 node_modules**(pnpm 不提升,仓库根下没有)。
- `files: ["dist"]` + `publishConfig.access: "public"`(scoped 包默认 restricted,必须显式 public)。

## 发新版本标准流程(Trusted Publisher 已配置的包)

1. 改 `packages/<pkg>/package.json` 的 `version`,提交。
2. 打 tag 并推送(tag 前缀区分包):

   ```sh
   git tag sdk-v<版本> && git push origin sdk-v<版本>             # sdk
   git tag cli-v<版本> && git push origin cli-v<版本>             # cli
   git tag gateway-v<版本> && git push origin gateway-v<版本>     # gateway
   git tag dashboard-v<版本> && git push origin dashboard-v<版本> # dashboard
   ```

3. CI 自动发布(`.github/workflows/publish-<pkg>.yml`,四包各一份,也可 workflow_dispatch 手动触发):
   - 校验 tag 版本与 package.json 版本一致(不一致直接 fail,防漂移);
   - typecheck / test / build;
   - `npm publish` 走 **npm Trusted Publishing(OIDC,免 token)**。workflow 里先 `npm install -g npm@latest`,因为 OIDC 发布需 npm >= 11.5.1(setup-node 自带的可能偏旧)。
4. 验证:`npm view @tool-bridge/<pkg> version`。

## 新增可发布包首发(两段式)

Trusted Publisher 必须在包已存在后才能配置,所以新包固定走两段:

1. **手动首发**:`npm publish --dry-run` 核对 tarball 内容后,由**用户亲自**执行 `npm publish`(不要由 agent 跑,见坑 1)。
2. **配置 Trusted Publisher**:用户在 npmjs.com 该包设置页 → Trusted Publisher → GitHub Actions,填 repo `TokenRollAI/tool-bridge` + 对应 workflow 文件名(如 `publish-sdk.yml`)。
3. 之后按上节 tag 触发 CI 发布。

当前待走此流程:gateway/dashboard 0.1.0(workflow 分别为 `publish-gateway.yml` / `publish-dashboard.yml`)。

## 坑

- **agent 跑 `npm publish` 会卡死在 2FA/EOTP**:npm 触发浏览器一次性认证,认证 URL 在 agent 命令输出中被脱敏(显示 `***`),放后台等也没用。二选一:让用户在会话里 `! cd packages/xxx && npm publish` 自己跑(URL 直接显示给用户);或用户提供 TOTP,agent 走 `npm publish --otp=<code>`。
- **CI 发布 E422:provenance 校验要求 `repository.url`**:Trusted Publishing 会签 provenance,npm registry 校验 package.json 的 `repository.url` 必须匹配 `https://github.com/TokenRollAI/tool-bridge`,缺失或不匹配直接拒绝(`cli-v0.1.1` 实测被拒:`"repository.url" is ""`;补 `repository` 字段后同 tag 重跑成功)。可发布包的 package.json 必须带 `repository` 字段(含 `directory` 指向包目录)。手动发布无 provenance,不受影响——所以首发成功不代表 CI 能发。
- **发布前先 `npm publish --dry-run`**:核对 tarball 只含 dist/LICENSE/README/package.json,且 unpacked size 合理(bundle 漏配 noExternal 时体积会异常)。
- **git push 偶发 `SSL_ERROR_SYSCALL`**:网络抖动,直接重试,不要误判为凭据问题去改配置。
