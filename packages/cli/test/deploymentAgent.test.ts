import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { approvedDirectory, observedSettings, updatedCompose } from '../src/deploymentAgent'

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tb-deployment-test-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('restricted Compose changes', () => {
  it('updates only app image and fixed port while preserving unrelated services and credentials', async () => {
    const source = 'services:\n  app:\n    image: old:image\n    environment:\n      PRIVATE_SECRET: keep-private\n    ports: ["127.0.0.1:8787:8787"]\n  postgres:\n    image: postgres:18\n'
    const next = await updatedCompose(source, { image: 'new:image', hostPort: 8788, bindAddress: '127.0.0.1' }, {}, directory)
    const document = parse(next)
    expect(document.services.postgres).toEqual({ image: 'postgres:18' })
    expect(document.services.app.environment).toEqual({ PRIVATE_SECRET: 'keep-private' })
    expect(document.services.app.image).toBe('new:image')
    expect(document.services.app.ports).toEqual([{ target: 8787, published: '8788', host_ip: '127.0.0.1', protocol: 'tcp' }])
  })
  it('approves only a real child directory and rejects traversal, root and symlink escapes', async () => {
    const child = join(directory, 'data')
    await mkdir(child)
    expect(await approvedDirectory(child, directory)).toContain('/data')
    await expect(approvedDirectory(directory, directory)).rejects.toThrow()
    await expect(approvedDirectory('/tmp', directory)).rejects.toThrow()
    const link = join(directory, 'escape')
    await symlink('/tmp', link)
    await expect(approvedDirectory(link, directory)).rejects.toThrow()
  })
  it('mount changes have fixed container destinations and read-only UI files', async () => {
    const data = join(directory, 'data')
    const ui = join(directory, 'ui')
    await Promise.all([mkdir(data), mkdir(ui)])
    const next = await updatedCompose('services:\n  app:\n    image: old:image\n', { image: 'new:image', hostPort: 8788, bindAddress: '127.0.0.1', stateDirectory: data, uiDirectory: ui }, {}, directory)
    expect(parse(next).services.app.volumes).toMatchObject([{ target: '/data', type: 'bind' }, { target: '/app/dashboard', type: 'bind', read_only: true }])
  })
  it.each([false, true])('omitting uiDirectory removes the old UI mount and preserves unrelated mounts (state bind: %s)', async (stateBind) => {
    const dataPath = join(directory, 'data')
    await mkdir(dataPath)
    const data = await realpath(dataPath)
    const dataMount = stateBind
      ? { type: 'bind', source: data, target: '/data' }
      : { type: 'volume', source: 'bootstrap', target: '/data' }
    const uiMount = { type: 'bind', source: join(directory, 'old-ui'), target: '/app/dashboard', read_only: true }
    const unrelatedMount = { type: 'bind', source: join(directory, 'logs'), target: '/logs', read_only: true, bind: { propagation: 'rprivate' } }
    const service = { image: 'old:image', volumes: [dataMount, uiMount, unrelatedMount] }
    const source = stringify({ services: { app: service } })
    const next = await updatedCompose(source, {
      image: 'new:image', hostPort: 8788, bindAddress: '127.0.0.1', ...(stateBind ? { stateDirectory: data } : {}),
    }, service, directory)
    expect(parse(next).services.app.volumes).toEqual([dataMount, unrelatedMount])
  })
  it('normalizes a Docker Desktop mount only when it identifies the expected host directory', () => {
    const expected = { image: 'new:image', hostPort: 8788, bindAddress: '127.0.0.1' as const, uiDirectory: '/Users/operator/custom-ui' }
    const service = {
      image: expected.image,
      ports: [{ target: 8787, published: '8788', host_ip: '127.0.0.1' }],
      volumes: [{ type: 'bind', source: '/host_mnt/Users/operator/custom-ui', target: '/app/dashboard' }],
    }
    expect(observedSettings(service, expected, 'darwin')).toEqual(expected)
    expect(observedSettings(service, expected, 'linux').uiDirectory).toBe(service.volumes[0]?.source)
    expect(observedSettings(service, { ...expected, uiDirectory: '/Users/operator/another-ui' }, 'darwin').uiDirectory)
      .toBe(service.volumes[0]?.source)
    const imageSettings = { image: expected.image, hostPort: expected.hostPort, bindAddress: expected.bindAddress }
    expect(observedSettings(service, imageSettings, 'darwin')).not.toEqual(imageSettings)
    expect(observedSettings({ ...service, volumes: [] }, imageSettings, 'darwin')).toEqual(imageSettings)
  })
  it.each(['volume', 'tmpfs'])('rejects an actual %s UI mount instead of projecting it as the image UI', (type) => {
    const service = {
      image: 'new:image',
      ports: [{ target: 8787, published: '8788', host_ip: '127.0.0.1' }],
      volumes: [{ type, source: 'hidden-ui', target: '/app/dashboard' }],
    }
    const imageSettings = { image: 'new:image', hostPort: 8788, bindAddress: '127.0.0.1' as const }
    expect(() => observedSettings(service, imageSettings)).toThrow('UI overrides must be bind mounts')
    expect(() => observedSettings(service, { ...imageSettings, uiDirectory: '/Users/operator/ui' }))
      .toThrow('UI overrides must be bind mounts')
  })
})
