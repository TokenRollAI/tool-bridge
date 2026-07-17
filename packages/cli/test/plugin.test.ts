import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetFetch, setFetch } from '../src/http'
import { runCli } from './cliHarness'

/** gw 三件套:每条命令都要带的目标与输出开关(经真实 commander 解析)。 */
const gw = ['--base-url', 'https://gw', '--sk', 'tbk_admin'] as const

const manifest = {
  id: 'notion-ctx',
  kind: 'context-provider',
  interfaceVersion: 'context-provider/v1',
  endpoint: 'https://plugin.example',
  auth: { kind: 'platform-token' },
  healthPath: '/healthz',
  enabled: true,
}

let tmp: string
let stdoutSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tb-plugin-'))
  process.exitCode = 0
  // biome-ignore lint/suspicious/noExplicitAny: spyOn 重载推断,与 commands.test.ts 同法。
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true) as any
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
  process.exitCode = 0
  resetFetch()
  vi.restoreAllMocks()
})

function stdoutText(): string {
  return stdoutSpy.mock.calls.map(c => String(c[0])).join('')
}

function jsonFetch(body: unknown, status = 200) {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )
  setFetch(fn as unknown as typeof fetch)
  return fn
}

/** 临时把 process.stdin 换成给定内容的可读流(测 `--file -`)。 */
function withStdin(content: string): () => void {
  const original = process.stdin
  Object.defineProperty(process, 'stdin', {
    value: Readable.from([Buffer.from(content, 'utf8')]),
    configurable: true,
  })
  return () => {
    Object.defineProperty(process, 'stdin', { value: original, configurable: true })
  }
}

describe('tb plugin register', () => {
  it('--file <path>:读文件 → system/plugin write,--json 原样输出 PluginRegistration', async () => {
    const file = join(tmp, 'manifest.json')
    writeFileSync(file, JSON.stringify(manifest))
    const fn = jsonFetch({ ...manifest, pluginToken: 'tbk_plugin_once' })

    await runCli(['plugin', 'register', ...gw, '--json', '--file', file])

    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/system/plugin')
    const payload = JSON.parse(init.body as string)
    expect(payload.tool).toBe('write')
    expect(payload.arguments).toEqual(manifest)
    expect(process.exitCode).toBe(0)
    expect(JSON.parse(stdoutText())).toEqual({ ...manifest, pluginToken: 'tbk_plugin_once' })
  })

  it('--file -:从 stdin 读 manifest', async () => {
    const restore = withStdin(JSON.stringify(manifest))
    try {
      const fn = jsonFetch(manifest)
      await runCli(['plugin', 'register', ...gw, '--json', '--file', '-'])
      const [, init] = fn.mock.calls[0] as [string, RequestInit]
      expect(JSON.parse(init.body as string).arguments).toEqual(manifest)
      expect(process.exitCode).toBe(0)
    } finally {
      restore()
    }
  })

  it('人类模式:pluginToken 存在时醒目提示"仅此一次"', async () => {
    const file = join(tmp, 'manifest.json')
    writeFileSync(file, JSON.stringify(manifest))
    jsonFetch({ ...manifest, pluginToken: 'tbk_plugin_once' })

    await runCli(['plugin', 'register', ...gw, '--file', file])

    const out = stdoutText()
    expect(out).toContain('registered plugin: notion-ctx')
    expect(out).toContain('shown once')
    expect(out).toContain('tbk_plugin_once')
    expect(process.exitCode).toBe(0)
  })

  it('manifest 非法 JSON → 退出码 1,不发请求', async () => {
    const file = join(tmp, 'bad.json')
    writeFileSync(file, '{not json')
    const fn = jsonFetch({})
    await runCli(['plugin', 'register', ...gw, '--json', '--file', file])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
})

describe('tb plugin list', () => {
  it('--json 原样输出 Page;请求 tool=list', async () => {
    const fn = jsonFetch({ items: [manifest] })
    await runCli(['plugin', 'list', ...gw, '--json'])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/system/plugin')
    expect(JSON.parse(init.body as string).tool).toBe('list')
    expect(JSON.parse(stdoutText())).toEqual({ items: [manifest] })
    expect(process.exitCode).toBe(0)
  })

  it('人类模式:表格含 id/kind/endpoint/enabled', async () => {
    jsonFetch({ items: [manifest] })
    await runCli(['plugin', 'list', ...gw])
    const out = stdoutText()
    expect(out).toContain('notion-ctx')
    expect(out).toContain('context-provider')
    expect(out).toContain('https://plugin.example')
    expect(out).toContain('enabled')
    expect(process.exitCode).toBe(0)
  })
})

describe('tb plugin get', () => {
  it('请求 tool=get + id;--json 原样输出 manifest', async () => {
    const fn = jsonFetch(manifest)
    await runCli(['plugin', 'get', 'notion-ctx', ...gw, '--json'])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.tool).toBe('get')
    expect(payload.arguments).toEqual({ id: 'notion-ctx' })
    expect(JSON.parse(stdoutText())).toEqual(manifest)
    expect(process.exitCode).toBe(0)
  })
})

describe('tb plugin update', () => {
  it('--file <path>:读 patch → system/plugin update,--json 原样输出', async () => {
    const file = join(tmp, 'patch.json')
    writeFileSync(file, JSON.stringify({ enabled: false }))
    const fn = jsonFetch({ ...manifest, enabled: false })

    await runCli(['plugin', 'update', 'notion-ctx', ...gw, '--json', '--file', file])

    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/system/plugin')
    const payload = JSON.parse(init.body as string)
    expect(payload.tool).toBe('update')
    expect(payload.arguments).toEqual({ id: 'notion-ctx', patch: { enabled: false } })
    expect(JSON.parse(stdoutText())).toEqual({ ...manifest, enabled: false })
    expect(process.exitCode).toBe(0)
  })

  it('人类模式:auth 切到 platform-token 换发 token 时醒目提示"仅此一次"', async () => {
    const file = join(tmp, 'patch.json')
    writeFileSync(file, JSON.stringify({ auth: { kind: 'platform-token' } }))
    jsonFetch({ ...manifest, pluginToken: 'tbk_plugin_rotated' })

    await runCli(['plugin', 'update', 'notion-ctx', ...gw, '--file', file])

    const out = stdoutText()
    expect(out).toContain('updated plugin: notion-ctx')
    expect(out).toContain('shown once')
    expect(out).toContain('tbk_plugin_rotated')
    expect(process.exitCode).toBe(0)
  })

  it('patch 非法 JSON → 退出码 1,不发请求', async () => {
    const file = join(tmp, 'bad.json')
    writeFileSync(file, '{not json')
    const fn = jsonFetch({})
    await runCli(['plugin', 'update', 'notion-ctx', ...gw, '--json', '--file', file])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
})

describe('tb plugin health', () => {
  it('healthy → 输出 healthy/checkedAt,退出码 0', async () => {
    jsonFetch({ healthy: true, checkedAt: '2026-07-07T00:00:00Z' })
    await runCli(['plugin', 'health', 'notion-ctx', ...gw])
    const out = stdoutText()
    expect(out).toContain('healthy')
    expect(out).toContain('2026-07-07T00:00:00Z')
    expect(process.exitCode).toBe(0)
  })

  it('unhealthy → 退出码 1(--json 也一样)', async () => {
    jsonFetch({ healthy: false, checkedAt: '2026-07-07T00:00:00Z', consecutiveFailures: 3 })
    await runCli(['plugin', 'health', 'notion-ctx', ...gw, '--json'])
    expect(JSON.parse(stdoutText()).healthy).toBe(false)
    expect(process.exitCode).toBe(1)
  })
})

describe('tb plugin rm', () => {
  it('请求 tool=delete + id;人类模式回显 removed', async () => {
    const fn = jsonFetch({})
    await runCli(['plugin', 'rm', 'notion-ctx', ...gw])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.tool).toBe('delete')
    expect(payload.arguments).toEqual({ id: 'notion-ctx' })
    expect(stdoutText()).toContain('removed plugin: notion-ctx')
    expect(process.exitCode).toBe(0)
  })
})

describe('TBError 透出', () => {
  it('403 TBError → 退出码 1 + --json 保留 code', async () => {
    jsonFetch({ code: 'permission_denied', message: 'admin required', retryable: false }, 403)
    await runCli(['plugin', 'list', '--base-url', 'https://gw', '--sk', 'tbk_x', '--json'])
    const out = JSON.parse(stdoutText())
    expect(out.ok).toBe(false)
    expect(out.code).toBe('permission_denied')
    expect(process.exitCode).toBe(1)
  })
})
