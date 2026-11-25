import { type PluginUpgradePreview, type PluginView, resolveExternalExport, TBError } from '@tool-bridge/core'
import { afterEach, expect, it, vi } from 'vitest'
import { resolvePluginRelease } from '../src/providers/pluginRelease'
import { bearer, createTestApp } from './harness'
import { createTbApp } from '../src/index'

const site = 'https://releases.example'
const id = 'sample'
const source = site + '/plugin.json'
const release = (version: string) => ({ schemaVersion: 'tb-plugin-release/v1', id, version, endpoint: site + '/' + version })
const descriptor = (label: string) => ({
  protocolVersion: 'plugin/v2', exports: [{ id: 'tools', profile: 'tools/v1', auth: { kind: 'none' }, description: label }],
})
afterEach(() => vi.unstubAllGlobals())

it('HTTP control plane installs, refreshes, upgrades and rolls back while mounted resolution and the bearer stay consistent', async () => {
  const tb = await createTestApp()
  await tb.secrets.set('plugin-bearer', 'stable-token', new Date().toISOString())
  const post = (action: string, input: object) => tb.request('https://gateway/system/plugin/' + action, {
    ...bearer(), method: 'POST', headers: { ...bearer().headers, 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify(input),
  })
  let candidate = release('1.0.0')
  let healthy = true
  let valid = true
  let expectedToken = 'stable-token'
  let checks = 0
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url === source) return Response.json(candidate)
    expect(init.redirect).toBe('error')
    if (url.endsWith('/~auth')) {
      expect(init.method).toBe('HEAD')
      return new Headers(init.headers).get('authorization') === 'Bearer ' + expectedToken
        ? new Response(null, { status: 204, headers: { 'x-tb-plugin-auth': 'plugin/v2' } })
        : new Response(null, { status: 401 })
    }
    if (url.endsWith('/healthz')) {
      checks++
      return Response.json({ healthy })
    }
    if (url.endsWith('/~describe')) return Response.json(valid ? descriptor(url) : {})
    throw new Error('unexpected URL')
  })
  const installed = await post('install', { source, secretRef: 'plugin-bearer' })
  expect(installed.status).toBe(200)
  const first = await installed.json() as PluginView
  expect(first.distribution!.active).toMatchObject({ source, version: '1.0.0', digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) })
  expect(await (await post('install', { source, secretRef: 'plugin-bearer' })).json()).toMatchObject({ code: 'conflict' })
  const refresh = await post('upgrade', { id })
  expect(refresh.status).toBe(200)
  expect(checks).toBe(2)
  expect(await refresh.json()).toEqual(first)

  candidate = release('2.0.0')
  healthy = false
  expect((await post('upgrade', { id })).status).toBe(503)
  healthy = true
  valid = false
  expect((await post('upgrade', { id })).status).toBe(400)
  expect(await (await post('get', { id })).json()).toEqual(first)
  valid = true
  expectedToken = 'unmatched'
  expect((await post('upgrade', { id })).status).toBe(503)
  expect(await (await post('get', { id })).json()).toEqual(first)
  expectedToken = 'stable-token'
  expect((await post('upgrade', { id })).status).toBe(200)
  const resolve = () => resolveExternalExport(tb.state, id, 'tool', 'tool')
  expect((await resolve()).manifest.endpoint).toBe(candidate.endpoint)
  candidate = { ...candidate, endpoint: site + '/replacement' }
  expect((await post('upgrade', { id })).status).toBe(409)
  candidate = { ...release('3.0.0'), endpoint: 'https://other.example/v3' }
  expect((await post('upgrade', { id })).status).toBe(400)
  healthy = false
  expect((await post('rollback', { id })).status).toBe(503)
  expect((await resolve()).manifest.endpoint).toBe(release('2.0.0').endpoint)
  healthy = true
  expect((await post('rollback', { id })).status).toBe(200)
  expect((await post('rollback', { id })).status).toBe(200)
  expect((await post('rollback', { id, digest: first.distribution!.active.digest })).status).toBe(200)
  const mount = await resolve()
  expect(mount.manifest.endpoint).toBe(first.endpoint)
  expect(mount.export).toEqual(first.exports[0])
  expect(await tb.secrets.resolve('plugin-bearer')).toBe('stable-token')
})

it('resolves pinned npm metadata and the fixed GitHub asset, including its restricted HTTPS redirect', async () => {
  const manifest = release('1.2.3')
  const fetch = vi.fn(async (url: string) => {
    if (url === 'https://registry.npmjs.org/%40fixture%2Fplugin/1.2.3')
      return Response.json({ name: '@fixture/plugin', version: '1.2.3', toolBridgePlugin: manifest })
    if (url === 'https://github.com/fixture/plugin/releases/download/v1.2.3/tool-bridge-plugin.json')
      return Response.redirect('https://release-assets.githubusercontent.com/asset?signature=test')
    if (url === 'https://release-assets.githubusercontent.com/asset?signature=test') return Response.json(manifest)
    throw new Error('unexpected request')
  })
  vi.stubGlobal('fetch', fetch)
  for (const [reference, fixed] of [
    ['npm:@fixture/plugin@1.2.3', 'npm:@fixture/plugin@1.2.3'],
    ['https://www.npmjs.com/package/@fixture/plugin/v/1.2.3', 'npm:@fixture/plugin@1.2.3'],
    ['github:fixture/plugin@v1.2.3', 'github:fixture/plugin@v1.2.3'],
    ['https://github.com/fixture/plugin/releases/tag/v1.2.3', 'github:fixture/plugin@v1.2.3'],
  ] as const) expect(await resolvePluginRelease(reference)).toMatchObject({ release: manifest, resolvedSource: fixed })
  for (const reference of ['npm:fixture@latest', 'npm:fixture@^1.2.3', 'github:a/b@latest', 'https://www.npmjs.com/package/@fixture/plugin', 'https://github.com/fixture/plugin', 'https://github.com/fixture/plugin/releases/latest', 'https://user:pw@example.com/release'])
    await expect(resolvePluginRelease(reference)).rejects.toMatchObject({ code: 'invalid_argument' })
  expect(fetch).toHaveBeenCalledTimes(6)
})

it('requires secret admin on the authoritative routes, including upgrades and rollbacks of existing bearer registrations', async () => {
  const tb = await createTestApp()
  const post = (path: string, input: object, credential?: string) => tb.request('https://gateway/' + path, {
    method: 'POST', headers: { ...bearer(credential).headers, 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify(input),
  })
  const issued = await post('system/sk/write', { owner: 'user:release-admin', scopes: [{ pattern: 'system/plugin', actions: ['read', 'admin'] }] })
  expect(issued.status).toBe(200)
  const { secret } = await issued.json() as { secret: string }
  vi.stubGlobal('fetch', vi.fn())
  await tb.state.put('plugin:sample', {
    id, auth: { kind: 'bearer', secretRef: 'transport' }, distribution: { active: { source } },
  })
  for (const [operation, input] of [
    ['install', { source, secretRef: 'transport' }], ['preview', { id }], ['upgrade', { id }], ['rollback', { id }],
  ] as const) {
    const result = await post('system/plugin/' + operation, input, secret)
    expect(result.status).toBe(403)
  }
  expect(globalThis.fetch).not.toHaveBeenCalled()
})

it('concurrent updates switch endpoint, descriptor and rollback snapshot together', async () => {
  const tb = await createTestApp()
  await tb.secrets.set('transport', 'fixture', new Date().toISOString())
  const post = (op: string, data: object) => tb.request('https://gateway/system/plugin/' + op, {
    method: 'POST', headers: { ...bearer().headers, 'content-type': 'application/json', 'accept': 'application/json' }, body: JSON.stringify(data),
  })
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url.endsWith('.json')) return Response.json(release(url.split('/').at(-1)!.slice(0, -5)))
    if (url.endsWith('/healthz')) return Response.json({ healthy: true })
    if (url.endsWith('/~describe')) return Response.json(descriptor(url))
    if (new Headers(init.headers).get('authorization') !== 'Bearer fixture') return new Response(null, { status: 401 })
    return new Response(null, { status: 204, headers: { 'x-tb-plugin-auth': 'plugin/v2' } })
  })
  expect((await post('install', { source: site + '/1.0.0.json', secretRef: 'transport' })).status).toBe(200)
  const statuses = await Promise.all(['2.0.0', '3.0.0'].map(v => post('upgrade', { id, source: site + '/' + v + '.json' })))
  expect(statuses.map(r => r.status).sort()).toEqual([200, 409])
  const winner = await (await post('get', { id })).json() as PluginView
  expect(winner.exports[0]!.description).toBe(winner.endpoint + '/~describe')
  expect(winner.distribution!.previous!.version).toBe('1.0.0')
})

it('installs OCI manifests from actual version and release page URLs, reauthorizing the saved image on rollback', async () => {
  const tb = await createTestApp()
  await tb.secrets.set('transport', 'fixture', new Date().toISOString())
  const first = 'registry.example/plugins/sample@sha256:' + 'a'.repeat(64)
  const second = first.replace(/a{64}$/, 'b'.repeat(64))
  const one = site + '/v1'
  const two = site + '/v2'
  const allowed = new Map([[first, one], [second, two]])
  const preparePluginImage = vi.fn(async (pluginId: string, image: string) => {
    expect(pluginId).toBe(id)
    const endpoint = allowed.get(image)
    if (!endpoint) throw new TBError('permission_denied', 'image unavailable')
    return endpoint
  })
  const app = createTbApp({ ...tb.deps, preparePluginImage })
  const npmPage = 'https://www.npmjs.com/package/@org/sample/v/1.0.0'
  const githubPage = 'https://github.com/org/sample/releases/tag/v2.0.0'
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const manifest = { schemaVersion: 'tb-plugin-release/v1', id }
    if (url === 'https://registry.npmjs.org/%40org%2Fsample/1.0.0') return Response.json({
      name: '@org/sample', version: '1.0.0', toolBridgePlugin: { ...manifest, version: '1.0.0', image: first },
    })
    if (url === 'https://github.com/org/sample/releases/download/v2.0.0/tool-bridge-plugin.json')
      return Response.json({ ...manifest, version: '2.0.0', image: second })
    if (url.endsWith('/~describe')) return Response.json(descriptor(url))
    if (url.endsWith('/healthz')) return Response.json({ healthy: true })
    if (url.endsWith('/~auth')) return new Headers(init.headers).get('authorization') === 'Bearer fixture'
      ? new Response(null, { status: 204, headers: { 'x-tb-plugin-auth': 'plugin/v2' } })
      : new Response(null, { status: 401 })
    throw new Error('unexpected request')
  })
  const post = (cmd: string, data: object) => app.request('/system/plugin/' + cmd, {
    method: 'POST', headers: { ...bearer().headers, 'content-type': 'application/json', 'accept': 'application/json' }, body: JSON.stringify(data),
  })
  const installed = await post('install', { source: npmPage, secretRef: 'transport' })
  expect(installed.status).toBe(200)
  expect(await installed.json()).toMatchObject({ endpoint: one, distribution: { active: {
    source: npmPage, resolvedSource: 'npm:@org/sample@1.0.0', image: first, approvedBy: expect.any(String),
  } } })
  const preview = await post('preview', { id, source: githubPage })
  expect(preview.status).toBe(200)
  const impact = await preview.json() as PluginUpgradePreview
  expect(impact.requiresRunner).toBe(true)
  expect(preparePluginImage).toHaveBeenLastCalledWith(id, second)
  expect(await (await post('get', { id })).json()).toMatchObject({ endpoint: one })
  const upgraded = await post('upgrade', { id, source: githubPage, candidateDigest: impact.candidateDigest })
  expect(upgraded.status).toBe(200)
  expect(await upgraded.json()).toMatchObject({ endpoint: two, distribution: { active: {
    source: githubPage, resolvedSource: 'github:org/sample@v2.0.0', image: second,
  } } })
  allowed.delete(first)
  expect((await post('rollback', { id })).status).toBe(403)
  allowed.set(first, 'https://another.example/stale')
  expect((await post('rollback', { id })).status).toBe(409)
  expect(await (await post('get', { id })).json()).toMatchObject({ endpoint: two })
  allowed.set(first, one)
  expect((await post('rollback', { id })).status).toBe(200)
  expect(await (await post('get', { id })).json()).toMatchObject({ endpoint: one })
})

it('previews descriptor impact without mutation or credential disclosure and requires the same candidate at activation', async () => {
  const tb = await createTestApp()
  const post = (path: string, input: object, credential?: string) => tb.request('https://gateway/' + path, {
    method: 'POST', headers: { ...bearer(credential).headers, 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify(input),
  })
  await tb.secrets.set('private-reference', 'private-bearer', new Date().toISOString())
  const restricted = await post('system/sk/write', { owner: 'user:preview', scopes: [
    { pattern: 'system/plugin', actions: ['read', 'admin'] }, { pattern: 'system/secret', actions: ['admin'] },
    { pattern: 'public/**', actions: ['read'] },
  ] })
  const { secret } = await restricted.json() as { secret: string }
  const makeExport = (id: string, profile: string, description: string) => ({ id, profile, description, auth: { kind: 'none' } })
  let bearerChecks = 0
  const previous = [makeExport('keep', 'tools/v1', 'old'), makeExport('remove', 'context/v1', 'old')]
  let next = [makeExport('keep', 'tools/v1', 'updated'), makeExport('new', 'context/v1', 'new')]
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url.endsWith('.json')) return Response.json(release(url.endsWith('next.json') ? '2.0.0' : '1.0.0'))
    if (url.endsWith('/healthz')) return Response.json({ healthy: true })
    if (url.endsWith('/~describe')) return Response.json({ protocolVersion: 'plugin/v2', exports: url.includes('1.0.0') ? previous : next })
    if (url.endsWith('/~auth')) {
      if (new Headers(init.headers).get('authorization') !== 'Bearer private-bearer') return new Response(null, { status: 401 })
      bearerChecks++
      return new Response(null, { status: 204, headers: { 'x-tb-plugin-auth': 'plugin/v2' } })
    }
    return Response.json([])
  })
  expect((await post('system/plugin/install', { source, secretRef: 'private-reference' })).status).toBe(200)
  for (const [path, kind, name] of [['public/tool', 'tool', 'keep'], ['public/docs', 'context', 'remove'], ['secret/docs', 'context', 'remove']]) {
    expect((await post('system/registry/write', { path, kind, description: 'mount', config: { kind, provider: id, export: name } })).status).toBe(200)
  }
  const original = await tb.state.get('plugin:' + id)
  const input = { id, source: site + '/next.json' }
  const preview = await post('system/plugin/preview', input, secret)
  expect(preview.status).toBe(200)
  const impact = await preview.json() as PluginUpgradePreview
  expect(impact).toEqual({
    id, currentVersion: '1.0.0', candidateVersion: '2.0.0', candidateDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    addedExports: ['new'], removedExports: ['remove'], changedExports: ['keep'],
    affectedMounts: ['public/docs', 'public/tool'], incompatibleMounts: ['public/docs'], requiresRunner: false,
  })
  expect(await tb.state.get('plugin:' + id)).toEqual(original)
  const confirmed = { ...input, candidateDigest: impact.candidateDigest }
  next = [makeExport('keep', 'tools/v1', 'silently changed'), next[1]!]
  expect(bearerChecks).toBe(2)
  const priorChecks = bearerChecks
  const stale = await post('system/plugin/upgrade', confirmed)
  expect(stale.status).toBe(409)
  expect(bearerChecks).toBe(priorChecks)
  expect(await tb.state.get('plugin:' + id)).toEqual(original)
  const fresh = await (await post('system/plugin/preview', input)).json() as PluginUpgradePreview
  expect(fresh.candidateDigest).not.toBe(impact.candidateDigest)
  expect((await post('system/plugin/upgrade', { ...input, candidateDigest: fresh.candidateDigest })).status).toBe(200)
  expect((await post('system/plugin/upgrade', { ...input, candidateDigest: fresh.candidateDigest })).status).toBe(409)
})
