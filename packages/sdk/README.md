# @tool-bridge/sdk

tool-bridge 的库形态。根入口面向 Node 22+：内嵌 TB 实例、注册本地 Provider，并可反向连接远程网关。`@tool-bridge/sdk/device` 是独立的运行时中立入口，面向 React Native / Hermes 等设备宿主。

公开面即全部通道,不存在私有通道:`createToolBridge(config)` → `{ fetch, registerTool, registerContext, connect }`。

## 安装

```sh
npm install @tool-bridge/sdk
```

## 本地嵌入 + 注册工具 + 起 HTTP

```ts
import { serve } from '@hono/node-server'
import { createToolBridge, MemoryStateStore } from '@tool-bridge/sdk'

const tb = createToolBridge({
  state: new MemoryStateStore(),      // 或任何 StateStore 实现(SQLite / KV / ...)
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

## React Native / Hermes 设备入口

只从子入口导入；不要从包根入口导入移动端能力：

```ts
import * as SecureStore from 'expo-secure-store'
import {
  connectDevice,
  createReactNativeWebSocketFactory,
} from '@tool-bridge/sdk/device'

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
  credentialProvider: {
    prepare: async () => {
      const sk = await SecureStore.getItemAsync('tool-bridge-device-sk')
      if (!sk) throw new Error('device credential is missing')
      return { headers: { authorization: `Bearer ${sk}` } }
    },
  },
  webSocketFactory: createReactNativeWebSocketFactory(WebSocket),
  handler: async ({ path, arguments: args, signal }) => {
    // path 含命令叶子段(如 "fs/get"),命令是最后一段;policy、权限提示、
    // 原生能力和 signal 取消处理都属于 App 适配层。
    return await runNativeTool({ path, args, signal })
  },
})

// AppState active → connection.resume()
// AppState background/inactive → connection.suspend()
await connection.ready
```

移动端默认只承诺 App 前台实时在线。`SecureStore`、`AppState`、SQLite 和原生 executor 由应用选择，SDK 不直接依赖 React Native 或 Expo。当前原生 RN adapter 使用第三参数注入 WebSocket upgrade headers；浏览器/RN Web 若不能设置 header，需要网关短期 ticket 能力。

## 配置要点

| 字段 | 语义 |
|---|---|
| `state`(必填) | 树配置 / SK / manifest 的存取 |
| `objects?` | context 对象存储(`provider:'r2'` 的落点);缺省该 provider 返回 unavailable |
| `secrets?` | 上游凭证;缺省 = 基于 state 的加密存储,主密钥 `encryptionKey` 或 env `TB_SECRET_ENCRYPTION_KEY`,皆无则 secret 能力禁用(Set 返回 unavailable) |
| `reservedRoots?` / `remoteAllowlist?` / `maxHops?` | 追加保留根 / remote 白名单(空 = 拒一切 remote)/ Via 跳数上限(默认 4) |

## License

MIT
