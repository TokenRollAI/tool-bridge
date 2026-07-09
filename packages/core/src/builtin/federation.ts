/**
 * builtin 模块 "federation" → remote 联邦 host 白名单管理(挂载为 system/federation 节点,需 admin)。
 *
 * 白名单是 remote 节点的 SSRF 闸门(空 = 拒一切 remote)。部署期 env 基线只读不可删;
 * 本模块管理**运行时叠加层**(见 {@link RemoteAllowlistStore}),二者并集才是生效白名单。
 * `list` 输出合并视图(标注 source:env|store,env 条目 removable=false)。
 */

import { TBError } from '../errors'
import type { CmdSpec, HelpModel } from '../htbp/model'
import { normalizeAllowHost, type RemoteAllowlistStore } from '../tool/allowlist'
import type { CallContext, TreePath } from '../types'
import type { BuiltinModule } from './types'
import { cmdPath, requireString, VOID_ACK } from './util'

const DESCRIPTION =
  'Remote federation host allowlist: which hosts kind=remote nodes may connect to (env baseline is read-only; admin only)'

/** list 合并视图的一行:host + 来源 + 是否可删 + 运行时条目的写入时间。 */
export interface FederationHost {
  host: string
  source: 'env' | 'store'
  removable: boolean
  updatedAt?: string
}

function federationCmds(nodePath: TreePath): CmdSpec[] {
  const path = cmdPath(nodePath)
  return [
    {
      name: 'list',
      method: 'POST',
      path,
      h: 'merged allowlist view: env baseline entries (removable=false) plus runtime entries',
      inputSchema: { type: 'object', properties: {} },
      returns: 'Page<{ host, source: "env"|"store", removable, updatedAt? }>',
      scope: 'admin',
    },
    {
      name: 'add',
      method: 'POST',
      path,
      h: 'allow a host (suffix match covers subdomains); takes effect immediately',
      inputSchema: {
        type: 'object',
        properties: {
          host: {
            type: 'string',
            description: 'bare host suffix, e.g. "example.com" — no scheme/port/path',
          },
        },
        required: ['host'],
      },
      returns: '{ host, updatedAt } — bare host suffix; no scheme/port/path',
      scope: 'admin',
    },
    {
      name: 'remove',
      method: 'POST',
      path,
      h: 'remove a runtime-added host; env baseline entries cannot be removed here',
      inputSchema: {
        type: 'object',
        properties: { host: { type: 'string', description: 'bare host suffix as listed' } },
        required: ['host'],
      },
      returns: 'void — env baseline entries are not removable',
      scope: 'admin',
    },
  ]
}

export interface FederationModuleDeps {
  store: RemoteAllowlistStore
  /** 部署期 env 白名单基线(只读、不可删;来自 TB_REMOTE_ALLOWLIST)。 */
  base: string[]
  now: () => string
}

/** 合并 env 基线与运行时条目为 list 视图(env 优先标注,去重)。 */
function mergedView(
  base: string[],
  entries: { host: string; updatedAt: string }[],
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

export function createFederationModule(deps: FederationModuleDeps): BuiltinModule {
  return {
    module: 'federation',
    description: DESCRIPTION,
    help(nodePath: TreePath): HelpModel {
      return {
        node: { path: nodePath, kind: 'builtin', description: DESCRIPTION },
        cmds: federationCmds(nodePath),
      }
    },
    async dispatch(
      cmd: string,
      args: Record<string, unknown>,
      _ctx: CallContext,
    ): Promise<unknown> {
      switch (cmd) {
        case 'list': {
          const items = mergedView(deps.base, await deps.store.list())
          return { items }
        }
        case 'add': {
          const host = normalizeAllowHost(requireString(args, 'host'))
          // 已在 env 基线中 → 无需(也不能)增删;明确报错,避免"加了却看不到 store 条目"的困惑。
          if (deps.base.some((b) => b.trim().toLowerCase() === host)) {
            throw new TBError('invalid_argument', `host 已在部署基线(env)中,无需添加:'${host}'`)
          }
          return await deps.store.add(host, deps.now())
        }
        case 'remove': {
          const host = normalizeAllowHost(requireString(args, 'host'))
          if (deps.base.some((b) => b.trim().toLowerCase() === host)) {
            throw new TBError(
              'invalid_argument',
              `env 基线条目不可删除:'${host}'(改 TB_REMOTE_ALLOWLIST 并重新部署)`,
            )
          }
          await deps.store.remove(host)
          return VOID_ACK
        }
        default:
          throw new TBError('invalid_argument', `unknown cmd '${cmd}' on system/federation`)
      }
    },
  }
}
