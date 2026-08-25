# @tool-bridge/sdk

tool-bridge 的库形态。根入口面向 Node 22+：内嵌 TB 实例、注册本地 Provider，并可反向连接远程网关。`@tool-bridge/sdk/device` 是独立的运行时中立设备入口；`@tool-bridge/sdk/store` 是浏览器、Node 与 React Native 共用的 default Store 控制面与流式传输入口。

公开面即全部通道,不存在私有通道:`createToolBridge(config)` → `{ fetch, registerTool, registerContext, connect }`。

## 安装

```sh
npm install @tool-bridge/sdk
```

## 本地嵌入 + 注册工具 + 起 HTTP

```ts
import { serve } from '@hono/node-server'
import { createToolBridge, MemoryObjectStore, MemoryStateStore } from '@tool-bridge/sdk'

const tb = createToolBridge({
  state: new MemoryStateStore(),      // 或任何 StateStore 实现(SQLite / KV / ...)
  objects: new MemoryObjectStore(),   // 必填；仅示例/测试，生产须注入持久 FS、R2 或 S3 driver
  adminSk: process.env.TB_ADMIN_SK,   // 缺省读 env TB_BOOTSTRAP_ADMIN_SK;首次引导时必须提供
})

tb.registerTool(
  'tools/echo',
  {
    list: () => [{ name: 'echo', description: '原样返回 text' }],
    call: (_name, args) => ({ content: { echoed: args.text } }),
  },
  { description: '本地 echo 工具' },
)

serve({ fetch: (req) => tb.fetch(req), port: 8787 })
// curl -H "Authorization: Bearer $TB_ADMIN_SK" http://127.0.0.1:8787/tools/echo/~help
// curl -X POST -H "Authorization: Bearer $TB_ADMIN_SK" -d '{"text":"hi"}' http://127.0.0.1:8787/tools/echo/echo
```

## 反向连接远程网关(HTTP → WebSocket)

```ts
const conn = tb.connect('https://your-gateway.example.com', process.env.TB_SK!, {
  deviceId: 'my-service-01',   // 缺省 os.hostname() 规范化;长驻服务应显式传稳定 id(断线重连恢复 online 依赖它)
})

await conn.ready               // ready 帧到达,本实例注册的节点已挂到远程树 device/<deviceId>/ 下
// 远程即可:POST /device/my-service-01/tools/echo/echo  body {...arguments}

conn.close()                   // 下线;远程节点保留标记 offline,超回收期自动删除
```

## 运行时中立的 Store 客户端

管理 default Store 时优先从独立子入口导入。它只依赖 Web 标准，支持注入 `fetch`，不会把 app、WebSocket
或 Node API 带入浏览器/RN 产物：

```ts
import { createStoreClient, parseStoreUri } from '@tool-bridge/sdk/store'

const store = createStoreClient({
  baseUrl: 'https://your-gateway.example.com',
  // 每次控制请求都会重新读取，便于无停机轮换；不要把 SK 写进 URL 或日志。
  sk: async () => await readCurrentSk(),
})

const uploaded = await store.upload({
  body: photoBlob,
  contentType: 'image/jpeg',
  filename: 'capture.jpg',
})

const uri = parseStoreUri(uploaded.uri)
const response = await store.download(uri)
await consumeWithoutBuffering(response.body)
```

`createStoreClient` 还提供 `stat/list/read/share/revokeShare/delete`。短期 `$ref`、上传 grant 与签名 URL
都属于 bearer secret；SDK 会裁剪 wire 未知字段并脱敏错误，但调用方仍不应持久化或记录这些值。

## React Native / Hermes 设备入口

只从子入口导入；不要从包根入口导入移动端能力：

```ts
import * as SecureStore from 'expo-secure-store'
import {
  connectDevice,
  createReactNativeWebSocketFactory,
  uploadObject,
} from '@tool-bridge/sdk/device'

const credentialProvider = {
  prepare: async () => {
    const sk = await SecureStore.getItemAsync('tool-bridge-device-sk')
    if (!sk) throw new Error('device credential is missing')
    return { headers: { authorization: `Bearer ${sk}` } }
  },
}

const connection = connectDevice({
  baseUrl: 'https://your-gateway.example.com',
  deviceId: 'phone-01',
  expose: {
    nodes: [{
      path: 'camera',
      kind: 'tool',
      description: '手机相机',
      cmds: [{ name: 'capture', description: '拍照' }],
    }],
  },
  credentialProvider,
  webSocketFactory: createReactNativeWebSocketFactory(WebSocket),
  handler: async (call) => {
    const { path, arguments: args, signal } = call
    // path 含命令叶子段(如 "fs/get"),命令是最后一段;policy、权限提示、
    // 原生能力和 signal 取消处理都属于 App 适配层。
    if (path === 'camera/capture') {
      const photoBlob = await takePhoto({ signal })
      // 网关为本次远程 call 注入窄 upload capability；设备无需知道 Context 或挂载路径。
      // relay PUT 成功即 ready；R2/S3 直传由 SDK 自动 complete。
      return await call.uploadObject({
        body: photoBlob,
        contentType: 'image/jpeg',
        filename: 'capture.jpg',
      })
    }
    return await runNativeTool({ path, args, signal })
  },
})

// AppState active → connection.resume()
// AppState background/inactive → connection.suspend()
await connection.ready

// 设备自主上传（不属于远程 call）也直接写 default Store。此路径使用 Device HTTP identity，
// credentialProvider 在 purpose === 'http' 时必须返回非空 Authorization header。
const uploaded = await uploadObject({
  baseUrl: 'https://your-gateway.example.com',
  deviceId: 'phone-01',
  contentType: 'image/jpeg',
  body: photoBlob,
  credentialProvider,
})
await saveStableReference(uploaded.uri) // 只保存 store://default/...；不要持久化临时上传 URL
```

移动端默认只承诺 App 前台实时在线。`SecureStore`、`AppState`、SQLite 和原生 executor 由应用选择，SDK 不直接依赖 React Native 或 Expo。当前原生 RN adapter 使用第三参数注入 WebSocket upgrade headers；浏览器/RN Web 若不能设置 header，需要网关短期 ticket 能力。

`uploadObject` 不增加 WebSocket 二进制帧：它调用 `system/store/create_upload` 后按 grant 选择
网关 relay 或 R2/S3 presigned PUT，最终只返回稳定 `store://default/...` descriptor。远程 call
优先使用 `call.uploadObject`；老网关没有 call capability 时该方法会明确返回 `unavailable`，不会
退回某个隐式 Context。独立调用 helper 时，Node 消费者可从 `@tool-bridge/sdk` 根入口导入，
React Native/Hermes 消费者从 `@tool-bridge/sdk/device` 导入；两处是同一套 neutral 实现。

设备 SDK 不再暴露 `uploadContextObject`。把二进制 author 到指定语义 Context entry 仍可通过
Context API、`tb ctx upload` 或 Dashboard 完成；设备照片、视频、录音等产物统一进入 default Store。

Node 22+ 的嵌入宿主可从包根导入 `createS3ObjectStore` 并传给 `objects`，同一实例同时作为
default Store 与对象型 Context 的共享字节 driver，并为 Store 提供直传能力：

```ts
import { createS3ObjectStore, createToolBridge, MemoryStateStore } from '@tool-bridge/sdk'

const objects = createS3ObjectStore({
  endpoint: 'https://<account>.r2.cloudflarestorage.com',
  bucket: 'tb-objects',
  region: 'auto',
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
}, { allowInsecure: false })

const tb = createToolBridge({
  state: new MemoryStateStore(),
  objects,
  adminSk,
  uploadGrantTtlSec: 900,
})
```

## 配置要点

| 字段 | 语义 |
|---|---|
| `state`(必填) | 树配置 / SK / manifest 的存取 |
| `objects`(必填) | default Store 的字节存储，也供对象型 Context 使用；生产必须注入持久 FS、R2、S3 或自定义 driver，`MemoryObjectStore` 只适合测试/易失开发 |
| `uploadGrantTtlSec?` | `create_upload` 写 grant 的有效期秒，缺省 900、最大 604800；与下载 `$ref` TTL 独立 |
| `secrets?` | 上游凭证;缺省 = 基于 state 的加密存储,主密钥 `encryptionKey` 或 env `TB_SECRET_ENCRYPTION_KEY`,皆无则 secret 能力禁用(Set 返回 unavailable) |
| `reservedRoots?` / `remoteAllowlist?` / `maxHops?` | 追加保留根 / remote 白名单(空 = 拒一切 remote)/ Via 跳数上限(默认 4) |

## License

MIT
