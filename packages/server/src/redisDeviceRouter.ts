/**
 * DeviceRouterBackend 的 Redis(ioredis)实现。
 *
 * 两条连接是**必须**的:Redis 连接一旦进入 subscribe 模式就不能再发普通命令,
 * 而本副本既要订阅自己的频道、又要 GET/SET 路由并向别人 publish。
 *
 * clearRoute 用 Lua 做「值匹配才删」:设备刚从副本 A 迁到 B 时,A 的收尾不能删掉
 * B 刚写入的条目 —— 否则设备明明在线却被判离线。GET+DEL 两步做不到原子,故用脚本。
 */

import { Redis } from 'ioredis'
import { deviceRouteKey, type DeviceRouterBackend } from './deviceRouter'

/** 仅当键的当前值等于期望值时删除(避免删掉顶替者写入的新路由)。 */
const CLEAR_IF_OWNER = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`

export class RedisDeviceRouterBackend implements DeviceRouterBackend {
  /** 命令连接(GET/SET/DEL/PUBLISH)。 */
  private readonly commands: Redis
  /** 订阅连接(进入 subscribe 模式后不能发普通命令)。 */
  private readonly subscriber: Redis
  private readonly handlers = new Map<string, (payload: string) => void>()

  constructor(url: string) {
    this.commands = new Redis(url, { maxRetriesPerRequest: 2 })
    this.subscriber = new Redis(url, { maxRetriesPerRequest: 2 })
    this.subscriber.on('message', (channel: string, payload: string) => {
      this.handlers.get(channel)?.(payload)
    })
    // 连接层错误不应让进程崩溃:路由不可用时退化为"设备离线",
    // 本地直连的调用与其余控制面完全不受影响。
    this.commands.on('error', () => {})
    this.subscriber.on('error', () => {})
  }

  async setRoute(deviceId: string, replicaId: string, ttlSec: number): Promise<void> {
    await this.commands.set(deviceRouteKey(deviceId), replicaId, 'EX', ttlSec)
  }

  async lookupRoute(deviceId: string): Promise<string | null> {
    return await this.commands.get(deviceRouteKey(deviceId))
  }

  async clearRoute(deviceId: string, replicaId: string): Promise<void> {
    await this.commands.eval(CLEAR_IF_OWNER, 1, deviceRouteKey(deviceId), replicaId)
  }

  async publish(channel: string, payload: string): Promise<void> {
    await this.commands.publish(channel, payload)
  }

  async subscribe(channel: string, handler: (payload: string) => void): Promise<void> {
    this.handlers.set(channel, handler)
    await this.subscriber.subscribe(channel)
  }

  async close(): Promise<void> {
    this.handlers.clear()
    await Promise.allSettled([this.subscriber.quit(), this.commands.quit()])
  }
}
