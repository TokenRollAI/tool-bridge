import type { ObjectBodyStream } from '@tool-bridge/core'

export interface WebObjectBodyStreamOptions {
  /** 传给 Web ReadableStream 的排队上限；S3 PUT 用 0 禁止预读。 */
  highWaterMark?: number
}

/**
 * core 的最小 ObjectBodyStream → 宿主 Web ReadableStream。
 *
 * 只做逐块桥接，不聚合字节；pull 保留背压，cancel 向源传播，所有终态只释放一次 reader。
 */
export function toWebObjectBodyStream(
  source: ObjectBodyStream,
  options: WebObjectBodyStreamOptions = {},
): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  let released = false
  const release = () => {
    if (released) return
    released = true
    reader.releaseLock()
  }
  const strategy = options.highWaterMark === undefined
    ? undefined
    : { highWaterMark: options.highWaterMark }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          release()
          controller.close()
        } else if (value !== undefined) {
          controller.enqueue(value)
        }
      } catch (error) {
        try {
          release()
        } catch {
          // 保留原始读错误；自定义结构流的 release 失败不能覆盖它。
        }
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        if (reader.cancel !== undefined) await reader.cancel(reason)
        else await source.cancel?.(reason)
      } finally {
        try {
          release()
        } catch {
          // cancel 是主操作，release 只做尽力清理。
        }
      }
    },
  }, strategy)
}
