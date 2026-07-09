/**
 * builtin 模块 "plugin" → PluginRegistry(挂载为 system/plugin 节点,全 cmd 需 admin)。
 *
 * cmd 名对齐接口方法(list/get/write/update/delete)+ 按需探活 health(Workers 无常驻
 * 定时器,注册时探活 + health cmd 按需探活)。
 *
 * dispatch 只做纯逻辑与存储(KV key `plugin:<id>` / `pluginhealth:<id>` / `pluginmeta:<id>`);
 * 探活与抓 ~describe/~help 的 I/O 经 deps 注入的回调(probe / fetchContract),core 无 I/O。
 *
 * write 流程(注册流程):manifest 校验 → 探活(失败 → unavailable 拒)→
 * 契约校验(validatePluginContract,失败 → invalid_argument 拒)→ platform-token 时
 * mint SK(owner `plugin:<id>`,scopes 空)+ 明文存 SecretStore 保留名 `plugin-token:<id>`
 * → 存 manifest → 返回 PluginRegistration(pluginToken 仅此一次;get/list 永不回显)。
 *
 * update 流程:patch 合并重校验;endpoint/healthPath/kind/interfaceVersion 任一变更时
 * 走 write 同款重探活 + 重契约校验并刷新 meta/health(失败拒更新不落库),仅本地字段
 * (enabled 等)变更跳过;auth.kind 切换时吊销/换发 pluginToken(新 token 仅本响应一次)。
 */

import type { SKRegistryStore } from '../auth/sk'
import { TBError } from '../errors'
import type { CmdSpec, HelpModel } from '../htbp/model'
import { validatePluginContract } from '../plugin/contract'
import {
  type PluginManifest,
  type PluginRegistration,
  parsePluginManifest,
} from '../plugin/manifest'
import type { SecretStoreImpl } from '../secret/secretStore'
import { KEY_PLUGIN, KEY_PLUGIN_HEALTH, KEY_PLUGIN_META, type StateStore } from '../store'
import {
  type CallContext,
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  type Timestamp,
  type TreePath,
} from '../types'
import type { BuiltinModule } from './types'
import { cmdPath, LIST_OPTS_SCHEMA, optListOptions, requireString, VOID_ACK } from './util'

const DESCRIPTION =
  'Plugin registry: register / probe external tool & context providers, then mount them via system/registry (admin only)'

/** SecretStore 保留名:platform-token 明文的存放处。 */
export function pluginTokenSecretName(id: string): string {
  return `plugin-token:${id}`
}

/** 探活结果(I/O 在宿主回调;detail 进拒绝消息)。 */
export interface PluginProbeResult {
  healthy: boolean
  detail?: string
}

/** `pluginhealth:<id>` 的落盘形状。 */
export interface PluginHealthRecord {
  healthy: boolean
  checkedAt: Timestamp
  consecutiveFailures: number
}

/**
 * `plugin:<id>` 的落盘形状:规范 manifest + 平台内部的 tokenSkId
 * (platform-token 所 mint SK 的 id,供换发/注销时吊销)。get/list 投影时剥离。
 */
type StoredPlugin = PluginManifest & { tokenSkId?: string }

function projectManifest(record: StoredPlugin): PluginManifest {
  const { tokenSkId: _tokenSkId, ...manifest } = record
  return manifest
}

export interface PluginModuleDeps {
  store: StateStore
  /** platform-token 的 SK 签发/吊销(owner `plugin:<id>`,scopes 空)。 */
  sk: SKRegistryStore
  /** platform-token 明文的保管处(保留名 `plugin-token:<id>`)。 */
  secrets: SecretStoreImpl
  now: () => string
  /** GET {endpoint}{healthPath} 探活;网络失败按 healthy:false 返回(I/O 在宿主)。 */
  probe(manifest: PluginManifest): Promise<PluginProbeResult>
  /** 抓 `~describe`/`~help`(带 Accept: application/json);失败抛 TBError(原样透传)。 */
  fetchContract(manifest: PluginManifest): Promise<{ describe: unknown; help: unknown }>
  /** 放行 http:// endpoint(仅本地开发;宿主按 env `TB_ALLOW_INSECURE_HTTP=true` 注入)。 */
  allowInsecureHttp?: boolean
}

function pluginCmds(nodePath: TreePath): CmdSpec[] {
  const path = cmdPath(nodePath)
  const idSchema = {
    type: 'object',
    properties: { id: { type: 'string', description: 'plugin id' } },
    required: ['id'],
  }
  return [
    {
      name: 'list',
      method: 'POST',
      path,
      h: 'list registered plugins (pluginToken never returned)',
      inputSchema: { type: 'object', properties: { opts: LIST_OPTS_SCHEMA } },
      returns: 'Page<PluginManifest>',
      scope: 'admin',
    },
    {
      name: 'get',
      method: 'POST',
      path,
      h: 'fetch one plugin manifest by id',
      inputSchema: idSchema,
      returns: 'PluginManifest',
      scope: 'admin',
    },
    {
      name: 'write',
      method: 'POST',
      path,
      h: 'register a plugin: probes health and validates its contract before accepting; then mount it via system/registry (kind "tool"/"context" with config.provider = "plugin:<id>")',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'unique plugin id' },
          kind: { type: 'string', enum: ['tool-provider', 'context-provider'] },
          interfaceVersion: { type: 'string', description: 'plugin interface version, e.g. "v1"' },
          endpoint: { type: 'string', description: 'https base URL of the plugin service' },
          auth: {
            type: 'object',
            description:
              '{ kind: "platform-token" } — gateway mints the token (shown once in the response); or { kind: "bearer", token }',
          },
          healthPath: { type: 'string', description: 'GET probe path, e.g. "/healthz"' },
          enabled: { type: 'boolean' },
        },
        required: ['id', 'kind', 'interfaceVersion', 'endpoint', 'auth', 'healthPath', 'enabled'],
      },
      returns: 'PluginRegistration — pluginToken shown once (platform-token only)',
      scope: 'admin',
    },
    {
      name: 'update',
      method: 'POST',
      path,
      h: 'patch a registration; endpoint/kind changes re-probe and re-validate the contract before applying',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'plugin id' },
          patch: {
            type: 'object',
            description: 'fields to change; same shape as write, all optional',
          },
        },
        required: ['id', 'patch'],
      },
      returns: 'PluginManifest — pluginToken shown once if auth switched to platform-token',
      scope: 'admin',
    },
    {
      name: 'delete',
      method: 'POST',
      path,
      h: 'unregister a plugin and revoke its platform token; mounted nodes referencing it stop working',
      inputSchema: idSchema,
      returns: 'void',
      scope: 'admin',
    },
    {
      name: 'health',
      method: 'POST',
      path,
      h: 'probe the plugin health endpoint now',
      inputSchema: idSchema,
      returns: '{ id, healthy, checkedAt }',
      scope: 'admin',
    },
  ]
}

function clampLimit(limit?: number): number {
  if (limit === undefined || limit < 1) return LIST_LIMIT_DEFAULT
  return limit > LIST_LIMIT_MAX ? LIST_LIMIT_MAX : limit
}

export function createPluginModule(deps: PluginModuleDeps): BuiltinModule {
  const { store, sk, secrets, now } = deps

  async function read(id: string): Promise<StoredPlugin | null> {
    return (await store.get(KEY_PLUGIN + id)) as StoredPlugin | null
  }

  async function require(id: string): Promise<StoredPlugin> {
    const record = await read(id)
    if (!record) throw new TBError('not_found', `plugin '${id}' not found`)
    return record
  }

  /** 吊销上一代 platform-token(换发/注销/切到 bearer 时;SK 删除幂等)。 */
  async function revokeToken(record: StoredPlugin): Promise<void> {
    if (record.tokenSkId !== undefined) await sk.delete(record.tokenSkId)
    try {
      await secrets.delete(pluginTokenSecretName(record.id))
    } catch {
      // 不存在则幂等静默(SecretStore.delete 对缺失抛 not_found)。
    }
  }

  async function probeAndRecord(manifest: PluginManifest): Promise<PluginHealthRecord> {
    const result = await deps.probe(manifest)
    const prev = (await store.get(KEY_PLUGIN_HEALTH + manifest.id)) as PluginHealthRecord | null
    const record: PluginHealthRecord = {
      healthy: result.healthy,
      checkedAt: now(),
      consecutiveFailures: result.healthy ? 0 : (prev?.consecutiveFailures ?? 0) + 1,
    }
    await store.put(KEY_PLUGIN_HEALTH + manifest.id, record)
    return record
  }

  async function write(args: Record<string, unknown>): Promise<PluginRegistration> {
    const manifest = parsePluginManifest(args, {
      allowInsecureHttp: deps.allowInsecureHttp ?? false,
    })

    // 探活(失败拒注册)。
    const probed = await deps.probe(manifest)
    if (!probed.healthy) {
      throw new TBError(
        'unavailable',
        `plugin '${manifest.id}' 探活失败,拒绝注册${probed.detail !== undefined ? `:${probed.detail}` : ''}`,
        { retryable: true },
      )
    }

    // 契约校验(方法集合 / ~describe 一致性;失败 TBError 原样抛)。
    const contract = await deps.fetchContract(manifest)
    const describe = validatePluginContract({
      manifest,
      describe: contract.describe,
      help: contract.help,
    })

    // platform-token:mint SK(owner plugin:<id>,scopes 空)+ 明文存保留名;重注册换发并吊销上一代。
    const existing = await read(manifest.id)
    if (existing) await revokeToken(existing)
    let pluginToken: string | undefined
    let tokenSkId: string | undefined
    if (manifest.auth.kind === 'platform-token') {
      const minted = await sk.write({ owner: `plugin:${manifest.id}`, scopes: [] }, now())
      await secrets.set(pluginTokenSecretName(manifest.id), minted.secret, now())
      pluginToken = minted.secret
      tokenSkId = minted.key.id
    }

    await store.put(KEY_PLUGIN_META + manifest.id, describe)
    await store.put(KEY_PLUGIN_HEALTH + manifest.id, {
      healthy: true,
      checkedAt: now(),
      consecutiveFailures: 0,
    } satisfies PluginHealthRecord)
    const record: StoredPlugin = {
      ...manifest,
      ...(tokenSkId !== undefined ? { tokenSkId } : {}),
    }
    await store.put(KEY_PLUGIN + manifest.id, record)

    return { ...manifest, ...(pluginToken !== undefined ? { pluginToken } : {}) }
  }

  async function update(id: string, patch: Record<string, unknown>): Promise<PluginRegistration> {
    const existing = await require(id)
    if (patch.id !== undefined && patch.id !== id) {
      throw new TBError('invalid_argument', 'id 不可通过 update 变更')
    }
    const prev = projectManifest(existing)
    // merge 后整体重校验(kind↔interfaceVersion 一致性、endpoint https 强制照旧生效)。
    const merged = parsePluginManifest(
      { ...prev, ...patch },
      { allowInsecureHttp: deps.allowInsecureHttp ?? false },
    )

    // 契约相关字段变更 → 与 write 同流程重探活 + 重抓 ~describe/~help,刷新 meta/health;
    // 失败即拒不落库。仅本地字段(enabled 等)变更跳过——禁用一个已挂掉的 plugin 不应被探活挡住。
    const contractChanged =
      merged.endpoint !== prev.endpoint ||
      merged.healthPath !== prev.healthPath ||
      merged.kind !== prev.kind ||
      merged.interfaceVersion !== prev.interfaceVersion
    if (contractChanged) {
      const probed = await deps.probe(merged)
      if (!probed.healthy) {
        throw new TBError(
          'unavailable',
          `plugin '${id}' 探活失败,拒绝更新${probed.detail !== undefined ? `:${probed.detail}` : ''}`,
          { retryable: true },
        )
      }
      const contract = await deps.fetchContract(merged)
      const describe = validatePluginContract({
        manifest: merged,
        describe: contract.describe,
        help: contract.help,
      })
      await store.put(KEY_PLUGIN_META + id, describe)
      await store.put(KEY_PLUGIN_HEALTH + id, {
        healthy: true,
        checkedAt: now(),
        consecutiveFailures: 0,
      } satisfies PluginHealthRecord)
    }

    // auth kind 切换:platform-token → bearer 吊销旧 SK/明文;bearer → platform-token
    // mint 新 SK(pluginToken 仅本响应一次)。同 kind 不换发(换发语义走重注册 write)。
    let tokenSkId = existing.tokenSkId
    let pluginToken: string | undefined
    if (merged.auth.kind !== prev.auth.kind) {
      if (prev.auth.kind === 'platform-token') {
        await revokeToken(existing)
        tokenSkId = undefined
      }
      if (merged.auth.kind === 'platform-token') {
        const minted = await sk.write({ owner: `plugin:${id}`, scopes: [] }, now())
        await secrets.set(pluginTokenSecretName(id), minted.secret, now())
        pluginToken = minted.secret
        tokenSkId = minted.key.id
      }
    }

    await store.put(KEY_PLUGIN + id, {
      ...merged,
      ...(tokenSkId !== undefined ? { tokenSkId } : {}),
    } satisfies StoredPlugin)
    return { ...merged, ...(pluginToken !== undefined ? { pluginToken } : {}) }
  }

  async function remove(id: string): Promise<void> {
    const existing = await read(id)
    if (!existing) return // 幂等静默(与 sk.delete 同语义)
    await revokeToken(existing)
    await store.delete(KEY_PLUGIN + id)
    await store.delete(KEY_PLUGIN_HEALTH + id)
    await store.delete(KEY_PLUGIN_META + id)
  }

  return {
    module: 'plugin',
    description: DESCRIPTION,
    help(nodePath: TreePath): HelpModel {
      return {
        node: { path: nodePath, kind: 'builtin', description: DESCRIPTION },
        cmds: pluginCmds(nodePath),
      }
    },
    async dispatch(
      cmd: string,
      args: Record<string, unknown>,
      _ctx: CallContext,
    ): Promise<unknown> {
      switch (cmd) {
        case 'list': {
          const opts = optListOptions(args)
          const listOpts: { limit: number; cursor?: string } = { limit: clampLimit(opts?.limit) }
          if (opts?.cursor !== undefined) listOpts.cursor = opts.cursor
          const page = await store.list(KEY_PLUGIN, listOpts)
          const items = page.items.map(({ value }) => projectManifest(value as StoredPlugin))
          return page.cursor !== undefined ? { items, cursor: page.cursor } : { items }
        }
        case 'get':
          return projectManifest(await require(requireString(args, 'id')))
        case 'write':
          return write(args)
        case 'update': {
          const id = requireString(args, 'id')
          const patch = args.patch
          if (typeof patch !== 'object' || patch === null) {
            throw new TBError('invalid_argument', "field 'patch' must be an object")
          }
          return update(id, patch as Record<string, unknown>)
        }
        case 'delete':
          await remove(requireString(args, 'id'))
          return VOID_ACK
        case 'health': {
          const id = requireString(args, 'id')
          const manifest = projectManifest(await require(id))
          const record = await probeAndRecord(manifest)
          return { id, healthy: record.healthy, checkedAt: record.checkedAt }
        }
        default:
          throw new TBError('invalid_argument', `unknown cmd '${cmd}' on system/plugin`)
      }
    },
  }
}
