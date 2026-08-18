# Provider 迁移维护

本目录中的迁移产物已经是 tool-bridge 自有源码，不在运行时包装 open-connector。本文只保留继续维护这些产物所需的当前规则；通用 plugin 安全与挂载流程见 [`llmdoc/guides/plugin-design-and-migration.md`](../../llmdoc/guides/plugin-design-and-migration.md)。

## 产物形状

```text
src/<service>/
  schema.ts
  api.ts
  index.ts
  handwritten.json       # 可选：schema 有意偏离的登记
  schema.handwritten.ts  # 可选：无法机械表达的 schema
```

`migration-fingerprints.json` 保存上游 schema/描述指纹，同时定义哪些目录属于迁移产物。provider 的实际可用清单以生成的 registry 与 catalog 为准，不在文档维护数量快照。

## 四个阶段

1. 抽取上游 action、schema、认证与请求行为，生成确定性中间产物。
2. 转成 Zod schema；不能等价转换的形状必须在 `handwritten.json` 解释。
3. 将 executor 改写为本地 `TBError`、`guardedFetch`、`ProviderContext` 和 envelope 语义。
4. 接入 registry、生成 catalog，并补 provider wire 测试。

半成品不要提前接进 registry 或 fingerprints。删除 provider 时同时删除源码、loader、wire 测试和 fingerprint；生成检查会拒绝集合漂移。

## 三道闸门

- 等价：输入/输出 schema、名称和描述没有无意漂移。
- 形状：目录、index、registry、fingerprint 与 `~describe` 一致。
- wire：请求 URL、method、headers/body、响应与错误映射和上游契约一致。

Vitest 不替代 TypeScript 检查；迁移完成必须同时跑 package test、typecheck 和 catalog/registry 生成检查。

## 认证与配置

| 上游形态 | tool-bridge 落点 |
|---|---|
| 单值 API key | `auth:single`，值由 `authRef` 指向 SecretStore |
| `custom_credential.fields` | `credentialFields`，整组字段进入同一 secret |
| 非敏感 `extraFields` | `mountConfigFields` / `providerConfig` |
| OAuth2 authorization code | descriptor 的 `oauth`，handler 只消费 access token |

OAuth 与 `credentialFields`/`credentialProbe` 互斥。Google provider 需要离线授权参数，Dropbox 需要 offline token 参数；这些值必须与上游当前定义逐项对照，并由 `~describe` 测试固定。

自部署实例地址属于非敏感配置，但也是 SSRF 输入。统一用 `guardedFetch`，规范化 scheme/userinfo/path，并把被拒原因映射为可理解的 `invalid_argument`。

## 已知上游特性

- Fixer 把凭证放在 query，且业务错误可能随 HTTP 200 返回；日志和错误不得输出完整 URL。
- Google Docs 的部分 action 曾出现声明与 executor 不一致；以当前上游实现和同 provider 反例共同判断，不能只抄 schema。
- 配额类错误映射为可重试 `rate_limited`；凭证错误映射为 `permission_denied`，以便 credential probe 正确失败。
- 204/205/304 的测试响应必须使用 null body；`new Response('', { status: 204 })` 在标准实现中会抛错。
- 上游返回 shape 未经实证时不加猜测性 fallback；真实差异先补 fixture，再实现最窄兼容。

## 策展

保留 provider 的依据是明确使用场景、Agent 常用基础设施能力或不可替代的协议覆盖。目录规模不是目标，也不能成为测试断言；删减低价值 provider 不应削弱生成检查、三道闸门和安全边界。
