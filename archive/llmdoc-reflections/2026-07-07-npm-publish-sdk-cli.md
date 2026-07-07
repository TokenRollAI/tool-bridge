# npm 发布 SDK/CLI 流程反思(2026-07-07)

> 范围:把 @tool-bridge/sdk 发布到 npm 并补 GitHub Action(@tool-bridge/cli 此前已用同一模式发布)。两包均 0.1.0、public access,现已在 npm 上。发布模式:core/gateway 为 private workspace 包不随发布,cli/sdk 用 tsup `noExternal` bundle 成单文件 ESM,dts 用 tsconfig.build.json 的 paths 内联 workspace 类型(见 [2026-07-07-sdk-dts-bundle-pitfall.md](2026-07-07-sdk-dts-bundle-pitfall.md))。本文记发布通道本身的流程教训。

## 1. npm 2FA(EOTP)会阻塞 agent 手动发布,必须换用户亲自跑

`npm publish` 会触发浏览器一次性认证(EOTP),认证 URL 在 agent 的命令输出里被脱敏(显示为 `***`),agent 拿不到,发布卡死。放后台等待也没用——URL 依然被脱敏。

**正确做法**(二选一):
- 让用户在会话里用 `! cd packages/xxx && npm publish` 自己跑,认证 URL 直接显示给用户,用户浏览器点掉即可;
- 用户提供 TOTP 验证码,agent 走 `npm publish --otp=<code>`。

**下轮怎么做**:凡涉及 npm 交互式认证的命令,不要由 agent 直接执行,一开始就把命令交给用户跑或先要 OTP。

## 2. 新增发布包 = "手动首发 + 配置 Trusted Publisher + 之后 CI" 的两段式

CI 走 npm Trusted Publishing(OIDC 免 token),但 Trusted Publisher 必须在 npmjs.com 包设置页一次性配置(repo `TokenRollAI/tool-bridge` + 对应 workflow 文件名),而配置前提是包已存在。所以每个新包的固定流程是:

1. 手动 `npm publish` 发首版(受教训 1 约束,由用户执行);
2. 用户在 npmjs.com 该包设置页配置 Trusted Publisher,指向具体 workflow 文件;
3. 之后 tag 触发 CI 发布(`cli-v*` / `sdk-v*`,或 workflow_dispatch)。

CI 侧要点:OIDC 发布需 npm >= 11.5.1(workflow 里 `npm install -g npm@latest`);发布前校验 tag 版本与 package.json 一致 + typecheck/test/build。workflow 文件为 `.github/workflows/publish-cli.yml` 与 `publish-sdk.yml`。

## 3. git push 偶发 SSL_ERROR_SYSCALL 是网络抖动,直接重试

本轮 `git push` 出现 `SSL_ERROR_SYSCALL`,重试一次即成功。不要误判为凭据/权限问题去改配置。

## Promotion Candidates

- npm 发布流程(bundle 模式 + dts 内联 + 两段式 Trusted Publishing + EOTP 处理)应沉淀为 `guides/` 一篇发布工作流(由 recorder 完成),并与 [2026-07-07-sdk-dts-bundle-pitfall.md](2026-07-07-sdk-dts-bundle-pitfall.md) 的 Promotion Candidate 合并。
- `must/current-state.md` 的"代码现状"应记录 @tool-bridge/cli 与 @tool-bridge/sdk 已发布 0.1.0,及 tag 触发发布的入口。
- "npm 交互式认证命令由用户亲自执行"属于可复用的 agent 操作纪律,仅留本反思即可,暂不入 must/。
