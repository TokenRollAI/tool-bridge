# @tool-bridge/plugins

内置插件目录。`src/<name>/` 一个文件夹 = 一个插件(纯源码,不是 workspace 包),
用 [`@tool-bridge/plugin-sdk`](../plugin-sdk) 写成 `{ fetch(request, env) }` 形状。

当前目录:66 个 open-connector 迁移产物(见 [MIGRATION.md](MIGRATION.md))+ 两个手写插件
`feishu`(飞书 MCP 工具 provider)、`notes`(context provider 示例)。
目录是**策展过的**:选取判据与被剔除的类别记在 MIGRATION.md 的「策展」一节。

## 三种托管形态,树上行为一致

插件与网关之间只有 HTTP 信封这一条契约,**托管在哪由你决定**;`~register` 时写进
manifest 的 `endpoint` 决定网关怎么找到它:

| 形态 | endpoint | 适用 |
|---|---|---|
| 进程内 binding | `binding:<name>` | 网关自己装配插件,零网络跳、无需额外部署与凭证 |
| 独立 Node 进程 / 容器 | `https://…` | 自部署、内网、与网关分开扩缩 |
| Cloudflare Worker | `https://…` | 已经用 Workers 宿主,想让插件也在边缘 |

### 1. 进程内 binding(两个宿主都支持)

宿主装配时把 `builtinPluginBindings(env)` 的结果注入 `pluginBindings`,注册时
endpoint 写 `binding:feishu` 即可。`tb plugin catalog` 列出当前宿主已装配的集合。
`opts.include` 可只装配子集(CF 宿主按构建体积裁剪)。

```ts
import { builtinPluginBindings } from '@tool-bridge/plugins'

const deps = { /* …其余注入点… */, pluginBindings: builtinPluginBindings(process.env) }
```

### 2. 独立 Node 进程 / 容器

```sh
TB_PLUGIN_NAME=feishu PORT=8788 pnpm --filter @tool-bridge/plugins serve
```

env 原样透传 `process.env`,插件自取所需变量(`PLUGIN_TOKEN` / `FEISHU_APP_ID` /
`FEISHU_APP_SECRET` / `FEISHU_ALLOWED_TOOLS`)。放到公网时自备 TLS 终结——网关对
plugin endpoint 强制 https(本地 http 需要网关侧显式 `TB_ALLOW_INSECURE_HTTP=true`)。
docker-compose 的 `plugin` 服务用的就是这条路径。

### 3. Cloudflare Worker

```sh
CLOUDFLARE_ACCOUNT_ID=<你的账户 id> pnpm --filter @tool-bridge/plugins deploy:feishu:cf
npx wrangler secret put PLUGIN_TOKEN   --config wrangler.feishu.jsonc
npx wrangler secret put FEISHU_APP_ID  --config wrangler.feishu.jsonc
npx wrangler secret put FEISHU_APP_SECRET --config wrangler.feishu.jsonc
```

`wrangler.feishu.jsonc` 不含账户 id:wrangler 从 `CLOUDFLARE_ACCOUNT_ID` 读(多账户
OAuth 下必须给)。非敏感配置(工具白名单)走 `vars`,凭证一律走 secret。

## 注册到树上

三种形态注册方式相同,只有 `endpoint` 不同:

```jsonc
{
  "id": "feishu",
  "protocolVersion": "plugin/v2",
  "endpoint": "binding:feishu",       // 或 "https://plugin.example.com"
  "auth": { "kind": "platform-token" },
  "healthPath": "/healthz",
  "enabled": true
}
```

```sh
tb plugin register --file ./manifest.json
tb plugin health feishu
tb tool mount tools/feishu --kind tool --provider feishu --export actions
```

「提供什么」不在 manifest 里,由插件的 `/~describe` 返回 exports 列表决定
(一个插件可以同时导出 tools 与 context)。
