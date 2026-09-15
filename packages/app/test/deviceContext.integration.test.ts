import { decodeDeviceFrame, type DeviceEnvironment, encodeDeviceFrame, type HelpJson, NodeRegistryStore } from '@tool-bridge/core'
import { helpJsonSchema, registryNodeSchema } from '@tool-bridge/core/protocol'
import { describe, expect, it } from 'vitest'
import { bearer, createTestApp, type TestApp } from './harness'
import { processDeviceHello } from '../src/deviceHello'
import { RemotePathProjector } from '../src/federation'
import { TEST_ADMIN_SK } from './fixtures'

const environment: DeviceEnvironment = {
  platform: 'linux', arch: 'arm64', runtime: 'node', runtimeVersion: '22.12.0', runtimeId: 'runtime-1',
}
const now = '2026-09-15T00:00:00.000Z'

async function hello(app: TestApp, report: DeviceEnvironment | undefined = environment): Promise<void> {
  const decoded = decodeDeviceFrame(encodeDeviceFrame({
    type: 'hello', deviceId: 'context-test', expose: {
      ...(report === undefined ? {} : { environment: report }),
      nodes: ['public', 'private'].map(path => ({ path, kind: 'tool', description: path, cmds: [{ name: 'read', effect: 'read' }] })),
    },
  }))
  if (decoded.type !== 'hello') throw new Error('expected hello')
  await processDeviceHello({ store: app.state, hello: decoded, deviceIdHint: decoded.deviceId, authorization: `Bearer ${TEST_ADMIN_SK}`, now })
}

async function post(app: TestApp, path: string, body: unknown): Promise<Response> {
  return await app.request(`https://tb.test/${path}`, bearer(TEST_ADMIN_SK, {
    method: 'POST', headers: { 'content-type': 'application/json', 'accept': 'application/json' }, body: JSON.stringify(body),
  }))
}

async function help(app: TestApp, sk = TEST_ADMIN_SK): Promise<HelpJson> {
  const response = await app.request('https://tb.test/device/context-test/~help', bearer(sk, { headers: { accept: 'application/json' } }))
  expect(response.status).toBe(200)
  return helpJsonSchema.parse(await response.json())
}

describe('device context hello → storage → authorized help representations', () => {
  it('keeps the hello snapshot across heartbeat/offline and filters children with current scopes', async () => {
    const app = await createTestApp()
    await hello(app)
    const registry = new NodeRegistryStore(app.state)
    const node = registryNodeSchema.parse(await registry.get('device/context-test'))
    expect(node.deviceEnvironment).toEqual(environment)
    expect(node.deviceReportedAt).toBe(now)
    expect((await help(app)).deviceContext?.presence?.state).toBe('stale')
    const heartbeatAt = '2026-09-15T00:01:00.000Z'
    await registry.touchSeen('device/context-test', heartbeatAt)
    expect((await registry.get('device/context-test')).deviceReportedAt).toBe(now)
    await registry.setOnline('device/context-test', false, heartbeatAt)
    const issued = await post(app, 'system/sk/write', {
      owner: 'agent:context-reader', scopes: [
        { pattern: 'device/context-test/**', actions: ['read', 'call'] },
        { pattern: 'device/context-test/private/**', actions: ['read', 'call'], effect: 'deny' },
      ],
    })
    expect(issued.status).toBe(200)
    const { secret } = await issued.json() as { secret: string }
    const result = await help(app, secret)
    expect(result.deviceContext).toEqual({ environment, reportedAt: now, presence: { state: 'offline', lastSeenAt: heartbeatAt } })
    expect(result.children?.map(child => child.path)).toEqual(['device/context-test/public'])
    expect(JSON.stringify(result)).not.toContain('private')
    expect(result.hint).toContain('last hello report (offline)')
    for (const accept of ['text/plain', 'text/markdown']) {
      const response = await app.request('https://tb.test/device/context-test/~help', bearer(secret, { headers: { accept } }))
      const text = await response.text()
      expect(text).toContain('runtime-1')
      expect(text).toContain(now)
      expect(text).not.toContain('private')
    }
    const projected = new RemotePathProjector('remote').projectHelp(result, 'remote/device/context-test')
    expect(projected.deviceContext).toEqual(result.deviceContext)
    expect(projected.children?.[0]?.path).toBe('remote/device/context-test/public')
  })

  it('legacy hello removes an old snapshot instead of inventing current metadata', async () => {
    const app = await createTestApp()
    await hello(app)
    await processDeviceHello({ store: app.state, authorization: `Bearer ${TEST_ADMIN_SK}`, deviceIdHint: 'context-test', hello: { deviceId: 'context-test', expose: {} }, now })
    expect((await help(app)).deviceContext).toBeUndefined()
  })

  it('rejects forged gateway fields from both registry authoring surfaces and custom hello nodes', async () => {
    const app = await createTestApp()
    for (const path of ['system/registry/write', 'forged/~register']) {
      const response = await post(app, path, {
        path: 'forged', kind: 'directory', description: 'forged', deviceEnvironment: environment, deviceReportedAt: now,
      })
      expect(response.status).toBe(400)
    }
    await expect(processDeviceHello({
      store: app.state, authorization: `Bearer ${TEST_ADMIN_SK}`, deviceIdHint: 'forged',
      hello: { deviceId: 'forged', expose: { nodes: [{ path: 'node', kind: 'tool', description: 'forged', ...{ deviceEnvironment: environment } }] } },
    })).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(await app.state.get('node:device/forged')).toBeNull()
  })

  it.each([
    { platform: 'linux', cwd: '/home/private' },
    { platform: 'linux', runtimeVersion: '22\nsecret' },
    { platform: 'linux', arch: 'a'.repeat(33) },
    { platform: 'unknown' },
  ])('rejects unsupported environment fields before writing nodes: %j', async (invalid) => {
    const app = await createTestApp()
    expect(() => decodeDeviceFrame(JSON.stringify({ type: 'hello', deviceId: 'invalid', expose: { environment: invalid } }))).toThrow()
    await expect(processDeviceHello({ store: app.state, authorization: `Bearer ${TEST_ADMIN_SK}`, deviceIdHint: 'invalid', hello: { deviceId: 'invalid', expose: { environment: invalid as DeviceEnvironment } } })).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(await app.state.get('node:device/invalid')).toBeNull()
  })
})
