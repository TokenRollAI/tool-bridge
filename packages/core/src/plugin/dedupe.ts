/**
 * X-TB-Request-Id 幂等去重表(纯逻辑,Plugin 侧 / 平台 stub 侧通用)。
 *
 * 同 id 重放返回首次执行结果(成功值或错误原样重放);同 id 并发只执行一次
 * (in-flight 合并)。已完成结果进有界缓存,超限逐最旧(与 device/client.ts 的
 * 幂等结果缓存同模式,缺省 1000);in-flight 条目不受逐出影响。
 */

type Settled = { ok: true; value: unknown } | { ok: false; error: unknown }

const DEFAULT_MAX_ENTRIES = 1000

export interface RequestDedupeOptions {
  /** 已完成结果的缓存上限(缺省 1000;超限逐最旧)。 */
  maxEntries?: number
}

export class RequestDedupe {
  private readonly settled = new Map<string, Settled>()
  private readonly inflight = new Map<string, Promise<Settled>>()
  private readonly maxEntries: number

  constructor(opts: RequestDedupeOptions = {}) {
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES
  }

  /**
   * 以 `requestId` 幂等执行 `executor`:
   * - 已有首次结果 → 直接重放(不执行);
   * - 同 id in-flight → 挂到同一次执行上;
   * - 否则执行并把结果(含错误)记为该 id 的首次结果。
   */
  async run<T>(requestId: string, executor: () => Promise<T> | T): Promise<T> {
    const cached = this.settled.get(requestId)
    if (cached !== undefined) return this.replay<T>(cached)

    const running = this.inflight.get(requestId)
    if (running !== undefined) return this.replay<T>(await running)

    const execution = (async (): Promise<Settled> => {
      try {
        return { ok: true, value: await executor() }
      } catch (error) {
        return { ok: false, error }
      }
    })()
    this.inflight.set(requestId, execution)
    const result = await execution
    this.inflight.delete(requestId)
    this.settled.set(requestId, result)
    if (this.settled.size > this.maxEntries) {
      const oldest = this.settled.keys().next().value
      if (oldest !== undefined) this.settled.delete(oldest)
    }
    return this.replay<T>(result)
  }

  private replay<T>(result: Settled): T {
    if (result.ok) return result.value as T
    throw result.error
  }
}
