/**
 * context 平台对象存储集成测试(fs-backed 'r2' provider 落点):四动词 + Delete 循环、
 * 重启持久、小阈值触发 $ref → /~ref 免 SK 中转下载。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { configFromEnv, createTbServer, type TbServer } from '../src'

const ADMIN_SK = 'tbk_server_test_admin_00000000'
const ENCRYPTION_KEY = '3ZwpbBkSrp3eT9ylcZedfN33yq9fJLlmeusH98qNbt8'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

function tmpDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-ctx-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

async function startServer(
  dataDir: string,
  extraEnv: Record<string, string> = {},
): Promise<{ server: TbServer; baseUrl: string }> {
  const config = configFromEnv({
    TB_PORT: '0',
    TB_HOST: '127.0.0.1',
    TB_DATA_DIR: dataDir,
    TB_BOOTSTRAP_ADMIN_SK: ADMIN_SK,
    TB_SECRET_ENCRYPTION_KEY: ENCRYPTION_KEY,
    ...extraEnv,
  })
  const server = createTbServer(config)
  const { port } = await server.start()
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

const admin = (extra: RequestInit = {}): RequestInit => ({
  ...extra,
  headers: { authorization: `Bearer ${ADMIN_SK}`, ...(extra.headers ?? {}) },
})

async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${baseUrl}/${path}`, {
    method: 'POST',
    ...init,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

async function mountNamespace(baseUrl: string, path: string): Promise<Response> {
  return postJson(
    baseUrl,
    `${path}/~register`,
    {
      path,
      kind: 'context',
      description: 'fs-backed namespace',
      config: { kind: 'context', provider: 'r2' },
    },
    admin(),
  )
}

async function ctxCall(
  baseUrl: string,
  path: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<Response> {
  return postJson(baseUrl, path, { tool, arguments: args }, admin())
}

describe('context 平台对象存储(fs-backed)', () => {
  it('~register 挂载 → Write→List→Get→Update→Delete 全循环', async () => {
    const { server, baseUrl } = await startServer(tmpDataDir())
    cleanups.push(() => server.close())
    expect((await mountNamespace(baseUrl, 'ctxtest/rw')).status).toBe(200)

    const w = await ctxCall(baseUrl, 'ctxtest/rw', 'Write', {
      path: 'notes/a.md',
      entry: { contentType: 'text/markdown', content: '# hi node' },
    })
    expect(w.status).toBe(200)
    const wrote = (await w.json()) as { uri: string; version: string }
    expect(wrote.uri).toBe('node://ctxtest/rw/notes/a.md')

    const l = await ctxCall(baseUrl, 'ctxtest/rw', 'List', {})
    expect(l.status).toBe(200)
    const listed = (await l.json()) as { items: Array<{ uri: string; contentType: string }> }
    const dir = listed.items.find((i) => i.uri === 'node://ctxtest/rw/notes/')
    expect(dir?.contentType).toBe('application/x-directory')

    const g = await ctxCall(baseUrl, 'ctxtest/rw', 'Get', { path: 'notes/a.md' })
    expect(g.status).toBe(200)
    expect(((await g.json()) as { content: unknown }).content).toBe('# hi node')

    const u = await ctxCall(baseUrl, 'ctxtest/rw', 'Update', {
      path: 'notes/a.md',
      patch: { content: '# hi node v2' },
    })
    expect(u.status).toBe(200)
    expect(((await u.json()) as { version: string }).version).not.toBe(wrote.version)

    expect((await ctxCall(baseUrl, 'ctxtest/rw', 'Delete', { path: 'notes/a.md' })).status).toBe(
      200,
    )
    expect((await ctxCall(baseUrl, 'ctxtest/rw', 'Get', { path: 'notes/a.md' })).status).toBe(404)
  })

  it('对象随 /data 卷持久:重启后 Get 仍读到内容', async () => {
    const dataDir = tmpDataDir()
    const first = await startServer(dataDir)
    expect((await mountNamespace(first.baseUrl, 'ctxtest/persist')).status).toBe(200)
    const w = await ctxCall(first.baseUrl, 'ctxtest/persist', 'Write', {
      path: 'keep.txt',
      entry: { contentType: 'text/plain', content: 'survive restart' },
    })
    expect(w.status).toBe(200)
    await first.server.close()

    const second = await startServer(dataDir)
    cleanups.push(() => second.server.close())
    const g = await ctxCall(second.baseUrl, 'ctxtest/persist', 'Get', { path: 'keep.txt' })
    expect(g.status).toBe(200)
    expect(((await g.json()) as { content: unknown }).content).toBe('survive restart')
  })

  it('超阈值大对象 → content.$ref 走 /~ref 免 SK 中转,内容一致', async () => {
    const { server, baseUrl } = await startServer(tmpDataDir(), {
      TB_REF_THRESHOLD_BYTES: '16',
    })
    cleanups.push(() => server.close())
    expect((await mountNamespace(baseUrl, 'ctxtest/big')).status).toBe(200)

    const bigContent = 'x'.repeat(64)
    const w = await ctxCall(baseUrl, 'ctxtest/big', 'Write', {
      path: 'big.txt',
      entry: { contentType: 'text/plain', content: bigContent },
    })
    expect(w.status).toBe(200)

    const g = await ctxCall(baseUrl, 'ctxtest/big', 'Get', { path: 'big.txt' })
    expect(g.status).toBe(200)
    const entry = (await g.json()) as { content: { $ref?: string } }
    const refUrl = entry.content.$ref ?? ''
    expect(refUrl).toContain('/~ref/')

    // 中转下载免 SK(token 即凭证)。
    const download = await fetch(refUrl)
    expect(download.status).toBe(200)
    expect(await download.text()).toBe(bigContent)
  })
})
