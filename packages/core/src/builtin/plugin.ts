/**
 * builtin 模块 "plugin" → PluginRegistry(挂载为 system/plugin 节点,全 cmd 需 admin)。
 *
 * cmd 名对齐接口方法(list/get/write/update/delete)+ 按需探活 health(Workers 无常驻
 * 定时器,注册时探活 + health cmd 按需探活)。
 *
 * dispatch 只做纯逻辑与存储(KV key `plugin:<id>` / `pluginhealth:<id>` / `pluginmeta:<id>`);
 * 探活与抓 /~describe 的 I/O 经 deps 注入的回调(probe / fetchContract),core 无 I/O。
 *
 * write 流程(注册流程):manifest 校验 → 探活(失败 → unavailable 拒)→
 * 契约校验(validatePluginContract,失败 → invalid_argument 拒)→ platform-token 时
 * mint SK(owner `plugin:<id>`,scopes 空)+ 明文存 SecretStore 保留名 `plugin-token:<id>`
 * → 存 manifest → 返回 PluginView + pluginToken(仅此一次;get/list 永不回显)。
 *
 * update 流程:patch 合并重校验;endpoint/healthPath/protocolVersion 任一变更时
 * 走 write 同款重探活 + 重契约校验并刷新 meta/health(失败拒更新不落库),仅本地字段
 * (enabled 等)变更跳过;auth.kind 切换时吊销/换发 pluginToken(新 token 仅本响应一次)。
 */

import { z } from 'zod/v4'
import type { SecretStoreImpl } from '../secret/secretStore'
import type { SKRegistryStore } from '../auth/sk'
import type { BuiltinModule } from './types'
import { type PluginDescribe, type PluginExport, validatePluginContract } from '../plugin/contract'
import { KEY_PLUGIN, KEY_PLUGIN_HEALTH, KEY_PLUGIN_META, type StateStore } from '../store'
import {
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  type Timestamp,
} from '../types'
import {
  parsePluginManifest,
  type PluginManifest,
} from '../plugin/manifest'
import { BuiltinCommandRegistry } from './commandRegistry'
import { LIST_OPTS_ZOD_SCHEMA, VOID_ACK } from './util'
import { TBError } from '../errors'
import { omit } from '../omit'

const DESCRIPTION
  = 'Plugin registry: register / probe external tool & context providers, then mount them via system/registry (admin only)'

/** SecretStore 保留名:platform-token 明文的存放处。 */
export function pluginTokenSecretName(id: string): string {
  return `plugin-token:${id}`
}

/** 探活结果(I/O 在宿主回调;detail 进拒绝消息)。 */
export interface PluginProbeResult {
  detail?: string
  healthy: boolean
}

/** `pluginhealth:<id>` 的落盘形状。 */
export interface PluginHealthRecord {
  checkedAt: Timestamp
  consecutiveFailures: number
  healthy: boolean
}

/**
 * `plugin:<id>` 的落盘形状:规范 manifest + 平台内部的 tokenSkId
 * (platform-token 所 mint SK 的 id,供换发/注销时吊销)。get/list 投影时剥离。
 */
type StoredPlugin = PluginManifest & { tokenSkId?: string }

function projectManifest(record: StoredPlugin): PluginManifest {
  return omit(record, 'tokenSkId')
}

/**
 * 管理面投影:manifest + 注册时缓存的 `~describe.exports`。
 *
 * v1 的 manifest 有 `kind`,管理面据此回答"这个 plugin 是什么、能挂成什么";v2 把它下沉到
 * export 之后,若管理面只回 manifest,`tb plugin ls` 与 Dashboard 就再也答不出这个问题
 * ——也没法知道挂载时 `config.export` 该填什么(多 export plugin 必须显式指定)。
 * 故 get/list/write/update 一并回 exports:与网关挂载时读的是**同一份** `pluginmeta:<id>` 缓存,
 * 不另起真源。注册记录缺 meta 属于损坏状态，读操作响亮失败。
 */
export interface PluginView extends PluginManifest {
  exports: PluginExport[]
}

/** write/update 的返回:PluginView + pluginToken(仅该次响应出现一次)。 */
export interface PluginRegistration extends PluginView {
  pluginToken?: string
}

export interface PluginModuleDeps {
  /** 放行 http:// endpoint(仅本地开发;宿主按 env `TB_ALLOW_INSECURE_HTTP=true` 注入)。 */
  allowInsecureHttp?: boolean
  /** 抓 `/~describe`(带 Accept: application/json);失败抛 TBError(原样透传)。 */
  fetchContract(manifest: PluginManifest): Promise<{ describe: unknown }>
  now: () => string
  /** GET {endpoint}{healthPath} 探活;网络失败按 healthy:false 返回(I/O 在宿主)。 */
  probe(manifest: PluginManifest): Promise<PluginProbeResult>
  /** platform-token 明文的保管处(保留名 `plugin-token:<id>`)。 */
  secrets: SecretStoreImpl
  /** platform-token 的 SK 签发/吊销(owner `plugin:<id>`,scopes 空)。 */
  sk: SKRegistryStore
  store: StateStore
}

interface PluginCommandService {
  get(id: string): Promise<unknown>
  health(id: string): Promise<unknown>
  list(opts?: { cursor?: string, limit?: number }): Promise<unknown>
  remove(id: string): Promise<void>
  update(id: string, patch: Record<string, unknown>): Promise<PluginRegistration>
  write(input: Record<string, unknown>): Promise<PluginRegistration>
}

const pluginAuthSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('platform-token') }),
  z.strictObject({ kind: z.literal('bearer'), secretRef: z.string().min(1) }),
]).describe(
  '{ kind: "platform-token" } — gateway mints the token (shown once in the response); or { kind: "bearer", secretRef }',
)
const pluginIdSchema = z.string().min(1).describe('plugin id')
const manifestFields = {
  id: z.string().min(1).describe('unique plugin id'),
  protocolVersion: z.literal('plugin/v2').describe(
    'transport protocol version; what the plugin provides is declared by its /~describe exports',
  ),
  endpoint: z.string().min(1).describe('https base URL of the plugin service'),
  auth: pluginAuthSchema,
  healthPath: z.string().min(1).describe('GET probe path, e.g. "/healthz"'),
  enabled: z.boolean(),
}
const pluginWriteSchema = z.strictObject(manifestFields)
const pluginPatchSchema = z.strictObject({
  id: manifestFields.id.optional(),
  protocolVersion: manifestFields.protocolVersion.optional(),
  endpoint: manifestFields.endpoint.optional(),
  auth: manifestFields.auth.optional(),
  healthPath: manifestFields.healthPath.optional(),
  enabled: manifestFields.enabled.optional(),
}).describe('fields to change; same shape as write, all optional')

const COMMANDS = new BuiltinCommandRegistry<PluginCommandService>('plugin', DESCRIPTION)
  .register(
    'list',
    {
      h: 'list registered plugins (pluginToken never returned)',
      inputSchema: z.strictObject({ opts: LIST_OPTS_ZOD_SCHEMA.optional() }),
      returns: 'Page<PluginView> — manifest + the exports declared by its /~describe',
      scope: 'admin',
    },
    ({ opts }, { deps }) => deps.list(opts),
  )
  .register(
    'get',
    {
      h: 'fetch one plugin manifest by id',
      inputSchema: z.strictObject({ id: pluginIdSchema }),
      returns: 'PluginView — manifest + the exports declared by its /~describe',
      scope: 'admin',
    },
    ({ id }, { deps }) => deps.get(id),
  )
  .register(
    'write',
    {
      h: 'register a plugin: probes health and validates its /~describe exports before accepting; then mount an export via system/registry (config.provider = plugin id, config.export = export id)',
      inputSchema: pluginWriteSchema,
      returns: 'PluginView + pluginToken shown once (platform-token only)',
      scope: 'admin',
    },
    (input, { deps }) => deps.write(input),
  )
  .register(
    'update',
    {
      h: 'patch a registration; endpoint changes re-probe and re-validate the exports before applying',
      inputSchema: z.strictObject({
        id: pluginIdSchema,
        patch: pluginPatchSchema,
      }),
      returns: 'PluginView — pluginToken shown once if auth switched to platform-token',
      scope: 'admin',
    },
    ({ id, patch }, { deps }) => deps.update(id, patch),
  )
  .register(
    'delete',
    {
      h: 'unregister a plugin and revoke its platform token; mounted nodes referencing it stop working',
      inputSchema: z.strictObject({ id: pluginIdSchema }),
      returns: 'void',
      scope: 'admin',
    },
    async ({ id }, { deps }) => {
      await deps.remove(id)
      return VOID_ACK
    },
  )
  .register(
    'health',
    {
      h: 'probe the plugin health endpoint now',
      inputSchema: z.strictObject({ id: pluginIdSchema }),
      returns: '{ id, healthy, checkedAt }',
      scope: 'admin',
    },
    ({ id }, { deps }) => deps.health(id),
  )

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

  /** manifest + `pluginmeta:<id>` 里缓存的 exports。 */
  async function view(record: StoredPlugin): Promise<PluginView> {
    const describe = (await store.get(KEY_PLUGIN_META + record.id)) as PluginDescribe | null
    if (describe === null) {
      throw new TBError(
        'unavailable',
        `plugin '${record.id}' 缺少 ~describe 缓存,请重新注册`,
        { retryable: false },
      )
    }
    return { ...projectManifest(record), exports: describe.exports }
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
    const describe = validatePluginContract({ manifest, describe: contract.describe })

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

    return {
      ...manifest,
      exports: describe.exports,
      ...(pluginToken !== undefined ? { pluginToken } : {}),
    }
  }

  async function update(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<PluginRegistration> {
    const existing = await require(id)
    if (patch.id !== undefined && patch.id !== id) {
      throw new TBError('invalid_argument', 'id 不可通过 update 变更')
    }
    const prev = projectManifest(existing)
    // merge 后整体重校验(protocolVersion 合法性、endpoint https 强制照旧生效)。
    const merged = parsePluginManifest(
      { ...prev, ...patch },
      { allowInsecureHttp: deps.allowInsecureHttp ?? false },
    )

    // 契约相关字段变更 → 与 write 同流程重探活 + 重抓 ~describe,刷新 meta/health;
    // 失败即拒不落库。仅本地字段(enabled 等)变更跳过——禁用一个已挂掉的 plugin 不应被探活挡住。
    const contractChanged
      = merged.endpoint !== prev.endpoint
        || merged.healthPath !== prev.healthPath
        || merged.protocolVersion !== prev.protocolVersion
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

    const record: StoredPlugin = {
      ...merged,
      ...(tokenSkId !== undefined ? { tokenSkId } : {}),
    }
    await store.put(KEY_PLUGIN + id, record)
    // exports 从刚刷新的(或原有的)meta 缓存回读,与 get/list 同一来源。
    return { ...(await view(record)), ...(pluginToken !== undefined ? { pluginToken } : {}) }
  }

  async function remove(id: string): Promise<void> {
    const existing = await read(id)
    if (!existing) return // 幂等静默(与 sk.delete 同语义)
    await revokeToken(existing)
    await store.delete(KEY_PLUGIN + id)
    await store.delete(KEY_PLUGIN_HEALTH + id)
    await store.delete(KEY_PLUGIN_META + id)
  }

  return COMMANDS.module({
    async list(opts) {
      const listOpts: { cursor?: string, limit: number } = { limit: clampLimit(opts?.limit) }
      if (opts?.cursor !== undefined) listOpts.cursor = opts.cursor
      const page = await store.list(KEY_PLUGIN, listOpts)
      const items = await Promise.all(
        page.items.map(({ value }) => view(value as StoredPlugin)),
      )
      return page.cursor !== undefined ? { items, cursor: page.cursor } : { items }
    },
    async get(id) {
      return await view(await require(id))
    },
    write,
    update,
    remove,
    async health(id) {
      const manifest = projectManifest(await require(id))
      const record = await probeAndRecord(manifest)
      return { id, healthy: record.healthy, checkedAt: record.checkedAt }
    },
  })
}
