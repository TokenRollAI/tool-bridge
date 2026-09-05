/** Targeted MCP invocation, sharing the ordinary HTBP execution and authorization paths. */
import {
  canonicalizePath,
  check,
  NodeRegistryStore,
  resolveUpstreamTool,
  TBError,
  type ToolResult,
  validatePath,
  virtualizeTools,
} from '@tool-bridge/core'
import { helpJsonSchema } from '@tool-bridge/core/protocol'
import type { AppContext, TbHono } from './deps'
import type { RouteEnv } from './routes/env'
import { providerFor, upstreamTools } from './toolNodes'
import { validateMcpArguments } from './mcpServer'
import { deviceToolMarker } from './deviceNodes'
import { helpModelFor } from './helpModel'

/** Logical HTBP paths are encoded segment by segment, never accepted as URLs. */
export function mcpPath(path: string, allowRoot = false): string {
  const error = validatePath(path, { allowRoot })
  if (error !== null) throw error
  return canonicalizePath(path).split('/').map(encodeURIComponent).join('/')
}

export function mcpRequest(
  c: AppContext,
  app: TbHono,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  return Promise.resolve(app.request(new Request(new URL(path, c.req.url), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'authorization': c.req.header('authorization') ?? '',
      'accept': 'application/json',
      'content-type': 'application/json',
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: c.req.raw.signal,
  })))
}

export async function mcpResponse(response: Response): Promise<ToolResult> {
  const text = await response.text()
  let content: unknown = text
  try {
    content = JSON.parse(text) as unknown
  } catch {
    // Markdown/DSL and plain command results retain their text representation.
  }
  return { content, ...(response.ok ? {} : { isError: true }) }
}

interface TargetInput {
  args?: Record<string, unknown>
  delivery?: 'fallback' | 'mailbox' | 'realtime'
  idempotencyKey?: string
  path: string
  ttlSeconds?: number
}

export async function invokeMcpTarget(
  c: AppContext,
  env: RouteEnv,
  app: TbHono,
  input: TargetInput,
): Promise<ToolResult> {
  const encoded = mcpPath(input.path)
  const path = canonicalizePath(input.path)
  const args = { ...input.args }
  if (input.delivery !== undefined && Object.hasOwn(args, '~delivery')) {
    throw new TBError('invalid_argument', 'delivery and args.~delivery cannot both be provided')
  }
  const delivery = input.delivery ?? args['~delivery']
  delete args['~delivery']
  if (Object.keys(args).some(key => key.startsWith('~'))) {
    throw new TBError('invalid_argument', 'unknown invocation control in args')
  }
  if (delivery !== undefined && delivery !== 'realtime' && delivery !== 'mailbox' && delivery !== 'fallback') {
    throw new TBError('invalid_argument', 'delivery must be realtime, mailbox or fallback')
  }
  if ((input.ttlSeconds !== undefined || input.idempotencyKey !== undefined)
    && input.delivery !== 'mailbox' && input.delivery !== 'fallback') {
    throw new TBError('invalid_argument', 'ttlSeconds and idempotencyKey require mailbox or fallback delivery')
  }

  const { deps, searchSync } = env
  const ctx = c.get('ctx')
  const registry = new NodeRegistryStore(c.get('store'))
  const resolved = await registry.resolve(path).catch(() => null)
  if (resolved === null) throw TBError.notFound('not found')
  const { node, rest: command } = resolved

  // A remote owns the full remaining path. Request only that command's help, not its tree.
  if (node.kind === 'remote') {
    if (!check(ctx, path, 'read').allow) throw TBError.notFound('not found')
    if (!check(ctx, path, 'call').allow) {
      throw new TBError('permission_denied', `no scope grants 'call' on '${path}'`)
    }
    const response = await mcpRequest(c, app, `/${encoded}/~help`)
    if (!response.ok) return mcpResponse(response)
    const model = helpJsonSchema.safeParse(await response.json().catch(() => null))
    if (!model.success) throw new TBError('unavailable', 'remote command help returned invalid JSON')
    const selected = model.data.cmds.find(cmd => canonicalizePath(cmd.path) === path)
    if (selected === undefined) throw TBError.notFound('not found')
    validateMcpArguments(selected.inputSchema, args, path)
  } else {
    if (command === '' || command.includes('/') || !check(ctx, node.path, 'read').allow) {
      throw TBError.notFound('not found')
    }
    const marker = deviceToolMarker(node)
    if (marker === null && (node.kind === 'mcp' || node.kind === 'http' || node.kind === 'tool')) {
      if (!check(ctx, node.path, 'call').allow) {
        throw new TBError('permission_denied', `no scope grants 'call' on '${node.path}'`)
      }
      if (delivery !== undefined) {
        throw new TBError('invalid_argument', 'delivery is only supported by device-backed tool commands')
      }
      const provider = await providerFor(node, ctx, deps)
      const raw = await upstreamTools(node, provider, deps, false, new Date().toISOString(), searchSync)
      const selected = virtualizeTools(node.virtualize, raw).exposed.find(tool => tool.name === command)
      if (selected === undefined) throw TBError.notFound('not found')
      validateMcpArguments(selected.inputSchema, args, path)
      // Keep native MCP content blocks, structured output and business errors intact.
      return provider.call(resolveUpstreamTool(node.virtualize, raw, command), args)
    }
    if (marker !== null && marker.cmds === undefined) {
      // An omitted device command catalog permits known realtime paths in HTBP.
      // An explicitly empty catalog still means no commands; never invent a schema.
      if (!check(ctx, node.path, 'call').allow) {
        throw new TBError('permission_denied', `no scope grants 'call' on '${node.path}'`)
      }
    } else {
      const model = await helpModelFor(node, registry, ctx, env.builtinsOf(c.get('store')), deps, {
        includeDirectUpload: check(ctx, node.path, 'write').allow,
        now: new Date().toISOString(),
        refresh: false,
        schemas: true,
        searchSync,
      })
      const selected = model.cmds.find(cmd => canonicalizePath(cmd.path) === path)
      if (selected === undefined) throw TBError.notFound('not found')
      if (!check(ctx, node.path, selected.scope).allow) {
        throw new TBError('permission_denied', `no scope grants '${selected.scope}' on '${node.path}'`)
      }
      validateMcpArguments(selected.inputSchema, args, path)
    }
  }

  const query = input.ttlSeconds === undefined ? '' : `?ttlSeconds=${input.ttlSeconds}`
  const response = await mcpRequest(c, app, `/${encoded}${query}`, {
    ...args,
    ...(delivery === undefined ? {} : { '~delivery': delivery }),
  }, input.idempotencyKey === undefined ? undefined : { 'x-tb-idempotency-key': input.idempotencyKey })
  const result = await mcpResponse(response)
  if (delivery !== undefined && response.ok) {
    return {
      content: response.status === 202
        ? { delivery: 'mailbox', operation: result.content }
        : { delivery: 'realtime', result: result.content },
    }
  }
  return result
}
