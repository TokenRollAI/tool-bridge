// `/full` = 仓库源码部署同款入口(deployEntry:内置插件目录全量装配 + D1 search)。
// 不要改回包根导入:那是**零插件**的库入口,部署出来的实例没有任何内置集成,
// 与源码部署/文档描述的能力不一致(这曾是真实事故:Deploy Button 与源码部署是两个产品)。
import app, { DeviceSession } from '@tool-bridge/gateway/full'

export { DeviceSession }
export default app
