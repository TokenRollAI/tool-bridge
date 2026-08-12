# Guide:npm 发布(cli / sdk / app / gateway / dashboard / server)

> 用途:发布 public npm 包的新版本,以及新增可发布包的首发流程。适用:发 cli/sdk/gateway/dashboard/server 新版本、新增可发布包、排查 CI 发布失败。现状(2026-08-12):**六包首发全部完成**,registry latest 为 cli 0.7.0 / sdk 0.4.0 / gateway 0.4.0 / dashboard 0.6.0 / app 0.1.0 / server 0.1.0,Trusted Publisher 均已配置。**但四包的 registry latest 落后于 main 代码**,正在做一轮版本对齐(cli 0.8.0、gateway 0.5.0、sdk 0.5.0、dashboard 0.7.0、app 0.1.1、server 0.1.1);app/server 的 CI 发布通路尚未实证。快照见 [../must/current-state.md](../must/current-state.md)。

## 包形态(发布模式)

- **core 是 private workspace 包,不发布**(被 cli/sdk/app/gateway/server 各自 bundle 一份)。可发布包共六个:cli / sdk / app / gateway / dashboard / server。
- cli/sdk/app/gateway/server 用 tsup `noExternal` 把 workspace 依赖 bundle 成**单文件 ESM**(workspace 包放 devDependencies,运行时 dependencies 只留真正的外部包)。配置见 `packages/sdk/tsup.config.ts`、`packages/cli/package.json`。
- **app 是宿主中立应用层包**:tsup `platform: 'neutral'`,只 bundle core;gateway/sdk/server 三个宿主包把它当 devDependency 并 `noExternal`(理由见下条不变量)。自建宿主(Deno/Bun/自托管 Node)的消费者装这一个包即可拿到 `createTbApp`。
- **单份 core 是硬不变量**:core 是 private 包不随发布走,每个发布产物各自 bundle 一份。因此**任何同时发布 app 与宿主层的包都不能把 app 留 external**——否则运行时并存两份 core 副本,`err instanceof TBError` 跨副本恒为 false,TBError 被静默降级成 internal(错误码、状态码、retryable 全丢)。workspace 内测试跑的是源码单副本,**测不出这个问题**,只能靠配置纪律 + 产物检查。
- **gateway 是 Worker library 包**(默认导出 app + `DeviceSession`,另 export `createApp` 与 `type Env`):tsup entry `src/index.ts`,`external: ['cloudflare:workers']`,target es2022 / platform neutral,core 被 bundle(从 dependencies 移到 devDependencies)。发布形态见下条 publishConfig 覆盖模式。
- **dashboard 是纯静态产物包**:只发 `files: ["dist"]`(Vite 全量打包产物),全部依赖在 devDependencies——消费者不装 react,拷 `node_modules/@tool-bridge/dashboard/dist` 即用。
- **server 是 Node 宿主服务包**(bin `tool-bridge-server`):tsup bundle core+app,better-sqlite3/ws/hono/@hono/node-server 等留 external;**dashboard 是它的 regular dependency**(`workspace:*`,`pnpm pack` 时改写为版本号)——所以 **npm 安装形态要求 dashboard 先发布/先存在对应版本**;dts 坑:`dts.resolve` 须收窄为数组(仅 core/app),`resolve: true` 会把 `node:http` 类型降级 undefined。同一 tag 还触发 Docker 镜像发布(见 [docker-host.md](docker-host.md))。
- **publishConfig 字段覆盖模式**(适用于"包在 workspace 内被按名消费"的场景,如 sdk import `@tool-bridge/app`):开发态 `main`/`exports` 保持指 `src/*.ts`,发布形态用 `publishConfig` 覆盖 `main`/`types`/`exports` 指 dist。陷阱:**`npm publish` 不应用字段覆盖,`pnpm pack` 才应用**——所以 CI 发布步骤必须是 `pnpm pack` + `npm publish <tarball>`(与 Trusted Publishing OIDC 兼容,见 `.github/workflows/publish-gateway.yml`)。
- **pack 验收对象是真实 tarball**:`npm pack --dry-run` exit 0 只证明 npm 能生成候选清单;对依赖上条 `publishConfig` 覆盖的包,它会保留 source 入口,不能作发布门。应用 `pnpm pack --dry-run --json` 做无写盘清单检查,并至少在收尾时将真实 `pnpm pack` 写入临时目录,用 `tar -tf` 与 `tar -xOf ... package/package.json` 核对文件集、main/types/exports、运行时禁止引用与 workspace 类型引用,然后删除临时产物。
- **dts 用 tsconfig.build.json 的 paths 把 workspace 包类型内联进 `dist/index.d.ts`**——core 不随发布走,不内联则发布包的类型入口悬空。陷阱:tsup 的 `noExternal` 只影响 JS bundle 不影响 dts;`dts.resolve`(true 或数组)对 exports 指向 .ts 源的 workspace 包(如 core 的 `"." → "./src/index.ts"`)**均不生效**。唯一生效修法:专用 `tsconfig.build.json` 用 `compilerOptions.paths` 把 `@tool-bridge/core` 等映射到对方 `src/*.ts`,tsup 设 `tsconfig: 'tsconfig.build.json'` + `dts: { resolve: [...] }`。**`dts.resolve` 列的每个包都必须在 `tsconfig.build.json` 的 paths 里有对应条目**:少一条不会报错,只会在 `dist/index.d.ts` 里留下一行悬空 `from '@tool-bridge/xxx'`,而该包在 devDependencies 里不随发布走,消费方的类型入口直接断(2026-08-11 抽 app 时三个包同时踩到)。收尾核对一行足够:`grep "^import" packages/*/dist/index.d.ts` 里不应出现任何 `@tool-bridge/*`。
- **验证类型自包含要用隔离 tsc,grep 不够**:在仓库外的隔离目录写一个只 import dist 类型的 check.ts,用仓库 `node_modules/.bin/tsc`(不开 skipLibCheck)编译通过才算数——"可独立消费性"不在常规 `pnpm verify` 覆盖内。Workers 目标包(如 gateway)额外注意:隔离 tsconfig 的 `lib` 必须只含 `["ES2022"]` 不带 DOM(`@cloudflare/workers-types` 与 lib.dom 类型冲突),`types` 要加 `@cloudflare/workers-types`;软链依赖要指向**包自己的 node_modules**(pnpm 不提升,仓库根下没有)。
- `files: ["dist"]` + `publishConfig.access: "public"`(scoped 包默认 restricted,必须显式 public)。

## 发新版本标准流程(Trusted Publisher 已配置的包)

版本范围先按 **public artifact ownership** 判定:只有自身外部契约、依赖约束或发布内容变化的 public 包才 bump。private 且被 bundle 的 workspace 包不因内部实现变化自动单独 bump,也不能沿源码依赖图传递式提升所有 public 包。

1. 改 `packages/<pkg>/package.json` 的 `version`,提交。
   发布物验证必须从本轮重建开始,并让 build → 实际入口版本 → dry-run pack **fail fast**。例如在 `packages/cli` 下执行:

   ```sh
   ./node_modules/.bin/tsup && \
     node dist/index.js --version && \
     npm pack --dry-run --json
   ```

   只读 manifest 或看到 dist 已存在都不算版本证据;多条命令不用 `&&`(或等价严格错误处理)连接时,后序 pack 成功可能掩盖前序 build 失败并把旧 dist 当成新版本。
2. 打 tag 并推送(tag 前缀区分包):

   ```sh
   git tag sdk-v<版本> && git push origin sdk-v<版本>             # sdk
   git tag cli-v<版本> && git push origin cli-v<版本>             # cli
   git tag app-v<版本> && git push origin app-v<版本>             # app(宿主中立层)
   git tag gateway-v<版本> && git push origin gateway-v<版本>     # gateway
   git tag dashboard-v<版本> && git push origin dashboard-v<版本> # dashboard
   git tag server-v<版本> && git push origin server-v<版本>       # server(同时触发 npm + GHCR 镜像双 workflow)
   ```

   **多包同发必须逐个 push tag**:`git push origin tag1 tag2 tag3` 一次推多个 tag 时 GitHub **不触发任何 tag workflow**(2026-07-08 实测:四 tag 同推零触发;删除远端 tag 后逐个重推,四个 workflow 全部正常触发)。tag 已推但没触发时的恢复手法:`git push origin :refs/tags/<tag>` 删远端 → 单独重推。

3. CI 自动发布(`.github/workflows/publish-<pkg>.yml`,六包各一份,也可 workflow_dispatch 手动触发):
   - 校验 tag 版本与 package.json 版本一致(不一致直接 fail,防漂移);
   - typecheck / test / build(`publish-server.yml` 额外做 **dist 起服冒烟**:从构建产物直接起进程探活,防"测试绿但发布物起不来");
   - `npm publish` 走 **npm Trusted Publishing(OIDC,免 token)**。workflow 里先 `npm install -g npm@11`(OIDC 发布需 npm >= 11.5.1,setup-node 自带的可能偏旧;**不要用 `npm@latest`**,见坑)。
4. 验证:`npm view @tool-bridge/<pkg> version`。

### Dashboard 有两个独立发布面

- `dashboard-v<版本>` 触发 `publish-dashboard.yml`,只证明 `@tool-bridge/dashboard` 已发布到 npm;证据是 Actions run 成功 + `npm view @tool-bridge/dashboard dist-tags.latest` 命中目标版本。
- 生产 `https://tool-bridge.pdjjq.org/ui/` 是 Gateway Worker 的 Static Assets,不从 npm dist-tag 自动更新;它随承载 Gateway 的部署流水线生效。当前项目在仓库外配置 Cloudflare Git 集成,`main` 推送后可能已经自动部署,仓库内没有对应 deploy workflow。
- 因此 Dashboard 发版必须分别报告「Dashboard npm 版本」与「生产 Worker version + `/ui` 产物身份」。`/healthz.version` 属于 Gateway 运行时,不能用来判断 Dashboard npm/静态资产版本。生产侧的部署去重、HTML/chunk hash 与 smoke 验收见 [deploy-and-verify.md](deploy-and-verify.md)。

## 新增可发布包首发(两段式)

Trusted Publisher 必须在包已存在后才能配置,所以新包固定走两段:

1. **手动首发**:`npm publish --dry-run` 核对 tarball 内容后,由**用户亲自**执行 `npm publish`(不要由 agent 跑,见坑 1)。
2. **配置 Trusted Publisher**:用户在 npmjs.com 该包设置页 → Trusted Publisher → GitHub Actions,填 repo `TokenRollAI/tool-bridge` + 对应 workflow 文件名(如 `publish-sdk.yml`)。
3. 之后按上节 tag 触发 CI 发布。

六包均已走完第 1、2 段。app/server 于 2026-08-12 手动首发(app 首发物核对:main/types/exports 全指 dist、4 文件 482.4 KB、`repository.url` 正确),**第 3 段仍未走**——首次 CI 发布要等 `publish-app.yml` 进 main 之后,因为 **tag 触发读的是 tag 所指 commit 里的 workflow 文件**,workflow 只在 feature 分支时打 tag 不触发任何 run(新增 workflow 的包首次 CI 发布的常见卡点)。**顺序约束:dashboard 须先于 server 发布**——dashboard 是 server 的 regular dependency,`workspace:*` 在 `pnpm pack` 时解析成具体版本,dashboard 那一版没进 registry 的话 server 的 tarball 装不上。每轮版本对齐都要重新满足这条,不是一次性约束。

## 坑

- **发布后立刻 `npm view` 可能仍报 E404**:registry 有 CDN 传播延迟。2026-08-12 实测 `@tool-bridge/server` 创建时间 `08:11:52Z`,`08:13:23Z`(91 秒后)查询仍返回 `E404 Not Found`,据此误报「未发布」。判定发布结果:等一两分钟复查,或直接看 `npm view <pkg> time.created` / npmjs.com 页面。**registry 的 404 不是「未发布」的可靠证据。**
- **每轮版本对齐都要重算发布顺序**:`@tool-bridge/dashboard` 是 server 的 regular dependency(`workspace:*`),`pnpm pack` 会把它解析成具体版本。dashboard 新版没进 registry 就发 server,tarball 引用的 dashboard 版本不存在,消费者 `npm i` 直接失败。这是每轮都要满足的约束,不是首发时的一次性检查。
- **agent 跑 `npm publish` 会卡死在 2FA/EOTP**:npm 触发浏览器一次性认证,认证 URL 在 agent 命令输出中被脱敏(显示 `***`),放后台等也没用。二选一:让用户在会话里 `! cd packages/xxx && npm publish` 自己跑(URL 直接显示给用户);或用户提供 TOTP,agent 走 `npm publish --otp=<code>`。
- **CI 发布 E422:provenance 校验要求 `repository.url`**:Trusted Publishing 会签 provenance,npm registry 校验 package.json 的 `repository.url` 必须匹配 `https://github.com/TokenRollAI/tool-bridge`,缺失或不匹配直接拒绝(`cli-v0.1.1` 实测被拒:`"repository.url" is ""`;补 `repository` 字段后同 tag 重跑成功)。可发布包的 package.json 必须带 `repository` 字段(含 `directory` 指向包目录)。手动发布无 provenance,不受影响——所以首发成功不代表 CI 能发。
- **发布前按真实发布器验收**:不依赖 manifest 覆盖的简单包可用 `npm publish --dry-run`;依赖 `publishConfig` 改写入口/workspace 依赖的包必须用 `pnpm pack`,核对 tarball 只含 dist/LICENSE/README/package.json,入口指 dist,且 unpacked size 合理(bundle 漏配 noExternal 时体积会异常)。
- **`npm install -g npm@latest` 会引入上游破坏**:npm 12.0.0(2026-07-08 发布)的 `npm publish` 走 provenance 路径时 `Cannot find module 'sigstore'` 直接崩(cli-v0.6.0 两次实测,重跑无效)。六个 publish workflow 已钉 `npm@11`;后续升 major 前先确认 publish 路径可用。
- **git push 偶发 `SSL_ERROR_SYSCALL`**:网络抖动,直接重试,不要误判为凭据问题去改配置。
