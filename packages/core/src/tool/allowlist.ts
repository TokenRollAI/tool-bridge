/**
 * remote 联邦 host 白名单的运行时存储(纯逻辑,经注入 StateStore 读写)。
 *
 * 部署期 env 基线(TB_REMOTE_ALLOWLIST)不可变、不可删;此存储是**运行时可增删**的
 * 叠加层,与 env 基线取并集后交给 {@link checkAllowlist} 判定(见 gateway resolveRemoteSettings)。
 * 单 key 存整份数组(白名单规模小,免翻页);条目做规范化 host + 去重 + 时间戳。
 */

import { TBError } from '../errors'
import type { StateStore } from '../store'
import { KEY_REMOTE_ALLOWLIST } from '../store'

/** 一条运行时白名单条目:host 后缀 + 写入时间。 */
export interface AllowlistEntry {
  host: string
  updatedAt: string
}

/**
 * 规范化并校验一个 host 后缀条目:小写、去首尾空白;拒绝 scheme/端口/路径/空白等非 host 形态。
 * 允许普通域名后缀(`example.com` / `api.example.com`)与 IPv6 字面量(`[::1]`)。
 */
export function normalizeAllowHost(raw: string): string {
  const host = raw.trim().toLowerCase()
  if (host === '') {
    throw new TBError('invalid_argument', 'host 不能为空')
  }
  if (/[\s/?#@]/.test(host) || host.includes('://')) {
    throw new TBError('invalid_argument', `host 只能是裸主机名后缀(不含 scheme/端口/路径):'${raw}'`)
  }
  // IPv6 字面量:[....];否则普通主机名/后缀(段以字母数字始末,允许 . 与 -)。
  const isIpv6 = host.startsWith('[') && host.endsWith(']') && host.length > 2
  const isHostname = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)
  if (!isIpv6 && !isHostname) {
    throw new TBError('invalid_argument', `非法 host:'${raw}'`)
  }
  return host
}

/** StateStore 支撑的运行时白名单存储。 */
export class RemoteAllowlistStore {
  constructor(private readonly store: StateStore) {}

  /** 读全部运行时条目(缺省/脏值 → 空数组);按 host 升序稳定输出。 */
  async list(): Promise<AllowlistEntry[]> {
    const raw = await this.store.get(KEY_REMOTE_ALLOWLIST)
    if (!Array.isArray(raw)) return []
    const entries: AllowlistEntry[] = []
    for (const item of raw) {
      if (
        item !== null &&
        typeof item === 'object' &&
        typeof (item as AllowlistEntry).host === 'string'
      ) {
        const e = item as AllowlistEntry
        entries.push({
          host: e.host,
          updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : '',
        })
      }
    }
    return entries.sort((a, b) => a.host.localeCompare(b.host))
  }

  /** 仅取 host 列表(供 checkAllowlist 与 env 基线取并集)。 */
  async hosts(): Promise<string[]> {
    return (await this.list()).map((e) => e.host)
  }

  /** 新增一条(规范化 + 幂等:同名则刷新时间戳)。 */
  async add(rawHost: string, now: string): Promise<AllowlistEntry> {
    const host = normalizeAllowHost(rawHost)
    const entries = (await this.list()).filter((e) => e.host !== host)
    const entry: AllowlistEntry = { host, updatedAt: now }
    entries.push(entry)
    entries.sort((a, b) => a.host.localeCompare(b.host))
    await this.store.put(KEY_REMOTE_ALLOWLIST, entries)
    return entry
  }

  /** 删除一条(规范化后匹配;不存在 → not_found)。 */
  async remove(rawHost: string): Promise<void> {
    const host = normalizeAllowHost(rawHost)
    const entries = await this.list()
    const next = entries.filter((e) => e.host !== host)
    if (next.length === entries.length) {
      throw TBError.notFound(`host 不在运行时白名单:'${host}'`)
    }
    await this.store.put(KEY_REMOTE_ALLOWLIST, next)
  }
}
