import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPluginRunner } from '../src/pluginRunner'

it('accepts only the local id/digest pair and starts a restricted container with fixed arguments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plugin-runner-'))
  try {
    const image = 'registry.example/demo/plugin@sha256:' + '1'.repeat(64)
    const entry = { id: 'sample', image, port: 19001, endpoint: 'https://plugins.example/v1', tokenFile: join(dir, 'token') }
    await writeFile(entry.tokenFile, 'fixture-token')
    let container = ''
    const run = vi.fn(async (args: string[], token?: string) => {
      if (args[0] === 'image' && args[1] === 'inspect') return 'null'
      if (args[1] === 'ls') return container
      if (args[1] === 'create') {
        container = args[args.indexOf('--name') + 1]!
        expect(args.at(-1)).toBe(image)
        expect(args).toEqual(expect.arrayContaining(['never', '--read-only', '65532:65532', '--cap-drop', 'ALL',
          'no-new-privileges', '--pids-limit', '--cpus', '--memory', '--tmpfs', '127.0.0.1:19001:8080']))
        expect(args).not.toContain('fixture-token')
        expect(token).toBe('fixture-token')
      }
      return args[1] === 'inspect' ? image : ''
    })
    const app = createPluginRunner({ network: 'tb-plugins-egress', releases: [entry] }, run, async () => {})
    const prepare = (input: unknown) => app.request('/prepare', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    })
    expect((await prepare({ id: 'sample', image: 'registry.example/demo:latest' })).status).toBe(400)
    expect((await prepare({ id: 'other', image })).status).toBe(403)
    expect((await prepare({ id: 'sample', image, command: 'override' })).status).toBe(400)
    expect(run).not.toHaveBeenCalled()
    for (const response of await Promise.all([prepare({ id: 'sample', image }), prepare({ id: 'sample', image })])) {
      expect(response.status).toBe(204)
      expect(response.headers.get('x-tb-plugin-endpoint')).toBe(entry.endpoint)
    }
    expect((await prepare({ id: 'sample', image })).status).toBe(204)
    expect(run.mock.calls.filter(([args]) => args[1] === 'create')).toHaveLength(1)
  } finally {
    await rm(dir, { recursive: true })
  }
})

it('pulls the exact approved digest once on a miss and inspects the image again before create', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plugin-pull-'))
  try {
    const image = 'registry.example/notes@sha256:' + 'c'.repeat(64)
    const entry = { id: 'notes', image, port: 19002, endpoint: 'https://plugins.example/notes', tokenFile: join(dir, 'token') }
    await writeFile(entry.tokenFile, 'private-bearer')
    let cached = false
    let declaredVolumes = '{}'
    const run = vi.fn(async (args: string[], token?: string) => {
      if (args[0] === 'image' && args[1] === 'inspect') {
        if (!cached) throw Object.assign(new Error(), { stderr: 'Error response from daemon: No such image: ' + image })
        return declaredVolumes
      }
      if (args[0] === 'image' && args[1] === 'pull') {
        expect(args).toEqual(['image', 'pull', '--quiet', image])
        expect(token).toBeUndefined()
        cached = true
      }
      return args[1] === 'inspect' ? image : ''
    })
    const runner = createPluginRunner({ network: 'tb-plugins-local', releases: [entry] }, run, async () => {})
    const prepare = (candidate: string) => runner.request('/prepare', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: entry.id, image: candidate }),
    })
    expect((await prepare(image.replace(/c{64}$/, 'a'.repeat(64)))).status).toBe(403)
    expect(run).not.toHaveBeenCalled()
    expect((await prepare(image)).status).toBe(204)
    expect(run.mock.calls.map(([args]) => args.slice(0, 2).join(' '))).toEqual([
      'container ls', 'image inspect', 'image pull', 'image inspect', 'container create', 'container inspect', 'container start',
    ])
    run.mockClear()
    cached = false
    declaredVolumes = '{"/data":{}}'
    expect((await prepare(image)).status).toBe(503)
    expect(run.mock.calls.map(([args]) => args.slice(0, 2).join(' '))).toEqual([
      'container ls', 'image inspect', 'image pull', 'image inspect',
    ])
  } finally {
    await rm(dir, { recursive: true })
  }
})
