import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { approvedDirectory, updatedCompose } from '../src/deploymentAgent'

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
})
