import { spawn } from 'node:child_process'
import { Command } from 'commander'
import { collect, resolveTarget, withGlobalOpts } from '../args'
import { apiJson, CliError, requireTarget } from '../http'
import { guard, printJson, printLine } from '../output'
import { buildVirtualize, deleteNode, parseToolsFile, registerNode } from '../registry'
import type { NodeConfig, NodeInput } from '../types'

interface ToolMountOpts {
  json?: boolean
  baseUrl?: string
  sk?: string
  kind: string
  url?: string
  endpoint?: string
  toolsFile?: string
  auth?: string
  authRef?: string
  authHeader?: string
  authScheme?: string
  header: string[]
  description?: string
  prefix?: string
  rename: string[]
  hide: string[]
  describe: string[]
}

/** 可重复 `--header Name=value` → headers 对象;空数组返回 undefined(不塞空对象)。 */
function parseHeaderSpecs(specs: string[]): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  for (const spec of specs) {
    const idx = spec.indexOf('=')
    if (idx < 0) {
      throw new CliError(`invalid --header "${spec}": expected "Name=value"`)
    }
    const name = spec.slice(0, idx).trim()
    const value = spec.slice(idx + 1).trim()
    if (!name || !value) throw new CliError(`invalid --header "${spec}": empty name/value`)
    headers[name] = value
  }
  return Object.keys(headers).length ? headers : undefined
}

/**
 * `tb tool mount <path>` —— 挂载 mcp / http 工具源(NodeRegistry.Write via ~register)。
 * mcp:`--kind mcp --url <u> [--auth-ref name | --auth oauth] [--header k=v …]`(oauth 挂载后跑 `tb tool auth`)。
 * http:`--kind http --endpoint <u> --tools-file <json> [--auth-ref name]`。
 * 共用:`--auth-header/--auth-scheme`(凭证头名/前缀,空 scheme 原样注入)、`--description d`
 * 与虚拟化 `--prefix p / --rename from=to / --hide t / --describe from=text`。
 */
export function toolMountCommand(): Command {
  return withGlobalOpts(new Command('mount'))
    .description('Mount an mcp/http tool source')
    .argument('<path>', 'Tree path to mount at')
    .requiredOption('--kind <kind>', 'Source kind: mcp | http')
    .option('--url <url>', '[mcp] Streamable HTTP URL')
    .option('--endpoint <url>', '[http] base endpoint URL')
    .option('--tools-file <file>', '[http] JSON file of HttpToolDef[]')
    .option('--auth <mode>', "[mcp] 'oauth': gateway-managed OAuth (then run `tb tool auth`)")
    .option('--auth-ref <name>', 'SecretStore ref for upstream credential')
    .option('--auth-header <name>', 'header name for authRef credential')
    .option('--auth-scheme <scheme>', 'auth scheme; empty string sends the secret as-is')
    .option(
      '--header <name=value>',
      '[mcp] static plaintext request header (repeatable)',
      collect,
      [],
    )
    .option('--description <text>', 'One-line node description')
    .option('--prefix <p>', 'Virtualize: prefix added to tool names')
    .option('--rename <from=to>', 'Virtualize: rename "from=to" (repeatable)', collect, [])
    .option('--hide <name>', 'Virtualize: hide tool name (repeatable)', collect, [])
    .option(
      '--describe <from=text>',
      'Virtualize: override description "from=text" (repeatable)',
      collect,
      [],
    )
    .addHelpText(
      'after',
      `
Examples:
  tb tool mount docs/context7 --kind mcp --url https://mcp.context7.com/mcp
  tb tool mount jira --kind mcp --url https://mcp.example.com/mcp --auth-ref jira-token
  tb tool mount gh --kind mcp --url https://api.example.com/mcp --auth oauth   # then: tb tool auth gh
  tb tool mount weather --kind http --endpoint https://api.weather.com --tools-file tools.json`,
    )
    .action(async (pathArg: string, opts: ToolMountOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const path = String(pathArg ?? '').trim()
        if (!path) throw new CliError('tree path is required')
        const kind = String(opts.kind ?? '').trim()
        const authRef = opts.authRef ? String(opts.authRef) : undefined
        const authHeader =
          opts.authHeader !== undefined ? String(opts.authHeader).trim() : undefined
        const authScheme = opts.authScheme !== undefined ? String(opts.authScheme) : undefined

        let config: NodeConfig
        if (kind === 'mcp') {
          const url = String(opts.url ?? '').trim()
          if (!url) throw new CliError('--url is required for --kind mcp')
          const auth = opts.auth !== undefined ? String(opts.auth).trim() : undefined
          if (auth !== undefined && auth !== 'oauth') {
            throw new CliError(`invalid --auth "${auth}"; valid: oauth`)
          }
          if (auth === 'oauth' && authRef) {
            throw new CliError('--auth oauth and --auth-ref are mutually exclusive')
          }
          config = {
            kind: 'mcp',
            url,
            ...(authRef ? { authRef } : {}),
            ...(auth === 'oauth' ? { auth: 'oauth' as const } : {}),
            ...(authHeader ? { authHeader } : {}),
            ...(authScheme !== undefined ? { authScheme } : {}),
            ...(() => {
              const headers = parseHeaderSpecs(opts.header)
              return headers ? { headers } : {}
            })(),
          }
        } else if (kind === 'http') {
          if (opts.header.length > 0) {
            throw new CliError('--header is only supported for --kind mcp')
          }
          const endpoint = String(opts.endpoint ?? '').trim()
          if (!endpoint) throw new CliError('--endpoint is required for --kind http')
          const toolsFile = String(opts.toolsFile ?? '').trim()
          if (!toolsFile) throw new CliError('--tools-file is required for --kind http')
          const tools = parseToolsFile(toolsFile)
          config = {
            kind: 'http',
            endpoint,
            tools,
            ...(authRef ? { authRef } : {}),
            ...(authHeader ? { authHeader } : {}),
            ...(authScheme !== undefined ? { authScheme } : {}),
          }
        } else {
          throw new CliError(`invalid --kind "${kind}"; valid: mcp, http`)
        }

        const virtualize = buildVirtualize({
          prefix: opts.prefix,
          rename: opts.rename,
          hide: opts.hide,
          describe: opts.describe,
        })
        const input: NodeInput = {
          path,
          kind,
          description: opts.description ? String(opts.description) : '',
          config,
          ...(virtualize ? { virtualize } : {}),
        }

        const node = await registerNode(resolveTarget(opts), input)
        if (asJson) printJson(node)
        else {
          printLine(`mounted ${kind} node at ${path}`)
          if (kind === 'mcp' && (config as { auth?: string }).auth === 'oauth') {
            printLine(`next: run \`tb tool auth ${path}\` to authorize the upstream`)
          }
        }
      })
    })
}

/** `POST /<path>/~authorize` 的响应形状(gateway oauth.ts StartAuthorizationResult)。 */
interface AuthorizeResult {
  status: 'authorized' | 'redirect'
  authorizationUrl?: string
}

/** 尽力打开系统浏览器(失败静默——URL 已打印,用户可手动打开)。 */
function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref()
  } catch {
    // 打不开浏览器不算错:URL 已展示
  }
}

/** 上游 DCR 拒绝网关回调的典型报错(Bytebase 等严格上游)→ 提示改走 --local。 */
function isRedirectRejection(message: string): boolean {
  return /redirect/i.test(message)
}

/**
 * 本地回调通道(--local):127.0.0.1 起临时 server 接收 AS 回跳的 code+state,
 * 转交网关 `/~oauth/callback` 完成兑换(token 仍只落网关)。适配只放行 localhost
 * 回调的严格上游(如 Bytebase 的 DCR 白名单)。
 */
async function runLocalCallbackFlow(
  target: ReturnType<typeof resolveTarget>,
  path: string,
  open: boolean,
): Promise<void> {
  const { createServer } = await import('node:http')
  const { once } = await import('node:events')

  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const addr = server.address()
  if (addr === null || typeof addr === 'string') throw new CliError('failed to bind local port')
  const redirectUri = `http://127.0.0.1:${addr.port}/callback`

  try {
    const result = await apiJson<AuthorizeResult>(target, {
      method: 'POST',
      path: `${path}/~authorize`,
      body: { redirectUri },
    })
    if (result.status === 'authorized') {
      printLine(`already authorized: ${path}`)
      return
    }
    if (!result.authorizationUrl) throw new CliError('gateway returned no authorization URL')
    printLine('open this URL in a browser to authorize:')
    printLine(`  ${result.authorizationUrl}`)
    if (open) openBrowser(result.authorizationUrl)
    printLine('waiting for the browser callback…(Ctrl-C to abort)')

    // 等 AS 回跳本地;拿到 code+state 即向浏览器回执并关停。
    const { code, state } = await new Promise<{ code: string; state: string }>(
      (resolve, reject) => {
        server.on('request', (req, res) => {
          const u = new URL(req.url ?? '/', redirectUri)
          if (u.pathname !== '/callback') {
            res.writeHead(404).end()
            return
          }
          const err = u.searchParams.get('error')
          const code = u.searchParams.get('code')
          const state = u.searchParams.get('state')
          if (err !== null || code === null || state === null) {
            res
              .writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
              .end(`authorization failed: ${err ?? 'missing code/state'}`)
            reject(new CliError(`authorization failed: ${err ?? 'missing code/state'}`))
            return
          }
          res
            .writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
            .end('Authorization received. Finishing up — you can close this tab.')
          resolve({ code, state })
        })
      },
    )

    // code+state 转交网关 callback 兑换(与浏览器直达同一端点;state 自含校验)。
    const { baseUrl } = requireTarget(target)
    const cb = new URL('/~oauth/callback', baseUrl)
    cb.searchParams.set('code', code)
    cb.searchParams.set('state', state)
    const res = await fetch(cb)
    const text = await res.text()
    if (!res.ok) {
      const detail = /<p>([^<]+)<\/p>/.exec(text)?.[1] ?? `gateway returned HTTP ${res.status}`
      throw new CliError(`token exchange failed: ${detail}`)
    }
    printLine(`authorized: ${path}`)
  } finally {
    server.close()
  }
}

/**
 * `tb tool auth <path>` —— 为 auth:'oauth' 的 mcp 挂载发起网关托管 OAuth 授权。
 * 默认:授权回跳直达网关 `/~oauth/callback`,浏览器完成即结束。
 * `--local`:上游 DCR 只放行 localhost 回调时(如 Bytebase),本机起临时端口接收回跳,
 * code 由 CLI 转交网关兑换(token 仍不出网关)。
 */
export function toolAuthCommand(): Command {
  return withGlobalOpts(new Command('auth'))
    .description('Authorize an OAuth-backed mcp mount (gateway-managed flow)')
    .argument('<path>', 'Tree path of the mcp mount')
    .option('--no-open', 'Print the authorization URL without opening a browser')
    .option('--local', 'Use a localhost callback (for upstreams that only allow loopback URIs)')
    .action(
      async (
        pathArg: string,
        opts: { json?: boolean; baseUrl?: string; sk?: string; open?: boolean; local?: boolean },
      ) => {
        const asJson = Boolean(opts.json)
        await guard(asJson, async () => {
          const path = String(pathArg ?? '').trim()
          if (!path) throw new CliError('tree path is required')
          const target = resolveTarget(opts)
          if (opts.local) {
            if (asJson) throw new CliError('--local is interactive; --json is not supported')
            await runLocalCallbackFlow(target, path, opts.open !== false)
            return
          }
          let result: AuthorizeResult
          try {
            result = await apiJson<AuthorizeResult>(target, {
              method: 'POST',
              path: `${path}/~authorize`,
            })
          } catch (err) {
            // 严格上游拒网关回调(DCR redirect 白名单)→ 指引本地回调通道。
            if (err instanceof CliError && isRedirectRejection(err.message)) {
              throw new CliError(
                `${err.message}\nhint: this upstream only allows localhost callbacks — retry with: tb tool auth ${path} --local`,
              )
            }
            throw err
          }
          if (asJson) {
            printJson(result)
            return
          }
          if (result.status === 'authorized') {
            printLine(`already authorized: ${path}`)
            return
          }
          if (!result.authorizationUrl) throw new CliError('gateway returned no authorization URL')
          printLine('open this URL in a browser to authorize:')
          printLine(`  ${result.authorizationUrl}`)
          if (opts.open !== false) openBrowser(result.authorizationUrl)
        })
      },
    )
}

/** `tb tool rm <path>` —— 卸载节点(管理面 system/registry delete)。 */
export function toolRmCommand(): Command {
  return withGlobalOpts(new Command('rm'))
    .description('Unmount a tool node')
    .argument('<path>', 'Tree path to remove')
    .action(async (pathArg: string, opts: { json?: boolean; baseUrl?: string; sk?: string }) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const path = String(pathArg ?? '').trim()
        if (!path) throw new CliError('tree path is required')
        await deleteNode(resolveTarget(opts), path, ['mcp', 'http'])
        if (asJson) printJson({ ok: true, path })
        else printLine(`removed node: ${path}`)
      })
    })
}

export function toolCommand(): Command {
  return new Command('tool')
    .description('Mount/remove mcp & http tool sources')
    .addCommand(toolMountCommand())
    .addCommand(toolAuthCommand())
    .addCommand(toolRmCommand())
}
