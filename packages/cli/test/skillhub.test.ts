import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetFetch, setFetch } from '../src/http'
import { runCli } from './cliHarness'

/** 捕获请求并按 body 应答;返回 mock 以断言 URL/body。 */
function captureFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
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

function stdoutText(): string {
  const stdout = process.stdout.write as unknown as ReturnType<typeof vi.fn>
  return stdout.mock.calls.map(c => String(c[0])).join('')
}

const gw = ['--base-url', 'https://gw', '--sk', 'tbk_x']

beforeEach(() => {
  process.exitCode = 0
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
  process.exitCode = 0
  resetFetch()
  vi.restoreAllMocks()
})

describe('tb skill ls', () => {
  it('无分页 → List{},不带 opts', async () => {
    const fn = captureFetch({ items: [] })
    await runCli(['skill', 'ls', 'skills/team', ...gw, '--json'])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/skills/team')
    expect(JSON.parse(init.body as string)).toEqual({ tool: 'List', arguments: {} })
    expect(process.exitCode).toBe(0)
  })

  it('--limit/--cursor → opts 整体传', async () => {
    const fn = captureFetch({ items: [] })
    await runCli(['skill', 'ls', 'skills/team', '--limit', '5', '--cursor', 'c1', ...gw, '--json'])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      tool: 'List',
      arguments: { opts: { limit: 5, cursor: 'c1' } },
    })
  })
})

describe('tb skill get', () => {
  it('无 --file → Get{id}', async () => {
    const fn = captureFetch({ id: 'pdf', name: 'pdf', description: 'd', content: '# x', files: [] })
    await runCli(['skill', 'get', 'skills/team', 'pdf', ...gw, '--json'])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/skills/team')
    expect(JSON.parse(init.body as string)).toEqual({ tool: 'Get', arguments: { id: 'pdf' } })
  })

  it('--file → Get{id,file}', async () => {
    const fn = captureFetch({
      path: 'scripts/a.py',
      contentType: 'text/x-python',
      version: 'v1',
      content: 'x',
    })
    await runCli(['skill', 'get', 'skills/team', 'pdf', '--file', 'scripts/a.py', ...gw, '--json'])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      tool: 'Get',
      arguments: { id: 'pdf', file: 'scripts/a.py' },
    })
  })
})

describe('tb skill search', () => {
  it('→ Search{query}', async () => {
    const fn = captureFetch({ items: [] })
    await runCli(['skill', 'search', 'skills/team', 'pdf', ...gw, '--json'])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ tool: 'Search', arguments: { query: 'pdf' } })
  })
})

describe('tb skill rm', () => {
  it('→ Remove{id}', async () => {
    const fn = captureFetch({})
    await runCli(['skill', 'rm', 'skills/team', 'pdf', ...gw, '--json'])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/skills/team')
    expect(JSON.parse(init.body as string)).toEqual({ tool: 'Remove', arguments: { id: 'pdf' } })
  })
})

describe('tb skill publish', () => {
  it('遍历目录 → Publish{files},含 SKILL.md', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tb-skill-'))
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: demo\ndescription: d\n---\nbody\n')
    mkdirSync(join(dir, 'scripts'))
    writeFileSync(join(dir, 'scripts', 'run.sh'), 'echo hi\n')

    const fn = captureFetch({ id: 'demo', name: 'demo', description: 'd', fileCount: 2 })
    await runCli(['skill', 'publish', 'skills/team', dir, ...gw, '--json'])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/skills/team')
    const body = JSON.parse(init.body as string) as {
      arguments: { files: { content: string, path: string }[] }
      tool: string
    }
    expect(body.tool).toBe('Publish')
    const paths = body.arguments.files.map(f => f.path).sort()
    expect(paths).toEqual(['SKILL.md', 'scripts/run.sh'])
    expect(process.exitCode).toBe(0)
  })

  it('目录缺 SKILL.md → 报错,不发请求', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tb-skill-'))
    writeFileSync(join(dir, 'readme.md'), '# no skill\n')
    const fn = captureFetch({})
    await runCli(['skill', 'publish', 'skills/team', dir, ...gw, '--json'])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(stdoutText()).toContain('SKILL.md')
  })
})

describe('tb skill mount', () => {
  it('默认 provider r2 → ~register kind skillhub', async () => {
    const fn = captureFetch({ path: 'skills/team', kind: 'skillhub' })
    await runCli(['skill', 'mount', 'skills/team', '--description', 'team skills', ...gw, '--json'])
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gw/skills/team/~register')
    expect(JSON.parse(init.body as string)).toEqual({
      path: 'skills/team',
      kind: 'skillhub',
      description: 'team skills',
      config: { kind: 'skillhub', provider: 'r2' },
    })
  })

  it('无 --description → 派生非空 description(网关拒空串)', async () => {
    const fn = captureFetch({ path: 'skills/team', kind: 'skillhub' })
    await runCli(['skill', 'mount', 'skills/team', ...gw, '--json'])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { description: string }
    expect(body.description).toBe('skillhub at skills/team')
    expect(body.description.length).toBeGreaterThan(0)
  })

  it('--provider s3 缺 --endpoint → 报错', async () => {
    const fn = captureFetch({})
    await runCli(['skill', 'mount', 'skills/team', '--provider', 's3', ...gw, '--json'])
    expect(fn).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(stdoutText()).toContain('--endpoint')
  })

  it('--provider s3 齐参 → providerConfig + authRef', async () => {
    const fn = captureFetch({ path: 'skills/team', kind: 'skillhub' })
    await runCli([
      'skill',
      'mount',
      'skills/team',
      '--provider',
      's3',
      '--endpoint',
      'https://s3.example.com',
      '--bucket',
      'b',
      '--auth-ref',
      'cred',
      ...gw,
      '--json',
    ])
    const [, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      path: 'skills/team',
      kind: 'skillhub',
      description: 'skillhub at skills/team',
      config: {
        kind: 'skillhub',
        provider: 's3',
        providerConfig: { endpoint: 'https://s3.example.com', bucket: 'b' },
        authRef: 'cred',
      },
    })
  })
})

describe('tb skill unmount', () => {
  it('kind 校验通过 → system/registry delete', async () => {
    const fn = captureFetch({ path: 'skills/team', kind: 'skillhub' })
    await runCli(['skill', 'unmount', 'skills/team', ...gw, '--json'])
    // 第一次 get 校验 kind,第二次 delete。
    const first = fn.mock.calls[0] as [string, RequestInit]
    const second = fn.mock.calls[1] as [string, RequestInit]
    expect(first[0]).toBe('https://gw/system/registry')
    expect(JSON.parse(first[1].body as string)).toEqual({
      tool: 'get',
      arguments: { path: 'skills/team' },
    })
    expect(JSON.parse(second[1].body as string)).toEqual({
      tool: 'delete',
      arguments: { path: 'skills/team' },
    })
  })
})
