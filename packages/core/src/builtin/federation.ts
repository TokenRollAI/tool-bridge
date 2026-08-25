/**
 * builtin 模块 "federation" → remote 联邦 host 白名单管理(挂载为 system/federation 节点,需 admin)。
 *
 * 白名单是 remote 节点的 SSRF 闸门(空 = 拒一切 remote)。部署期 env 基线只读不可删;
 * 本模块管理**运行时叠加层**(见 {@link RemoteAllowlistStore}),二者并集才是生效白名单。
 * `list` 输出合并视图(标注 source:env|store,env 条目 removable=false)。
 */

import { z } from 'zod/v4'
import type { BuiltinModule } from './types'
import { normalizeAllowHost, type RemoteAllowlistStore } from '../tool/allowlist'
import { BuiltinCommandRegistry } from './commandRegistry'
import { TBError } from '../errors'
import { VOID_ACK } from './util'

const DESCRIPTION
  = 'Remote federation host allowlist: which hosts kind=remote nodes may connect to (env baseline is read-only; admin only)'

/** list 合并视图的一行:host + 来源 + 是否可删 + 运行时条目的写入时间。 */
export interface FederationHost {
  host: string
  removable: boolean
  source: 'env' | 'store'
  updatedAt?: string
}

export interface FederationModuleDeps {
  /** 部署期 env 白名单基线(只读、不可删;来自 TB_REMOTE_ALLOWLIST)。 */
  base: string[]
  now: () => string
  store: RemoteAllowlistStore
}

/** 合并 env 基线与运行时条目为 list 视图(env 优先标注,去重)。 */
function mergedView(
  base: string[],
  entries: { host: string, updatedAt: string }[],
): FederationHost[] {
  const byHost = new Map<string, FederationHost>()
  for (const raw of base) {
    const host = raw.trim().toLowerCase()
    if (host !== '') byHost.set(host, { host, source: 'env', removable: false })
  }
  for (const e of entries) {
    // env 基线已含则不被运行时条目覆盖(仍标 env、不可删)。
    if (!byHost.has(e.host)) {
      byHost.set(e.host, { host: e.host, source: 'store', removable: true, updatedAt: e.updatedAt })
    }
  }
  return [...byHost.values()].sort((a, b) => a.host.localeCompare(b.host))
}

const COMMANDS = new BuiltinCommandRegistry<FederationModuleDeps>('federation', DESCRIPTION)
  .register(
    'list',
    {
      h: 'merged allowlist view: env baseline entries (removable=false) plus runtime entries',
      inputSchema: z.strictObject({}),
      returns: 'Page<{ host, source: "env"|"store", removable, updatedAt? }>',
      scope: 'admin',
    },
    async (_input, { deps }) => ({ items: mergedView(deps.base, await deps.store.list()) }),
  )
  .register(
    'add',
    {
      h: 'allow a host (suffix match covers subdomains); takes effect immediately',
      inputSchema: z.strictObject({
        host: z.string().min(1).describe(
          'bare host suffix, e.g. "example.com" — no scheme/port/path',
        ),
      }),
      returns: '{ host, updatedAt } — bare host suffix; no scheme/port/path',
      scope: 'admin',
    },
    async ({ host }, { deps }) => {
      const normalized = normalizeAllowHost(host)
      // 已在 env 基线中 → 无需(也不能)增删;明确报错,避免"加了却看不到 store 条目"的困惑。
      if (deps.base.some(b => b.trim().toLowerCase() === normalized)) {
        throw new TBError('invalid_argument', `host 已在部署基线(env)中,无需添加:'${normalized}'`)
      }
      return await deps.store.add(normalized, deps.now())
    },
  )
  .register(
    'remove',
    {
      h: 'remove a runtime-added host; env baseline entries cannot be removed here',
      inputSchema: z.strictObject({
        host: z.string().min(1).describe('bare host suffix as listed'),
      }),
      returns: 'void — env baseline entries are not removable',
      scope: 'admin',
    },
    async ({ host }, { deps }) => {
      const normalized = normalizeAllowHost(host)
      if (deps.base.some(b => b.trim().toLowerCase() === normalized)) {
        throw new TBError(
          'invalid_argument',
          `env 基线条目不可删除:'${normalized}'(改 TB_REMOTE_ALLOWLIST 并重新部署)`,
        )
      }
      await deps.store.remove(normalized)
      return VOID_ACK
    },
  )

export function createFederationModule(deps: FederationModuleDeps): BuiltinModule {
  return COMMANDS.module(deps)
}
