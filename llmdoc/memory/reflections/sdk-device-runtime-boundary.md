# SDK device 运行时边界反思

## 偏差

- 最初把包级 `engines.node` 和 `dependencies.ws` 直接等同于“同包子入口无法在 Hermes 运行”。这混淆了 npm 安装元数据与 bundler 的实际模块图；真正的判断依据应是目标子入口的 JS/d.ts 依赖闭包。
- 一度考虑给移动端首版注入持久化结果缓存，但当前网关重试不会稳定复用同一个 call id。简单 `get/set` 不能阻止跨请求重复副作用，反而会制造 exactly-once 的错误承诺。

## 修正

- `@tool-bridge/sdk` 保留 Node 22+ 根入口，同时增加独立 neutral 构建的 `@tool-bridge/sdk/device`；`ws` 可以继续被安装，但不得进入 device 子入口图。
- 设备核心以 WebSocket factory、credential provider 和显式 suspend/resume 注入宿主差异；RN 第三参数 headers 只存在于薄 adapter。
- 首版只保留进程内同 call id 去重；handler 获得 id 与协作式 AbortSignal。跨进程 durable execution 留待端到端 idempotency key 与网关重放协议完整设计。
- 发布验收从“manifest 看起来正确”提升为：检查所有条件导出目标、扫描 device JS/d.ts 的 Node/private 依赖泄漏，并从最终 tarball 干净安装后同时 import 根入口和 device 子入口。

## 可复用原则

- 多运行时 npm 包的兼容性按“子入口产物闭包”判定，不按整个依赖清单猜测。
- 运行时中立需要 JS 与声明文件两条依赖图同时隔离。
- 幂等缓存只有在调用标识能端到端稳定重用时才具有跨重启语义；否则必须明确它只是进程内优化。
