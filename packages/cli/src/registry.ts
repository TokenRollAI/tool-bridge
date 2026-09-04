import { readFileSync } from 'node:fs'
import type { HttpToolDef, Node, NodeInput, Virtualize } from './types'
import { callDirect, CliError, type Target, withClient } from './http'
import { parseKeyValueSpecs } from './args'
import { asArray } from './output'

/**
 * 挂载/卸载节点的共用逻辑。CLI 统一走 `~register` 注册(受限 SK 亦可用),
 * 卸载走管理面 `system/registry` delete。
 */

/**
 * 走 `POST /<path>/~register` 注册节点。
 * body = NodeInput,且 body.path 必须等于 URL path。
 */
export async function registerNode(target: Target, input: NodeInput): Promise<Node> {
  // NodeInput/response 都由 SDK 固定 wire schema 做运行时校验；CLI 只保留构造与展示类型。
  return await withClient(target, async client => await client.registerNode(input)) as Node
}

/**
 * 卸载节点:无 `~unregister` 端点,delete 走管理面 `system/registry`(管理通道)。
 * 调用者无 system 可见性时返回 404 → 补充可操作提示。
 */
export async function deleteNode(
  target: Target,
  path: string,
  expectedKinds?: readonly string[],
): Promise<void> {
  try {
    if (expectedKinds !== undefined) {
      const node = await callDirect<Node>(target, '/system/registry/get', { path })
      if (!expectedKinds.includes(node.kind)) {
        throw new CliError(
          `node '${path}' is kind '${node.kind}', expected ${expectedKinds.join(' | ')}`,
          'invalid_argument',
        )
      }
    }
    await callDirect(target, '/system/registry/delete', { path })
  } catch (err) {
    if (err instanceof CliError && err.code === 'not_found') {
      throw new CliError(
        `${err.message} — 卸载走管理面 system/registry delete,需要对 system/registry 的可见性(admin/read + register 动作)`,
        err.code,
      )
    }
    throw err
  }
}

/**
 * 由 --prefix / --rename(可重复 "from=to")/ --hide(可重复)构造 Virtualize。
 * 无任一字段时返回 undefined(不塞空对象)。rename 在 prefix 之前应用。
 */
export function buildVirtualize(args: {
  describe?: unknown
  hide?: unknown
  prefix?: unknown
  rename?: unknown
}): Virtualize | undefined {
  const v: Virtualize = {}

  const prefix = args.prefix ? String(args.prefix) : undefined
  if (prefix) v.prefix = prefix

  const rename = parseKeyValueSpecs(asArray(args.rename), {
    expected: '"from=to" e.g. "old__name=new"',
    flag: '--rename',
    keyLabel: 'from',
    onDuplicate: 'last-wins',
    trimValue: true,
    valueLabel: 'to',
  })
  if (Object.keys(rename).length) v.rename = rename

  const hide = asArray(args.hide)
  if (hide.length) v.hide = hide

  const describe = parseKeyValueSpecs(asArray(args.describe), {
    expected: '"from=text"',
    flag: '--describe',
    keyLabel: 'from',
    onDuplicate: 'last-wins',
    trimValue: true,
    valueLabel: 'text',
  })
  if (Object.keys(describe).length) v.describe = describe

  return Object.keys(v).length ? v : undefined
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE'])

/** 校验单个 HttpToolDef 的必填字段(name/description/method/pathTemplate)。 */
function validateToolDef(t: unknown, i: number): HttpToolDef {
  if (!t || typeof t !== 'object') {
    throw new CliError(`--tools-file[${i}] must be an object`)
  }
  const o = t as Record<string, unknown>
  for (const field of ['name', 'description', 'method', 'pathTemplate']) {
    if (typeof o[field] !== 'string' || (o[field] as string).length === 0) {
      throw new CliError(`--tools-file[${i}] missing required string field "${field}"`)
    }
  }
  const method = String(o.method).toUpperCase()
  if (!HTTP_METHODS.has(method)) {
    throw new CliError(
      `--tools-file[${i}] invalid method "${o.method}"; valid: GET, POST, PUT, DELETE`,
    )
  }
  const def: HttpToolDef = {
    name: String(o.name),
    description: String(o.description),
    method: method as HttpToolDef['method'],
    pathTemplate: String(o.pathTemplate),
  }
  if (o.inputSchema !== undefined) def.inputSchema = o.inputSchema
  if (o.effect !== undefined) def.effect = o.effect as HttpToolDef['effect']
  return def
}

/**
 * 可重复 `--config key=value` → providerConfig 对象;空数组返回 undefined(不塞空对象)。
 *
 * 这是 `kind:'tool'` 与 plugin context 挂载的 **providerConfig 输入口**。此前 CLI 与
 * Dashboard 都没有,于是 memos / grafana / metabase / langsmith 这些"必须配 baseUrl 或
 * instanceUrl"的 provider 在两个操作面都挂不出可用状态 —— 只能手写节点 JSON 直打
 * `system/registry`,那是管理旁路(算缺陷,见 CLAUDE.md 的三入口对等纪律)。
 *
 * **值一律按字符串收**:providerConfig 是明文存的非敏感配置(`system/registry get` 会原样
 * 回显),当前消费方(如 memos 的 `ctx.config.baseUrl`)取的都是字符串。不猜类型转换 ——
 * 猜错会把 `region=0755` 变成数字 755。结构化配置留给后续的 mountConfigSchema 校验面。
 *
 * 密钥不走这里:它明文进节点记录,任何对该节点有 read 的 SK 都看得见。凭证走 --auth-ref。
 */
export function parseConfigSpecs(specs: string[]): Record<string, string> | undefined {
  const config = parseKeyValueSpecs(specs, {
    flag: '--config',
    onDuplicate: 'last-wins',
    trimValue: true,
  })
  return Object.keys(config).length ? config : undefined
}

/**
 * storage/s3 对象存储挂载的共用参数面(ctx mount 与 skill mount 的 provider 分支逐行同构,收敛于此):
 * - storage:平台自带桶,拒绝 --endpoint/--bucket/--region/--auth-ref;providerConfig 只含可选 prefix。
 * - s3:--endpoint/--bucket/--auth-ref 必填,region/prefix 可选。
 * - 其余 provider:allowPlugin(ctx mount)时走 plugin 分支(拒 storage/s3 专用 flag,
 *   --config → providerConfig);否则直接拒(skill mount 只认 storage/s3)。
 * 返回 providerConfig(空则 undefined,不塞空对象);authRef 的落位仍由调用方组装。
 */
export function parseObjectStorageMountOpts(
  provider: string,
  opts: {
    authRef?: string
    backendId?: unknown
    bucket?: unknown
    config?: string[]
    endpoint?: unknown
    prefix?: string
    region?: unknown
  },
  { allowPlugin = false }: { allowPlugin?: boolean } = {},
): Record<string, unknown> | undefined {
  const { authRef, prefix } = opts
  const configSpecs = opts.config ?? []
  if (provider === 'storage') {
    if (opts.endpoint || opts.bucket || opts.region || authRef) {
      throw new CliError('--endpoint/--bucket/--region/--auth-ref only apply to s3')
    }
    if (configSpecs.length > 0) {
      throw new CliError('--config only applies to plugin providers')
    }
    const backendId = typeof opts.backendId === 'string' ? opts.backendId.trim() : ''
    return prefix || backendId ? { ...(prefix ? { prefix } : {}), ...(backendId ? { backendId } : {}) } : undefined
  }
  if (opts.backendId !== undefined) throw new CliError('--backend-id only applies to storage')
  if (provider === 's3') {
    const endpoint = String(opts.endpoint ?? '').trim()
    if (!endpoint) throw new CliError('--endpoint is required for --provider s3')
    const bucket = String(opts.bucket ?? '').trim()
    if (!bucket) throw new CliError('--bucket is required for --provider s3')
    if (!authRef) throw new CliError('--auth-ref is required for --provider s3')
    if (configSpecs.length > 0) {
      throw new CliError('--config only applies to plugin providers')
    }
    return {
      endpoint,
      bucket,
      ...(opts.region ? { region: String(opts.region) } : {}),
      ...(prefix ? { prefix } : {}),
    }
  }
  if (!allowPlugin) {
    throw new CliError(`invalid --provider "${provider}"; valid: storage, s3`)
  }
  if (opts.endpoint || opts.bucket || opts.region || prefix) {
    throw new CliError(
      '--endpoint/--bucket/--region/--prefix are not supported for plugin providers',
    )
  }
  // plugin context 的非密钥挂载配置(baseUrl / workspace 之类)。
  return parseConfigSpecs(configSpecs)
}

/** 从文件读取并校验 HttpToolDef[](--kind http 的工具集数据源)。 */
export function parseToolsFile(file: string): HttpToolDef[] {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (err) {
    throw new CliError(`cannot read --tools-file "${file}": ${(err as Error).message}`)
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new CliError(`--tools-file "${file}" is not valid JSON`)
  }
  if (!Array.isArray(data)) {
    throw new CliError(`--tools-file "${file}" must contain a JSON array of HttpToolDef`)
  }
  if (data.length === 0) {
    throw new CliError(`--tools-file "${file}" is an empty array; at least one tool is required`)
  }
  return data.map((t, i) => validateToolDef(t, i))
}
