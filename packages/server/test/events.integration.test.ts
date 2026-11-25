import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import postgres, { type Sql } from 'postgres'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createToolBridgeClient, type ToolBridgeClient } from '../../sdk/src/client'
import { createTbServer, type TbServer } from '../src/server'
import { PgEventRepository } from '../src/pgEventRepository'
import { testServerConfig } from './helpers/server'

const topic = 'project/builds'
const servers: TbServer[] = []
const dirs: string[] = []
const sk = 'tbk_test_event_admin_local_only'
let sql: Sql
let a: ToolBridgeClient
let b: ToolBridgeClient
let base: string

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tb-events-'))
  dirs.push(dir)
  const config = await testServerConfig({ adminSk: sk, dataDir: dir, redisUrl: process.env.TB_TEST_REDIS_URL })
  sql = postgres(config.databaseUrl!, { onnotice: () => {} })
  const clients = []
  for (const replicaId of ['events-a', 'events-b']) {
    const dataDir = await mkdtemp(join(tmpdir(), 'tb-event-replica-'))
    dirs.push(dataDir)
    const server = createTbServer({ ...config, replicaId, dataDir })
    servers.push(server)
    const { port } = await server.start()
    base = `http://127.0.0.1:${port}`
    clients.push(createToolBridgeClient({ baseUrl: base, sk }))
  }
  ;[a, b] = clients as [ToolBridgeClient, ToolBridgeClient]
  await a.events.create(topic)
})

afterAll(async () => {
  for (const server of servers.reverse()) await server.close()
  await sql?.end({ timeout: 2 })
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

describe('durable topic through two live gateway replicas', () => {
  it('exposes help and preserves an occupied path', async () => {
    await expect(a.events.create('project')).rejects.toMatchObject({ code: 'conflict' })
    expect((await b.getHelp('project')).node.kind).toBe('directory')
    expect((await a.getHelp(topic)).cmds).toEqual([
      expect.objectContaining({ path: `/${topic}/publish`, scope: 'write', effect: 'write' }),
      expect.objectContaining({ path: `/${topic}/read`, scope: 'read', effect: 'read' }),
    ])
    expect((await b.getHelp(`${topic}/publish`)).cmds[0]?.inputSchema).toBeDefined()
    await expect(b.events.publish('unknown/topic', { type: 'x', data: {} })).rejects.toMatchObject({ status: 404 })
  })

  it('delivers each commit to both readers and resumes across gateways, in order', async () => {
    const initial = await a.events.read(topic)
    const { secret } = await a.invokeJson<{ secret: string }>('system/sk/write', {
      owner: 'user:second-reader', scopes: [{ pattern: topic, actions: ['read'] }],
    })
    const reader = createToolBridgeClient({ baseUrl: base, sk: secret })
    const reads = [a, reader].map(client => client.events.read(topic, { after: initial.nextCursor, waitMs: 5000 }))
    await vi.waitFor(async () => expect((await sql`SELECT id FROM tb_event_waits`).length).toBe(2))
    const input = { type: 'build.finished', idempotencyKey: 'build-42', data: { a: 1, b: 2 } }
    const [receipt, replay] = await Promise.all([
      a.events.publish(topic, input), b.events.publish(topic, { ...input, data: { b: 2, a: 1 } }),
    ])
    expect(replay).toEqual(receipt)
    for (const page of await Promise.all(reads)) expect(page.events.map(e => e.id)).toEqual([receipt.id])
    await expect(b.events.publish(topic, { ...input, data: null })).rejects.toMatchObject({ code: 'conflict' })
    const receipts = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      (i % 2 ? a : b).events.publish(topic, { type: 'build', data: i })))
    const first = await b.events.read(topic, { after: receipt.cursor, limit: 3 })
    const rest = await a.events.read(topic, { after: first.nextCursor })
    const ids = [...first.events, ...rest.events].map(e => e.id)
    expect(new Set(ids)).toEqual(new Set(receipts.map(r => r.id)))
    const rows = await sql`SELECT id FROM tb_event_records WHERE seq>1 ORDER BY seq`
    expect(ids).toEqual(rows.map(r => r.id))
  })

  it('keeps a later publisher behind an uncommitted event on the same topic', async () => {
    const path = 'project/ordering'
    await a.events.create(path)
    const start = (await a.events.read(path)).nextCursor
    const key = 'node:' + path
    let pending: ReturnType<typeof b.events.publish> | undefined
    await sql.begin(async (tx) => {
      const [first] = await tx`UPDATE tb_event_topics SET head=head+1 WHERE node_key=${key} RETURNING head,generation`
      await tx`INSERT INTO tb_event_records(generation,seq,id,source,body)
        VALUES(${first!.generation},${first!.head},gen_random_uuid(),'fixture',${tx.json({ type: 'first', data: null, schemaVersion: 1 })})`
      pending = b.events.publish(path, { type: 'second', data: null })
      await vi.waitFor(async () => expect((await sql`SELECT 1 FROM pg_stat_activity
        WHERE wait_event_type='Lock' AND query LIKE '%SELECT generation,binding FROM tb_event_topics%FOR UPDATE%'`).length).toBeGreaterThan(0), { timeout: 5000 })
      expect((await a.events.read(path, { after: start })).events).toEqual([])
    })
    await pending
    expect((await b.events.read(path, { after: start })).events.map(e => e.type)).toEqual(['first', 'second'])
  })

  it('checks identity again before delivering to a reader and releases the shared lease', async () => {
    const { secret, key } = await a.invokeJson<{ key: { id: string }, secret: string }>('system/sk/write', {
      owner: 'user:viewer', scopes: [{ pattern: topic, actions: ['read'] }],
    })
    const viewer = createToolBridgeClient({ baseUrl: base, sk: secret })
    await expect(viewer.events.publish(topic, { type: 'test', data: null })).rejects.toMatchObject({ status: 403 })
    const pending = viewer.events.read(topic, { waitMs: 5000 }).catch((e: unknown) => e)
    await vi.waitFor(async () => expect((await sql`SELECT id FROM tb_event_waits WHERE actor=${key.id}`).length).toBe(1))
    await a.invokeJson('system/sk/update', { id: key.id, patch: { scopes: [] } })
    await a.events.publish(topic, { type: 'private', data: 'withheld' })
    expect(await pending).toMatchObject({ status: 404 })
    expect(await sql`SELECT id FROM tb_event_waits WHERE actor=${key.id}`).toHaveLength(0)
    await expect(viewer.events.read(topic)).rejects.toMatchObject({ status: 404 })
  })

  it('reports retention and generation gaps and scopes cursors to path and filter', async () => {
    const path = 'project/retention'
    await a.events.create(path)
    const { nextCursor } = await b.events.read(path, { type: 'done' })
    const payload = { type: 'done', data: true, idempotencyKey: 'once' }
    const receipt = await a.events.publish(path, payload)
    await sql`UPDATE tb_event_records SET recorded_at=now()-interval '25 hours' WHERE id=${receipt.id}`
    const gap = await b.events.read(path, { type: 'done', after: nextCursor })
    expect(gap.gap?.reason).toBe('retention')
    expect(await a.events.publish(path, payload)).toEqual(receipt)
    const live = await b.events.publish(path, { type: 'done', data: false })
    expect((await a.events.read(path, { type: 'done', after: gap.gap!.earliestCursor })).events[0]?.id).toBe(live.id)
    await expect(a.events.read(path, { after: nextCursor })).rejects.toMatchObject({ status: 400 })
    await expect(a.events.read(topic, { type: 'done', after: nextCursor })).rejects.toMatchObject({ status: 400 })
    await b.invokeJson('system/registry/delete', { path })
    await a.events.create(path)
    expect((await b.events.read(path, { type: 'done', after: nextCursor })).gap?.reason).toBe('generation')
    expect((await b.events.publish(path, payload)).id).not.toBe(receipt.id)
  })

  it('trims to the topic count budget while retaining the original receipt', async () => {
    const path = 'project/capacity'
    await a.events.create(path)
    const start = (await a.events.read(path)).nextCursor
    const payload = { type: 'seed', data: null, idempotencyKey: 'original' }
    const receipt = await b.events.publish(path, payload)
    await sql.begin(async (tx) => {
      const [row] = await tx`UPDATE tb_event_topics SET head=head+4095
        WHERE node_key=${'node:' + path} RETURNING generation,head`
      await tx`INSERT INTO tb_event_records(generation,seq,id,source,body)
        SELECT ${row!.generation},s,gen_random_uuid(),'fixture',${tx.json({ type: 'bulk', data: null, schemaVersion: 1 })}
        FROM generate_series(2,${row!.head}::bigint) s`
    })
    await a.events.publish(path, { type: 'trim', data: null })
    const [count] = await sql`SELECT count(*)::int AS n FROM tb_event_records r
      JOIN tb_event_topics t USING(generation) WHERE t.node_key=${'node:' + path}`
    expect(count?.n).toBe(4096)
    expect((await b.events.read(path, { after: start })).gap?.reason).toBe('retention')
    expect(await a.events.publish(path, payload)).toEqual(receipt)
  })

  it('fences verified webhook ingress across secret changes, including change-away-and-back', async () => {
    const path = 'project/webhook'
    const repo = new PgEventRepository(sql)
    await a.events.create(path)
    expect(await repo.binding(path)).toBeNull()
    const config = { kind: 'topic', provider: 'fixture', export: 'builds', authRef: 'hook-secret' }
    const bind = async (authRef: string) => {
      await sql`UPDATE tb_kv SET value=jsonb_set(value,'{config}',${sql.json({ ...config, authRef })}::jsonb) WHERE key=${'node:' + path}`
    }
    await bind(config.authRef)
    const original = (await repo.binding(path))!
    const payload = { type: 'build.finished', data: null, idempotencyKey: 'delivery' }
    const source = { owner: 'plugin:fixture', keyId: 'fixture:builds' }
    const receipt = await repo.publish(path, source, payload, original)
    await expect(a.events.publish(path, payload)).rejects.toMatchObject({ status: 403 })
    await bind('rotated-secret')
    await bind(config.authRef)
    const current = (await repo.binding(path))!
    expect(current.generation).not.toBe(original.generation)
    await expect(repo.publish(path, source, payload, original)).rejects.toMatchObject({ code: 'conflict' })
    expect((await repo.publish(path, source, payload, current)).id).not.toBe(receipt.id)
  })

  it('caps concurrent waits across replicas and releases slots on disconnect', async () => {
    const controller = new AbortController()
    const pending = Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? a : b).events.read(topic, { waitMs: 10_000 }, { signal: controller.signal }).catch(() => undefined))
    try {
      await vi.waitFor(async () => expect((await sql`SELECT id FROM tb_event_waits`).length).toBe(8))
      await expect(a.events.read(topic, { waitMs: 1 })).rejects.toMatchObject({ code: 'rate_limited' })
    } finally {
      controller.abort()
      await Promise.all(pending)
    }
    await vi.waitFor(async () => expect((await sql`SELECT id FROM tb_event_waits`).length).toBe(0), { timeout: 3000 })
  })
})
