# @tool-bridge/sdk

tool-bridge 的库形态(Proto §7):在任意 Node / Workers 宿主内嵌一个 TB 实例,程序化注册本地 Provider,并可反向连接到远程网关把本地工具挂上远程树。

公开面与 Proto 接口一一对应,不存在私有通道:`createToolBridge(config)` → `{ fetch, registerTool, registerContext, connect }`。

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
  adminSk: process.env.TB_ADMIN_SK,   // 缺省读 env TB_BOOTSTRAP_ADMIN_SK;皆无则首次启动随机生成并打印一次
})

tb.registerTool(
  'tools/echo',
  {
    List: () => [{ name: 'echo', description: '原样返回 text' }],
    Get: () => ({ name: 'echo' }),
    Call: (_name, args) => ({ content: { echoed: args.text } }),
  },
  { description: '本地 echo 工具' },
)

serve({ fetch: (req) => tb.fetch(req), port: 8787 })
// curl -H "Authorization: Bearer $TB_ADMIN_SK" http://127.0.0.1:8787/tools/echo/~help
// curl -X POST -H "Authorization: Bearer $TB_ADMIN_SK" -d '{"tool":"echo","arguments":{"text":"hi"}}' http://127.0.0.1:8787/tools/echo
```

## 反向连接远程网关(HTTP → WebSocket)

```ts
const conn = tb.connect('https://your-gateway.example.com', process.env.TB_SK!, {
  deviceId: 'my-service-01',   // 缺省 os.hostname() 规范化;长驻服务应显式传稳定 id(断线重连恢复 online 依赖它)
})

await conn.ready               // ready 帧到达,本实例注册的节点已挂到远程树 device/<deviceId>/ 下
// 远程即可:POST /device/my-service-01/tools/echo {"tool":"echo","arguments":{...}}

conn.close()                   // 下线;远程节点保留标记 offline,超回收期自动删除
```

## 配置要点(Proto §7)

| 字段 | 语义 |
|---|---|
| `state`(必填) | 树配置 / SK / manifest 的存取 |
| `objects?` | context 对象存储(`provider:'r2'` 的落点);缺省该 provider 返回 unavailable |
| `secrets?` | §2.5 上游凭证;缺省 = 基于 state 的加密存储,主密钥 `encryptionKey` 或 env `TB_SECRET_ENCRYPTION_KEY`,皆无则 secret 能力禁用(Set 返回 unavailable) |
| `deviceTransport?` | 网关侧设备 WS 宿主;未注入则 device 能力禁用 |
| `reservedRoots?` / `remoteAllowlist?` / `maxHops?` | §2.4b 追加保留根 / §3.4 remote 白名单(空 = 拒一切 remote)/ Via 跳数上限(默认 4) |

## License

MIT
