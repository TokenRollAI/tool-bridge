# @tool-bridge/plugin-example

用 `@tool-bridge/plugin-sdk` 写的样例 plugin:**一个部署同时导出 tools 与 context,零协议样板**。

- `actions`(tools/v1):`create_note` / `count_notes`。入参就是 Zod schema,JSON Schema 由 SDK 派生;
  handler 返回裸值,SDK 包成 ToolResult。
- `notes`(context/v1):只实现 `list/get/write/search` —— **不实现 `update/delete`**。
  于是这个 export 如实自报为 append-only,平台按自报的 `methods` 裁剪动词表,
  `~help` 里不会出现 Update/Delete,数据面也直接拒。

作者在 `src/index.ts` 里没有写任何一行:健康检查、`/~describe`、`/~help`、envelope 编解码、
Bearer 鉴权、`X-TB-Request-Id` 去重、上游凭证解包、入参校验、错误归一、export 路由。
对照 `packages/plugin-feishu` 的手写实现,那些正是被 SDK 收走的部分。

存储用进程内 `Map`(样例要能独立跑,不引 KV/D1 绑定)。真实 plugin 把它换成 KV/D1/上游 API 即可,
其余代码不动。

```bash
pnpm --filter @tool-bridge/plugin-example dev     # wrangler dev
pnpm --filter @tool-bridge/plugin-example deploy  # 需先配好 PLUGIN_TOKEN
```

跨包契约回归见 `packages/gateway/test/pluginExample.integration.test.ts`:
它把网关的出站 `fetch` 直接接到本包真实的 `fetch(Request, Env)` 上,不 stub 协议。
