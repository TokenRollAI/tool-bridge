# 模块与边界

## 依赖方向

```text
core
  ↑
app ← plugins
  ↑       ↑
gateway  plugin-sdk
server
sdk
├─ sdk 根入口(Node 22+:app/ws/node adapter)
└─ sdk/device(neutral:device protocol + supervisor)

CLI / Dashboard ──HTTP──> app contract
```

`core` 与 `plugins` 是 private workspace 包；其余 app、cli、dashboard、gateway、plugin-sdk、sdk、server 是 public artifact。发布判断按 artifact ownership，不沿源码依赖图机械 bump。

## 包职责

| 包 | 职责 | 不应承担 |
|---|---|---|
| `core` | 类型、授权、树、store、builtin 纯逻辑、plugin/search 协议 | 网络、环境变量、运行时资源 |
| `app` | Hono 路由、发现/调用、provider 编排、宿主注入面 | Wrangler、SQLite、Node/CF 专属启动 |
| `gateway` | Workers Env → app 依赖，D1/R2/DO/Assets | 复制 app 业务分支 |
| `server` | Node 配置、SQLite/FS/ws、HTTP 监听、Docker 入口 | 改写共享协议语义 |
| `sdk` | 根入口嵌入 app、注册本地 provider、以 Node ws 反向连接；`./device` 提供独立 neutral 设备客户端 | 让 `./device` 触达 app、Node ws、`node:*` 或根入口；暴露尚未实现的网关侧设备宿主 API |
| `plugin-sdk` | plugin descriptor、OperationRegistry、envelope、受控出站 | 承担平台注册和 SecretStore |
| `plugins` | 内置 provider 源码、生成 catalog、迁移回归闸门 | 运行时注册状态 |
| `cli` | 严格 argv、本地语义、HTTP 调用、脚本输出 | 成为服务端唯一校验层 |
| `dashboard` | 同一 HTTP 契约的交互界面 | import core 形成浏览器/服务端耦合 |

## app 宿主注入

`TbAppDeps` 的基础注入点是：

- `state: StateStore`
- `objects?: () => ObjectStore`
- `secrets: SecretStoreImpl`
- `device?: DeviceChannel`
- `search?: SearchIndex`

另有 assets、remote、plugin catalog/bindings、本地 provider 与缓存/安全配置。`DeviceChannel` 是 app 当前消费的真实接口；不要再把未实现的 SDK `DeviceTransport` 当成现状。

## 当前节点与 builtin

节点 kind 的唯一清单在 `packages/core/src/types.ts` 的 `NODE_KINDS`：directory、mcp、http、builtin、context、device、remote、tool、skillhub。

bootstrap builtin 清单在 `packages/app/src/bootstrap.ts` 的 `BUILTIN_MODULES`：sk、secret、registry、status、plugin、catalog、federation、annotation。`~feedback` 是保留端点，不是 builtin 模块。

## 运行时差异

- `@tool-bridge/sdk` 是多入口包：根入口的 `engines.node` 与 Node 依赖属于安装/根运行时约束；`@tool-bridge/sdk/device` 的 Hermes 兼容性由独立 neutral JS/d.ts 产物和最终 tarball 模块闭包保证。设备入口不得从包根重新导出。
- 设备宿主通过 WebSocket factory、credential provider、handler 和 suspend/resume 注入 RN/Node 差异；SecureStore、AppState、原生 executor 与业务 policy 不属于 SDK 依赖。
- 三宿主 StateStore 均为强一致 SQL 后端(Workers=D1、Node=SQLite/PG),SK 吊销即时生效;共享契约测试对拍语义。
- Workers 设备会话结果与连接元数据进入 DO storage；Node 部分幂等结果只在进程内。
- Workers 静态 UI 经 Assets binding，缓存/压缩/条件请求由平台代劳；Node 从 `TB_UI_DIR` 或 dashboard 包读取，并由 `server` 的 `uiAssetsFetcher` 自理这些（hash 资产 immutable、其余 no-cache，内容协商 br/gzip，弱 ETag + 304），不下沉进 core/app。
- 共享逻辑必须留在 core/app；适配器差异写成注入实现和明确测试，不在业务路由分叉。
