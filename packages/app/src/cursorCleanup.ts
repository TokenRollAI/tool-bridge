/**
 * 宿主 maintenance tick 共用的有界分页清理骨架:
 * 读持久进度 → 分页执行 → CAS 推进 → 输者收手 → 全量扫完清进度。
 *
 * default Store(cleanupDefaultStore)与 device Mailbox(cleanupDeviceMailbox)
 * 共用这一套编排;两者的持久进度形状不同(`cursors` 对象 vs `cursor` 字符串),
 * 解析与编码留在各自模块,骨架只认统一的 { cursor, revision }。
 */
import { type StateStore, TBError } from '@tool-bridge/core'

/** 清理页数/条数参数的统一校验(两个消费方此前各持一份)。 */
export function positiveInt(value: number | undefined, fallback: number, field: string): number {
  const actual = value ?? fallback
  if (!Number.isSafeInteger(actual) || actual < 1) {
    throw new TBError('invalid_argument', `${field} must be a positive integer`)
  }
  return actual
}

export interface CursorCleanupProgress<TCursor> {
  cursor: TCursor
  revision: number
}

/**
 * 返回页数预算内未扫完时的续扫游标;整轮扫完或输掉 CAS 竞争(另一 cleaner 已推进,
 * 工作幂等、不得覆盖赢家)时返回 undefined。runPage 自行把单页结果聚合进调用方状态。
 */
export async function runCursorCleanup<TCursor>(opts: {
  /**
   * 与 parseProgress 对偶的持久化编码(保持各消费方既有落库形状)。
   * 落库对象必须保留 revision 字段:StateStore.compareAndSwap 以存量值的 revision 为比较键。
   */
  encodeProgress: (progress: CursorCleanupProgress<TCursor>) => unknown
  maxPages: number
  /** 校验并还原持久进度;形状非法时抛错(进度键被写坏属 internal)。 */
  parseProgress: (value: unknown) => CursorCleanupProgress<TCursor>
  progressKey: string
  /** 执行一页;返回下一页游标,undefined = 全部扫完。 */
  runPage: (cursor: TCursor | undefined, pageNumber: number) => Promise<TCursor | undefined>
  state: StateStore
}): Promise<TCursor | undefined> {
  // 不把方法解绑成局部函数:StateStore 实现依赖 this,解绑调用会静默丢失实例状态。
  const { state } = opts
  // 消费方在进入骨架前各自 fail closed(Store 由 runtime 构造强制,Mailbox 显式抛);
  // 此处兜底防新消费方漏判。
  if (state.compareAndSwap === undefined) {
    throw new TBError('unavailable', 'cursor cleanup requires StateStore.compareAndSwap')
  }
  const raw = await state.get(opts.progressKey)
  let progress = raw === null ? null : opts.parseProgress(raw)
  let cursor = progress?.cursor

  for (let pageNumber = 0; pageNumber < opts.maxPages; pageNumber++) {
    const nextCursor = await opts.runPage(cursor, pageNumber)
    if (nextCursor === undefined) {
      // 整轮扫完:清进度(仅当仍是本 cleaner 认知的版本;竞争输了也无妨,工作幂等)。
      if (progress !== null) {
        await state.compareAndSwap(opts.progressKey, progress.revision, null)
      }
      return undefined
    }
    const next: CursorCleanupProgress<TCursor> = {
      cursor: nextCursor,
      revision: (progress?.revision ?? 0) + 1,
    }
    const advanced = await state.compareAndSwap(
      opts.progressKey,
      progress?.revision ?? null,
      opts.encodeProgress(next),
    )
    // 另一 cleaner 已推进持久游标:不覆盖赢家、不从陈旧进度继续。
    if (!advanced) return undefined
    progress = next
    cursor = next.cursor
  }
  return cursor
}
