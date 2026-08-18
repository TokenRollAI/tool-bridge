import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { cancel, confirm, isCancel, select, text } from '@clack/prompts'
import { dirname, join, resolve } from 'node:path'
import pRetry, { AbortError } from 'p-retry'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { readConfig, writeConfig } from './config'
import { apiFetch, CliError } from './http'

interface Account {
  id: string
  name: string
}

export interface CloudflareInitOptions {
  accountId?: string
  baseUrl?: string
  domain?: string
  json?: boolean
  namePrefix?: string
  profile?: string
  repo?: string
  sk?: string
  timeout?: string
  yes?: boolean
}

export interface ProcessOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  stdio?: 'capture' | 'inherit'
}

export interface ProcessResult {
  stderr: string
  stdout: string
}

export type ProcessRunner = (
  executable: string,
  args: string[],
  options: ProcessOptions,
) => Promise<ProcessResult>

export class ProcessError extends Error {
  readonly args: string[]
  readonly executable: string
  readonly stderr: string
  readonly stdout: string

  constructor(executable: string, args: string[], result: ProcessResult) {
    const detail = (result.stderr || result.stdout).trim()
    super(`command failed: ${executable} ${args.join(' ')}${detail ? `\n${detail}` : ''}`)
    this.name = 'ProcessError'
    this.executable = executable
    this.args = args
    this.stdout = result.stdout
    this.stderr = result.stderr
  }
}

/** 无 shell 启动子进程，secret 只以 0600 文件路径传给 Wrangler，不进入 argv/env。 */
export async function runProcess(
  executable: string,
  args: string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  return await new Promise((resolvePromise, reject) => {
    const inherited = options.stdio === 'inherit'
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: inherited ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    if (!inherited) {
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk)
      })
    }
    child.once('error', reject)
    child.once('close', (code) => {
      const result = { stdout, stderr }
      if (code === 0) resolvePromise(result)
      else reject(new ProcessError(executable, args, result))
    })
  })
}

interface InitDependencies {
  interactive?: boolean
  onStep?: (message: string) => void
  run?: ProcessRunner
  verify?: (baseUrl: string, sk: string, timeoutMs: number | undefined, fresh: boolean) => Promise<void>
}

export interface CloudflareInitResult {
  adminSk?: string
  baseUrl: string
  fresh: boolean
  profile: string
}

function isToolBridgeRoot(dir: string): boolean {
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) return false
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }
    return pkg.name === 'tool-bridge'
      && existsSync(join(dir, 'scripts', 'provision.mjs'))
      && existsSync(join(dir, 'packages', 'gateway', 'wrangler.jsonc'))
  } catch {
    return false
  }
}

/** 显式 --repo 必须自身是仓库；缺省则从 cwd 向上寻找，方便从 packages/* 内调用。 */
export function findRepoRoot(requested?: string): string {
  let candidate = resolve(requested ?? process.cwd())
  if (requested) {
    if (isToolBridgeRoot(candidate)) return candidate
    throw new CliError(`not a tool-bridge source checkout: ${candidate}`)
  }
  while (true) {
    if (isToolBridgeRoot(candidate)) return candidate
    const parent = dirname(candidate)
    if (parent === candidate) break
    candidate = parent
  }
  throw new CliError('run this command inside a tool-bridge source checkout, or pass --repo <path>')
}

function parseAccounts(stdout: string): Account[] {
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    throw new CliError('could not parse `wrangler whoami --json` output')
  }
  const raw = value && typeof value === 'object' && 'accounts' in value
    ? (value as { accounts?: unknown }).accounts
    : undefined
  if (!Array.isArray(raw)) throw new CliError('Wrangler returned no Cloudflare account list')
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const id = (item as { id?: unknown }).id
    const name = (item as { name?: unknown }).name
    return typeof id === 'string' && typeof name === 'string' ? [{ id, name }] : []
  })
}

function validatePrefix(value: string): string {
  const normalized = value.trim()
  if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(normalized)) {
    throw new CliError('--name-prefix must be 1-48 lowercase letters, digits, or hyphens')
  }
  return normalized
}

function normalizeDomain(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (trimmed.includes('://') || trimmed.includes('/') || trimmed.includes(':')) {
    throw new CliError('--domain must be a hostname without scheme, path, or port')
  }
  try {
    const url = new URL(`https://${trimmed}`)
    if (url.hostname !== trimmed.toLowerCase() || !url.hostname.includes('.')) throw new Error()
    return url.hostname
  } catch {
    throw new CliError(`invalid --domain hostname: ${trimmed}`)
  }
}

function normalizeBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CliError(`invalid base URL: ${value}`)
  }
  if (url.protocol !== 'https:') throw new CliError('Cloudflare base URL must use https')
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new CliError('base URL must be an origin without path, query, or fragment')
  }
  return url.origin
}

function parseTimeout(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86_400) {
    throw new CliError(`invalid --timeout "${value}": expected seconds in the range (0, 86400]`)
  }
  return Math.max(1, Math.round(seconds * 1000))
}

function generatedAdminSk(): string {
  return `tbk_${randomBytes(32).toString('base64url')}`
}

function generatedEncryptionKey(): string {
  return randomBytes(32).toString('base64url')
}

function dotenvLine(name: string, value: string): string {
  if (value.includes('\n') || value.includes('\r')) throw new CliError(`${name} must be one line`)
  return `${name}=${value}\n`
}

function isMissingWorker(error: unknown): boolean {
  if (!(error instanceof ProcessError)) return false
  return /couldn't find a Worker|Worker .+ not found|does not exist/i.test(`${error.stderr}\n${error.stdout}`)
}

function parseSecretNames(stdout: string): Set<string> {
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    throw new CliError('could not parse `wrangler secret list --format json` output')
  }
  if (!Array.isArray(value)) throw new CliError('Wrangler returned an invalid secret list')
  return new Set(value.flatMap((item) => {
    const name = item && typeof item === 'object' ? (item as { name?: unknown }).name : undefined
    return typeof name === 'string' ? [name] : []
  }))
}

function parseWorkersDevUrl(output: string): string | undefined {
  // URL 字符白名单会自然停在 Wrangler 的 ANSI 控制序列前，不需要自行实现 ANSI parser。
  const urls = output.match(/https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/g) ?? []
  const value = urls.find(url => /\.workers\.dev(?:[/?#]|$)/.test(url))
  return value ? normalizeBaseUrl(value.replace(/[),.;]+$/, '')) : undefined
}

async function defaultVerify(
  baseUrl: string,
  sk: string,
  timeoutMs: number | undefined,
  fresh: boolean,
): Promise<void> {
  await pRetry(async () => {
    const response = await apiFetch({ baseUrl, sk, timeoutMs }, { path: '/~help', accept: 'text' })
    if (response.ok) return
    if (response.status === 401) {
      throw new AbortError(new CliError('Admin SK was rejected by the gateway (401)'))
    }
    if (response.status < 500) {
      throw new AbortError(new CliError(`gateway verification returned HTTP ${response.status}`))
    }
    throw new CliError(`gateway verification returned HTTP ${response.status}`, 'unavailable', true)
  }, {
    retries: fresh ? 5 : 0,
    factor: 2,
    minTimeout: 500,
    maxTimeout: 4_000,
    maxRetryTime: 20_000,
  })
}

async function chooseAccount(
  accounts: Account[],
  explicit: string | undefined,
  interactive: boolean,
): Promise<string> {
  if (explicit) {
    if (!accounts.some(account => account.id === explicit)) {
      throw new CliError(`Cloudflare account "${explicit}" is not available to the current Wrangler login`)
    }
    return explicit
  }
  if (accounts.length === 1) return accounts[0]!.id
  if (accounts.length === 0) throw new CliError('the current Wrangler login has no available account')
  if (!interactive) {
    throw new CliError('multiple Cloudflare accounts are available; pass --account-id in non-interactive mode')
  }
  const selected = await select({
    message: '选择要部署到的 Cloudflare 账户',
    options: accounts.map(account => ({ label: `${account.name} (${account.id})`, value: account.id })),
  })
  if (isCancel(selected)) {
    cancel('已取消 Cloudflare 初始化')
    throw new CliError('Cloudflare initialization cancelled')
  }
  return String(selected)
}

async function chooseFreshDomain(explicit: string | undefined, interactive: boolean): Promise<string | undefined> {
  if (explicit !== undefined) return normalizeDomain(explicit)
  if (!interactive) return undefined
  const selected = await text({
    message: '自定义域名（留空使用 workers.dev）',
    placeholder: 'tb.example.com',
    validate: (value) => {
      try {
        normalizeDomain(value)
      } catch (error) {
        return (error as Error).message
      }
    },
  })
  if (isCancel(selected)) {
    cancel('已取消 Cloudflare 初始化')
    throw new CliError('Cloudflare initialization cancelled')
  }
  return normalizeDomain(String(selected))
}

function inferExistingDomain(baseUrl: string): string | undefined {
  const host = new URL(baseUrl).hostname
  return host.endsWith('.workers.dev') ? undefined : host
}

function saveProfile(name: string, baseUrl: string, sk: string): void {
  const config = readConfig()
  config.profiles[name] = { baseUrl, sk }
  config.current = name
  writeConfig(config)
}

/**
 * 从源码 checkout 编排 Cloudflare 首次部署。既有 Worker 必须先通过本地 profile 鉴权，
 * 并且永不生成/覆盖它的 bootstrap Admin SK。
 */
export async function runCloudflareInit(
  opts: CloudflareInitOptions,
  dependencies: InitDependencies = {},
): Promise<CloudflareInitResult> {
  const root = findRepoRoot(opts.repo)
  const runner = dependencies.run ?? runProcess
  const verify = dependencies.verify ?? defaultVerify
  const step = dependencies.onStep ?? (() => {})
  const interactive = dependencies.interactive
    ?? Boolean(process.stdin.isTTY && process.stdout.isTTY && !opts.json)
  const profileName = String(opts.profile ?? 'default').trim()
  if (!profileName) throw new CliError('--profile must not be empty')
  if (opts.sk) {
    throw new CliError('do not pass Admin SK on the command line; init generates it or reuses --profile')
  }
  const prefix = validatePrefix(String(opts.namePrefix ?? 'tb'))
  const timeoutMs = parseTimeout(opts.timeout)
  const wranglerConfig = join(root, 'packages', 'gateway', 'wrangler.jsonc')
  const childEnv = { ...process.env }
  // 不让调用者 shell 中残留的 trust root 越过本轮显式 secrets-file。
  delete childEnv.TB_BOOTSTRAP_ADMIN_SK
  delete childEnv.TB_SECRET_ENCRYPTION_KEY

  step('检查 Wrangler 登录状态')
  let whoami: ProcessResult
  try {
    whoami = await runner('pnpm', ['exec', 'wrangler', 'whoami', '--json'], { cwd: root, env: childEnv })
  } catch (error) {
    if (!interactive) {
      throw new CliError(`Wrangler is not authenticated: ${(error as Error).message}`)
    }
    step('打开 Cloudflare OAuth 登录')
    await runner('pnpm', ['exec', 'wrangler', 'login'], {
      cwd: root,
      env: childEnv,
      stdio: 'inherit',
    })
    whoami = await runner('pnpm', ['exec', 'wrangler', 'whoami', '--json'], { cwd: root, env: childEnv })
  }
  const accountId = await chooseAccount(
    parseAccounts(whoami.stdout),
    opts.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID,
    interactive,
  )
  childEnv.CLOUDFLARE_ACCOUNT_ID = accountId

  step('检查同名 Worker 及其 secret 是否已经存在')
  let fresh = false
  let existingSecretNames = new Set<string>()
  try {
    const secrets = await runner(
      'pnpm',
      ['exec', 'wrangler', 'secret', 'list', '--format', 'json', '--config', wranglerConfig],
      { cwd: root, env: childEnv },
    )
    existingSecretNames = parseSecretNames(secrets.stdout)
  } catch (error) {
    if (isMissingWorker(error)) fresh = true
    else throw error
  }

  let domain: string | undefined
  let baseUrl: string | undefined
  let adminSk: string | undefined
  let existingSk: string | undefined
  let needsEncryptionKey = true
  if (fresh) {
    domain = await chooseFreshDomain(opts.domain, interactive && !opts.yes)
    if (domain) baseUrl = `https://${domain}`
    if (opts.baseUrl) {
      if (!domain) throw new CliError('--base-url requires --domain for a new Cloudflare Worker')
      const explicitBaseUrl = normalizeBaseUrl(opts.baseUrl)
      if (explicitBaseUrl !== baseUrl) {
        throw new CliError('--base-url must match https://<domain> when --domain is set')
      }
      baseUrl = explicitBaseUrl
    }
  } else {
    const profile = readConfig().profiles[profileName]
    if (!profile) {
      throw new CliError(
        `Worker already exists; run \`tb login --profile ${profileName}\` with its Admin SK before re-running init`,
      )
    }
    baseUrl = normalizeBaseUrl(profile.baseUrl)
    existingSk = profile.sk
    if (opts.baseUrl && normalizeBaseUrl(opts.baseUrl) !== baseUrl) {
      throw new CliError('--base-url does not match the saved profile for this existing Worker')
    }
    domain = opts.domain === undefined ? inferExistingDomain(baseUrl) : normalizeDomain(opts.domain)
    step('验证既有 Worker 的管理员 profile')
    await verify(baseUrl, existingSk, timeoutMs, false)
    needsEncryptionKey = !existingSecretNames.has('TB_SECRET_ENCRYPTION_KEY')
  }

  if (!opts.yes) {
    if (!interactive) throw new CliError('pass --yes to allow Cloudflare resource creation and deployment')
    const accepted = await confirm({
      message: fresh
        ? `将在账户 ${accountId} 创建资源并部署新 Worker，继续吗？`
        : `将在账户 ${accountId} 更新已验证的 Worker，继续吗？`,
      initialValue: false,
    })
    if (isCancel(accepted) || !accepted) {
      cancel('已取消 Cloudflare 初始化')
      throw new CliError('Cloudflare initialization cancelled')
    }
  }

  const temp = mkdtempSync(join(tmpdir(), 'tb-init-cloudflare-'))
  chmodSync(temp, 0o700)
  const provisionEnv = join(temp, 'provision.env')
  const secretEnv = join(temp, 'secrets.env')
  try {
    let provision = dotenvLine('CLOUDFLARE_ACCOUNT_ID', accountId)
    provision += dotenvLine('TB_NAME_PREFIX', prefix)
    if (domain) provision += dotenvLine('TB_DOMAIN', domain)
    if (baseUrl) provision += dotenvLine('TB_BASE_URL', baseUrl)
    writeFileSync(provisionEnv, provision, { mode: 0o600 })
    chmodSync(provisionEnv, 0o600)

    step('幂等创建 KV、R2、D1 并回填 Wrangler 配置')
    await runner('pnpm', ['provision'], {
      cwd: root,
      env: { ...childEnv, TB_PROVISION_ENV_FILE: provisionEnv },
    })
    step('构建 Dashboard')
    await runner('pnpm', ['--filter', '@tool-bridge/dashboard', 'build'], { cwd: root, env: childEnv })

    let secretFileRequired = false
    if (fresh) {
      adminSk = generatedAdminSk()
      let content = dotenvLine('TB_BOOTSTRAP_ADMIN_SK', adminSk)
      content += dotenvLine('TB_SECRET_ENCRYPTION_KEY', generatedEncryptionKey())
      writeFileSync(secretEnv, content, { mode: 0o600 })
      chmodSync(secretEnv, 0o600)
      secretFileRequired = true
    } else if (needsEncryptionKey) {
      writeFileSync(
        secretEnv,
        dotenvLine('TB_SECRET_ENCRYPTION_KEY', generatedEncryptionKey()),
        { mode: 0o600 },
      )
      chmodSync(secretEnv, 0o600)
      secretFileRequired = true
    }

    step(fresh ? '注入 secret 并部署 Gateway' : '部署 Gateway（保留既有 secret）')
    const deployArgs = ['exec', 'wrangler', 'deploy', '--config', wranglerConfig]
    if (secretFileRequired) deployArgs.push('--secrets-file', secretEnv)
    let deployed: ProcessResult
    try {
      deployed = await runner('pnpm', deployArgs, { cwd: root, env: childEnv })
    } catch (error) {
      if (adminSk) {
        throw new CliError(
          `${(error as Error).message}\nGenerated Admin SK (save it before retrying): ${adminSk}`,
        )
      }
      throw error
    }

    baseUrl ??= parseWorkersDevUrl(`${deployed.stdout}\n${deployed.stderr}`)
    if (!baseUrl) {
      const recovery = adminSk ? ` Generated Admin SK (save it): ${adminSk}` : ''
      throw new CliError(`deployment completed but its workers.dev URL could not be detected.${recovery}`)
    }
    if (fresh && adminSk) saveProfile(profileName, baseUrl, adminSk)

    step('等待 Gateway 就绪并验证 Admin SK')
    await verify(baseUrl, adminSk ?? existingSk!, timeoutMs, fresh)
    return { adminSk, baseUrl, fresh, profile: profileName }
  } finally {
    rmSync(temp, { force: true, recursive: true })
  }
}
