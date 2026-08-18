import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ProcessError,
  type ProcessOptions,
  type ProcessResult,
  type ProcessRunner,
  runCloudflareInit,
} from '../src/cloudflareInit'
import { readConfig, writeConfig } from '../src/config'
import { resetFetch, setFetch } from '../src/http'

const root = join(import.meta.dirname, '..', '..', '..')
const originalXdg = process.env.XDG_CONFIG_HOME
const originalAccount = process.env.CLOUDFLARE_ACCOUNT_ID
let configHome: string

beforeEach(() => {
  configHome = mkdtempSync(join(tmpdir(), 'tb-init-test-'))
  process.env.XDG_CONFIG_HOME = configHome
  delete process.env.CLOUDFLARE_ACCOUNT_ID
})

afterEach(() => {
  resetFetch()
  vi.restoreAllMocks()
  rmSync(configHome, { force: true, recursive: true })
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = originalXdg
  if (originalAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID
  else process.env.CLOUDFLARE_ACCOUNT_ID = originalAccount
})

function result(stdout = '', stderr = ''): ProcessResult {
  return { stdout, stderr }
}

function command(args: string[]): string {
  return args.join(' ')
}

describe('tb init cloudflare orchestration', () => {
  it('fresh Worker: secrets 仅写入 0600 文件，部署后保存并验证 profile', async () => {
    const calls: Array<{ args: string[], options: ProcessOptions }> = []
    let secretFile = ''
    const runner: ProcessRunner = async (_executable, args, options) => {
      calls.push({ args, options })
      const invoked = command(args)
      if (invoked === 'exec wrangler whoami --json') {
        return result(JSON.stringify({ accounts: [{ id: 'acct-1', name: 'Personal' }] }))
      }
      if (invoked.includes('wrangler secret list')) {
        throw new ProcessError('pnpm', args, result('', 'Worker \'tb-gateway\' not found'))
      }
      if (invoked === 'provision') {
        const path = options.env!.TB_PROVISION_ENV_FILE!
        expect(statSync(path).mode & 0o777).toBe(0o600)
        expect(statSync(dirname(path)).mode & 0o777).toBe(0o700)
      }
      if (invoked.includes('wrangler deploy')) {
        const secretIndex = args.indexOf('--secrets-file')
        expect(secretIndex).toBeGreaterThan(0)
        const path = args[secretIndex + 1]!
        expect(statSync(path).mode & 0o777).toBe(0o600)
        secretFile = readFileSync(path, 'utf8')
        return result('Uploaded tb-gateway\nhttps://tb-gateway.user.workers.dev')
      }
      return result()
    }
    const verify = vi.fn(async () => {})

    const deployed = await runCloudflareInit(
      { repo: root, yes: true, profile: 'cloudflare' },
      { interactive: false, run: runner, verify },
    )

    expect(deployed.fresh).toBe(true)
    expect(deployed.baseUrl).toBe('https://tb-gateway.user.workers.dev')
    expect(deployed.adminSk).toMatch(/^tbk_[A-Za-z0-9_-]{43}$/)
    expect(secretFile).toContain(`TB_BOOTSTRAP_ADMIN_SK=${deployed.adminSk}\n`)
    expect(secretFile).toMatch(/TB_SECRET_ENCRYPTION_KEY=[A-Za-z0-9_-]{43}\n/)
    expect(calls.flatMap(call => call.args)).not.toContain(deployed.adminSk)
    expect(verify).toHaveBeenCalledWith(deployed.baseUrl, deployed.adminSk, undefined, true)
    expect(readConfig()).toMatchObject({
      current: 'cloudflare',
      profiles: { cloudflare: { baseUrl: deployed.baseUrl, sk: deployed.adminSk } },
    })
  })

  it('existing Worker: 无本地 profile 时在 provision 前 fail closed', async () => {
    const calls: string[] = []
    const runner: ProcessRunner = async (_executable, args) => {
      calls.push(command(args))
      if (command(args) === 'exec wrangler whoami --json') {
        return result(JSON.stringify({ accounts: [{ id: 'acct-1', name: 'Personal' }] }))
      }
      if (command(args).includes('wrangler secret list')) return result('[]')
      throw new Error(`unexpected command: ${command(args)}`)
    }

    await expect(runCloudflareInit(
      { repo: root, yes: true },
      { interactive: false, run: runner, verify: async () => {} },
    )).rejects.toThrow(/Worker already exists.*tb login/)
    expect(calls).not.toContain('provision')
  })

  it('existing Worker: profile 鉴权失败时不执行任何外部写入', async () => {
    writeConfig({
      current: 'prod',
      profiles: { prod: { baseUrl: 'https://tb.example.com', sk: 'tbk_wrong' } },
    })
    setFetch(async () => new Response('unauthorized', { status: 401 }))
    const calls: string[] = []
    const runner: ProcessRunner = async (_executable, args) => {
      calls.push(command(args))
      if (command(args) === 'exec wrangler whoami --json') {
        return result(JSON.stringify({ accounts: [{ id: 'acct-1', name: 'Personal' }] }))
      }
      if (command(args).includes('wrangler secret list')) return result('[]')
      throw new Error(`unexpected command: ${command(args)}`)
    }

    await expect(runCloudflareInit(
      { repo: root, yes: true, profile: 'prod' },
      { interactive: false, run: runner },
    )).rejects.toThrow(/Admin SK was rejected/)
    expect(calls).not.toContain('provision')
  })

  it('existing Worker: 先验证 profile，保留 bootstrap secret，并复用自定义域', async () => {
    writeConfig({
      current: 'prod',
      profiles: { prod: { baseUrl: 'https://tb.example.com', sk: 'tbk_existing' } },
    })
    const calls: string[] = []
    let provisionEnv = ''
    let existingSecretFile = ''
    const runner: ProcessRunner = async (_executable, args, options) => {
      calls.push(command(args))
      const invoked = command(args)
      if (invoked === 'exec wrangler whoami --json') {
        return result(JSON.stringify({ accounts: [{ id: 'acct-1', name: 'Personal' }] }))
      }
      if (invoked.includes('wrangler secret list')) {
        return result(JSON.stringify([
          { name: 'TB_BOOTSTRAP_ADMIN_SK', type: 'secret_text' },
        ]))
      }
      if (invoked === 'provision') {
        provisionEnv = readFileSync(options.env!.TB_PROVISION_ENV_FILE!, 'utf8')
      }
      if (invoked.includes('wrangler deploy')) {
        const secretIndex = args.indexOf('--secrets-file')
        existingSecretFile = readFileSync(args[secretIndex + 1]!, 'utf8')
      }
      return result()
    }
    const verify = vi.fn(async () => {})

    const deployed = await runCloudflareInit(
      { repo: root, yes: true, profile: 'prod' },
      { interactive: false, run: runner, verify },
    )

    expect(deployed).toEqual({
      adminSk: undefined,
      baseUrl: 'https://tb.example.com',
      fresh: false,
      profile: 'prod',
    })
    expect(provisionEnv).toContain('TB_DOMAIN=tb.example.com\n')
    expect(existingSecretFile).toMatch(/^TB_SECRET_ENCRYPTION_KEY=[A-Za-z0-9_-]{43}\n$/)
    expect(existingSecretFile).not.toContain('TB_BOOTSTRAP_ADMIN_SK')
    expect(verify).toHaveBeenNthCalledWith(1, deployed.baseUrl, 'tbk_existing', undefined, false)
    expect(verify).toHaveBeenNthCalledWith(2, deployed.baseUrl, 'tbk_existing', undefined, false)
    expect(calls.indexOf('provision')).toBeGreaterThan(calls.findIndex(call => call.includes('secret list')))
  })

  it('non-interactive 多账户必须显式选择且不能开始部署', async () => {
    const runner: ProcessRunner = async () => result(JSON.stringify({
      accounts: [
        { id: 'acct-1', name: 'One' },
        { id: 'acct-2', name: 'Two' },
      ],
    }))

    await expect(runCloudflareInit(
      { repo: root, yes: true },
      { interactive: false, run: runner },
    )).rejects.toThrow(/multiple Cloudflare accounts.*--account-id/)
  })

  it('新 Worker 不接受没有 --domain 对应关系的任意 base URL', async () => {
    const calls: string[] = []
    const runner: ProcessRunner = async (_executable, args) => {
      calls.push(command(args))
      if (command(args) === 'exec wrangler whoami --json') {
        return result(JSON.stringify({ accounts: [{ id: 'acct-1', name: 'Personal' }] }))
      }
      if (command(args).includes('wrangler secret list')) {
        throw new ProcessError('pnpm', args, result('', 'Worker "tb-gateway" not found'))
      }
      throw new Error(`unexpected command: ${command(args)}`)
    }

    await expect(runCloudflareInit(
      { baseUrl: 'https://other.example.com', repo: root, yes: true },
      { interactive: false, run: runner },
    )).rejects.toThrow(/--base-url requires --domain/)
    expect(calls).not.toContain('provision')
  })
})
