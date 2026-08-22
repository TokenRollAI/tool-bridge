/**
 * `/~mcp`:把 HTBP 树无状态投影成一个 MCP server。
 *
 * 每次请求现算工具清单(控制面三工具 + 树上可见节点的命令/工具),因此不存在
 * isolate 本地会话状态——鉴权始终是当次请求的 Bearer 身份。调用一律回灌到本 app
 * 自己的 HTTP 面(或直连 Provider),协议行为与 Agent 直接 fetch 完全一致。
 */
import {
  type Action,
  check,
  DEFAULT_MAX_NODES,
  type HelpJson,
  MAX_TREE_DEPTH,
  NodeRegistryStore,
  resolveUpstreamTool,
  TBError,
  type ToolResult,
  type ToolSpec,
  type TreeNode,
  type TreePath,
  validatePath,
  virtualizeTools,
} from '@tool-bridge/core'
import type { RouteEnv } from './env'
import {
  canonicalRemotePath,
  remotePassthroughIfMatch,
  remotePathWithin,
  remoteProtocolError,
  remoteTreeChildren,
} from '../federation'
import {
  handleMcpRequest,
  type McpBridgeTool,
  type McpToolBridge,
  mcpToolIdentity,
} from '../mcpServer'
import { type AppContext, type TbHono, TOOL_CACHE_TTL_DEFAULT } from '../deps'
import { providerFor, upstreamTools } from '../toolNodes'
import { pruneExpiredContext } from '../contextNodes'
import { deviceToolMarker } from '../deviceNodes'
import { helpModelFor } from '../helpModel'
import { runHandler } from '../responses'

/** 单次 `/~mcp` 请求内允许的远端发现往返上限(联邦子树可能很深)。 */
const MCP_REMOTE_MAX_REQUESTS = 32

const mcpCommand = (
  nodePath: TreePath,
  nodeDescription: string,
  command: {
    confirm?: boolean
    effect?: string
    h?: string
    inputSchema?: unknown
    name: string
    path: string
    scope: Action
  },
): McpBridgeTool => {
  const modelPath = nodePath.replace(/^\/+|\/+$/g, '')
  const commandPath = command.path.replace(/^\/+|\/+$/g, '')
  // command.path 现在恒为完整命令路径(含叶子段);它必须落在节点子树内。
  if (!commandPath.startsWith(`${modelPath}/`)) {
    throw new TBError('internal', `command path '${command.path}' escapes node '${nodePath}'`)
  }
  const invokePath = `/${commandPath}`
  return {
    identity: mcpToolIdentity(invokePath, command.name),
    sourcePath: nodePath,
    toolName: command.name,
    invokePath,
    description: command.h ?? nodeDescription,
    ...(command.inputSchema !== undefined ? { inputSchema: command.inputSchema } : {}),
    ...(command.effect !== undefined ? { effect: command.effect } : {}),
    ...(command.confirm === true ? { confirm: true } : {}),
  }
}

const toolSpecCommand = (
  node: TreeNode,
  tool: ToolSpec,
  providerBacked = false,
): McpBridgeTool => {
  const invokePath = `/${node.path}/${tool.name}`
  return {
    identity: mcpToolIdentity(invokePath, tool.name),
    sourcePath: node.path,
    toolName: tool.name,
    invokePath,
    ...(providerBacked ? { providerBacked: true } : {}),
    description: tool.description ?? node.description,
    ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
    ...(tool.effect !== undefined ? { effect: tool.effect } : {}),
    ...(tool.confirm === true ? { confirm: true } : {}),
  }
}

/** Rebase a remote HelpJson command path onto its local federation mount. */
const remoteCommand = (
  localNodePath: TreePath,
  model: HelpJson,
  command: HelpJson['cmds'][number],
): McpBridgeTool => {
  const remoteNodePath = model.node.path.replace(/^\/+|\/+$/g, '')
  const remoteCommandPath = command.path.replace(/^\/+|\/+$/g, '')
  if (
    remoteCommandPath !== remoteNodePath
    && !remoteCommandPath.startsWith(`${remoteNodePath}/`)
  ) {
    throw new TBError('unavailable', 'remote ~help returned a command outside its node')
  }
  const suffix = remoteCommandPath.slice(remoteNodePath.length)
  // 完整命令路径 rebase 到本地联邦挂载点;命令是虚拟叶子,直连调用(无信封)。
  return mcpCommand(localNodePath, model.node.description, {
    ...command,
    path: `/${localNodePath}${suffix}`,
  })
}

/**
 * 当次请求的 MCP 投影桥:list 现算可见工具集,call 回灌本 app 的 HTTP 面(或直连 Provider)。
 *
 * `app` 必须是装配中的同一实例——回灌走 `app.request`,才能复用鉴权中间件与全部路由语义。
 */
function mcpBridgeFor(c: AppContext, env: RouteEnv, app: TbHono): McpToolBridge {
  const { builtinsOf, deps, globalSearchCapabilities } = env
  const ctx = c.get('ctx')
  const registry = new NodeRegistryStore(c.get('store'))
  let remoteRequests = 0

  const controlTools = (): McpBridgeTool[] => [
    ...(globalSearchCapabilities().includes('search')
      ? [{
          identity: JSON.stringify(['control', 'search']),
          sourcePath: '',
          toolName: 'Search',
          invokePath: '/~search',
          mcpName: 'tb_search',
          operation: 'search' as const,
          description: 'Search visible tools across the Tool Bridge tree.',
          effect: 'read',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              query: { type: 'string', minLength: 1 },
              mode: { type: 'string', enum: ['keyword', 'semantic'] },
              limit: { type: 'integer', minimum: 1, maximum: 200 },
              cursor: { type: 'string', minLength: 1 },
            },
            required: ['query'],
          },
        }]
      : []),
    {
      identity: JSON.stringify(['control', 'help']),
      sourcePath: '',
      toolName: 'Help',
      invokePath: '/~help',
      mcpName: 'tb_help',
      operation: 'help',
      description: 'Describe a visible Tool Bridge node or one of its tools.',
      effect: 'read',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          tool: { type: 'string', minLength: 1, pattern: '^[^/]+$' },
          format: { type: 'string', enum: ['json', 'markdown', 'dsl'] },
        },
      },
    },
    {
      identity: JSON.stringify(['control', 'list-nodes']),
      sourcePath: '',
      toolName: 'List',
      invokePath: '/~tree',
      mcpName: 'tb_list_nodes',
      operation: 'listNodes',
      description: 'List the visible Tool Bridge node tree from a path.',
      effect: 'read',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          depth: { type: 'integer', minimum: 0, maximum: MAX_TREE_DEPTH },
        },
      },
    },
  ]

  const takeRemoteRequest = (): void => {
    remoteRequests += 1
    if (remoteRequests > MCP_REMOTE_MAX_REQUESTS) {
      throw new TBError('unavailable', 'remote MCP discovery request budget exceeded', {
        retryable: false,
      })
    }
  }

  const remoteHelp = async (path: TreePath): Promise<HelpJson> => {
    takeRemoteRequest()
    const headers = new Headers(c.req.raw.headers)
    headers.set('accept', 'application/json')
    const response = await remotePassthroughIfMatch(
      c,
      ctx,
      registry,
      path,
      '~help',
      deps,
      headers,
    )
    if (response === null || !response.ok) {
      throw new TBError('unavailable', `remote ~help failed for '${path}'`, { retryable: true })
    }
    const model = (await response.json().catch(() => null)) as HelpJson | null
    if (model === null || !Array.isArray(model.cmds) || typeof model.node?.path !== 'string') {
      throw new TBError('unavailable', `remote ~help returned invalid JSON for '${path}'`)
    }
    const owner = await registry.resolve(path).catch(() => null)
    if (owner?.node.kind !== 'remote') {
      throw remoteProtocolError(`remote ~help path '${path}' lost its mount owner`)
    }
    const modelPath = canonicalRemotePath(model.node.path, true)
    if (modelPath !== owner.rest) {
      throw remoteProtocolError(`remote ~help path '${modelPath}' does not match request`)
    }
    for (const command of model.cmds) {
      if (!command.path.startsWith('/') || command.path.startsWith('//')) {
        throw remoteProtocolError(`remote ~help returned invalid command path '${command.path}'`)
      }
      const commandPath = canonicalRemotePath(command.path.slice(1), true)
      if (!remotePathWithin(modelPath, commandPath)) {
        throw remoteProtocolError(`remote ~help command '${command.path}' escapes its node`)
      }
    }
    return model
  }

  const remotePaths = async (root: TreePath): Promise<TreePath[]> => {
    const found: TreePath[] = []
    const seen = new Set<TreePath>()
    const pending: Array<{ depth: number, path: TreePath }> = [{ depth: 0, path: root }]
    while (pending.length > 0) {
      const current = pending.shift()
      if (current === undefined || seen.has(current.path)) continue
      const { depth, path } = current
      seen.add(path)
      if (!check(ctx, path, 'read').allow || !check(ctx, path, 'call').allow) continue
      const owner = await registry.resolve(path).catch(() => null)
      if (owner?.node.path !== root || owner.node.kind !== 'remote') continue
      if (found.length >= DEFAULT_MAX_NODES) {
        throw new TBError('unavailable', 'remote MCP discovery node budget exceeded', {
          retryable: false,
        })
      }
      found.push(path)
      takeRemoteRequest()
      const children = await remoteTreeChildren(c, ctx, registry, path, deps)
      if (children.length > 0 && depth >= MAX_TREE_DEPTH) {
        throw new TBError('unavailable', 'remote MCP discovery depth exceeded', {
          retryable: false,
        })
      }
      for (const child of children) {
        if (child.path.startsWith(`${root}/`) && !seen.has(child.path)) {
          pending.push({ path: child.path, depth: depth + 1 })
        }
      }
    }
    return found
  }

  const list = async (): Promise<McpBridgeTool[]> => {
    const now = new Date().toISOString()
    const nodes = await pruneExpiredContext(await registry.subtree(''), registry)
    const result: McpBridgeTool[] = controlTools()

    for (const node of nodes) {
      if (node.kind === 'directory') continue
      if (!check(ctx, node.path, 'read').allow) continue

      if (node.kind === 'remote') {
        for (const path of await remotePaths(node.path)) {
          const model = await remoteHelp(path)
          for (const command of model.cmds) {
            if (check(ctx, path, command.scope).allow) {
              let detailed = command
              if (command.inputSchema === undefined && command.path !== `/${model.node.path}`) {
                const remoteNodePath = model.node.path.replace(/^\/+|\/+$/g, '')
                const remoteCommandPath = command.path.replace(/^\/+|\/+$/g, '')
                const detailPath = `${path}${remoteCommandPath.slice(remoteNodePath.length)}`
                const detail = await remoteHelp(detailPath)
                detailed = detail.cmds.find(item => item.name === command.name) ?? command
              }
              result.push(remoteCommand(path, model, detailed))
            }
          }
        }
        continue
      }

      const marker = deviceToolMarker(node)
      if (marker !== null) {
        if (check(ctx, node.path, 'call').allow) {
          result.push(...(marker.cmds ?? []).map(tool => toolSpecCommand(node, tool)))
        }
        continue
      }

      if (
        (node.kind === 'mcp' || node.kind === 'http' || node.kind === 'tool')
        && node.config !== undefined
      ) {
        if (!check(ctx, node.path, 'call').allow) continue
        const provider = await providerFor(node, ctx, deps)
        const raw = await upstreamTools(node, provider, deps, false, now)
        const { exposed } = virtualizeTools(node.virtualize, raw)
        result.push(...exposed.map(tool => toolSpecCommand(node, tool, true)))
        continue
      }

      const model = await helpModelFor(node, registry, ctx, builtinsOf(c.get('store')), deps, {
        refresh: false,
        now,
      })
      for (const command of model.cmds) {
        if (check(ctx, node.path, command.scope).allow) {
          result.push(mcpCommand(node.path, node.description, command))
        }
      }
    }
    return result
  }

  return {
    list,
    call: async (tool, args) => {
      const resultFromResponse = async (response: Response): Promise<{
        content: unknown
        isError?: boolean
      }> => {
        const text = await response.text()
        let value: unknown = text
        try {
          value = JSON.parse(text) as unknown
        } catch {
          // Text help/DSL results remain MCP text content.
        }
        return { content: value, ...(response.ok ? {} : { isError: true }) }
      }
      if (tool.operation !== undefined) {
        const rawPath = args.path ?? ''
        if (typeof rawPath !== 'string') {
          throw new TBError('invalid_argument', 'path must be a string')
        }
        const path = rawPath.replace(/^\/+|\/+$/g, '')
        const pathError = validatePath(path, { allowRoot: true })
        if (pathError !== null) throw pathError
        const segments = path === '' ? [] : path.split('/')
        if (segments.some(segment => segment === '.' || segment === '..')) {
          throw new TBError('invalid_argument', 'path contains a dot segment')
        }
        const encoded = segments.map(segment => encodeURIComponent(segment))
        const headers = new Headers({
          authorization: c.req.header('authorization') ?? '',
        })

        if (tool.operation === 'search') {
          headers.set('accept', 'application/json')
          headers.set('content-type', 'application/json')
          const opts = Object.fromEntries(
            ['mode', 'limit', 'cursor']
              .filter(key => args[key] !== undefined)
              .map(key => [key, args[key]]),
          )
          const response = await app.request(new Request(new URL('/~search', c.req.url), {
            method: 'POST',
            headers,
            body: JSON.stringify({
              query: args.query,
              ...(Object.keys(opts).length === 0 ? {} : { opts }),
            }),
          }))
          return await resultFromResponse(response)
        }

        if (tool.operation === 'help') {
          const detail = args.tool
          if (detail !== undefined) {
            if (path === '' || typeof detail !== 'string' || detail.includes('/')) {
              throw new TBError('invalid_argument', 'tool detail requires a node path and one segment')
            }
            encoded.push(encodeURIComponent(detail))
          }
          const format = args.format ?? 'json'
          headers.set('accept', format === 'json'
            ? 'application/json'
            : format === 'dsl' ? 'text/plain' : 'text/markdown')
          const prefix = encoded.length === 0 ? '' : `/${encoded.join('/')}`
          return await resultFromResponse(await app.request(new Request(
            new URL(`${prefix}/~help`, c.req.url),
            { headers },
          )))
        }

        headers.set('accept', 'application/json')
        const prefix = encoded.length === 0 ? '' : `/${encoded.join('/')}`
        const url = new URL(`${prefix}/~tree`, c.req.url)
        if (args.depth !== undefined) url.searchParams.set('depth', String(args.depth))
        return await resultFromResponse(await app.request(new Request(url, { headers })))
      }
      if (tool.providerBacked === true) {
        let node: TreeNode
        try {
          node = await registry.get(tool.sourcePath)
        } catch {
          throw TBError.notFound('not found')
        }
        if (!check(ctx, node.path, 'read').allow) throw TBError.notFound('not found')
        if (!check(ctx, node.path, 'call').allow) {
          throw new TBError('permission_denied', `no scope grants 'call' on '${node.path}'`)
        }
        if (
          (node.kind !== 'mcp' && node.kind !== 'http' && node.kind !== 'tool')
          || node.config === undefined
        ) {
          throw TBError.notFound('not found')
        }
        const provider = await providerFor(node, ctx, deps)
        const raw = await upstreamTools(node, provider, deps, false, new Date().toISOString())
        const upstreamName = resolveUpstreamTool(node.virtualize, raw, tool.toolName)
        const result: ToolResult = await provider.call(upstreamName, args)
        return {
          content: result.contentBlocks ?? result.content,
          ...(result.isError === true ? { isError: true } : {}),
          ...(result.structuredContent !== undefined
            ? { structuredContent: result.structuredContent }
            : {}),
        }
      }
      const url = new URL(tool.invokePath, c.req.url)
      const headers = new Headers({
        'accept': 'application/json',
        'authorization': c.req.header('authorization') ?? '',
        'content-type': 'application/json',
      })
      // 唯一调用形态:直连 `POST <invokePath>`(含命令/工具叶子段),body 即 arguments 本体。
      const response = await app.request(
        new Request(url, { method: 'POST', headers, body: JSON.stringify(args) }),
      )
      return await resultFromResponse(response)
    },
  }
}

// MCP is an HTBP reserved control segment. Stateless serving keeps every request behind
// the gateway's current Bearer identity instead of trusting isolate-local session state.
// tools/list advertises the same freshness window the gateway's own upstream tool cache
// already serves from, so client-side caching adds no staleness class we don't already have.
export function registerMcpRoute(app: TbHono, env: RouteEnv): void {
  app.all('/~mcp', c =>
    runHandler(async () => await handleMcpRequest(
      c.req.raw,
      env.deps.version,
      mcpBridgeFor(c, env, app),
      (env.deps.toolCacheTtlSec ?? TOOL_CACHE_TTL_DEFAULT) * 1000,
    )))
}
