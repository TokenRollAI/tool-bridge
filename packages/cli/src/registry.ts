import { readFileSync } from 'node:fs'
import { apiJson, CliError, callTool, type Target } from './http'
import { asArray } from './output'
import { nodePath } from './paths'
import type { HttpToolDef, Node, NodeInput, Virtualize } from './types'

/**
 * 挂载/卸载节点的共用逻辑(Proto §3.3)。CLI 统一走 `~register` 注册(受限 SK 亦可用),
 * 卸载走管理面 `system/registry` delete。
 */

/**
 * 走 `POST /<path>/~register` 注册节点(§1.1 / §3.3 两条注册通道)。
 * body = NodeInput,且 body.path 必须等于 URL path(§3.3 规范要求)。
 */
export async function registerNode(target: Target, input: NodeInput): Promise<Node> {
  return apiJson<Node>(target, {
    method: 'POST',
    path: nodePath('~register', input.path),
    body: input,
  })
}

/**
 * 卸载节点:无 `~unregister` 端点,delete 走管理面 `system/registry`(§3.3 管理通道)。
 * 调用者无 system 可见性时返回 404 → 补充可操作提示。
 */
export async function deleteNode(target: Target, path: string): Promise<void> {
  try {
    await callTool(target, '/system/registry', 'delete', { path })
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
 * 无任一字段时返回 undefined(不塞空对象)。rename 在 prefix 之前应用(§3.1)。
 */
export function buildVirtualize(args: {
  prefix?: unknown
  rename?: unknown
  hide?: unknown
}): Virtualize | undefined {
  const v: Virtualize = {}

  const prefix = args.prefix ? String(args.prefix) : undefined
  if (prefix) v.prefix = prefix

  const rename: Record<string, string> = {}
  for (const spec of asArray(args.rename)) {
    const idx = spec.indexOf('=')
    if (idx < 0) {
      throw new CliError(`invalid --rename "${spec}": expected "from=to" e.g. "old__name=new"`)
    }
    const from = spec.slice(0, idx).trim()
    const to = spec.slice(idx + 1).trim()
    if (!from || !to) throw new CliError(`invalid --rename "${spec}": empty from/to`)
    rename[from] = to
  }
  if (Object.keys(rename).length) v.rename = rename

  const hide = asArray(args.hide)
  if (hide.length) v.hide = hide

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
