import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')
const railwayVolumeMarker = '# RAILWAY: /data 由平台在运行时挂载；Metal builder 不接受 Dockerfile VOLUME 指令。'

test('Railway Dockerfile only differs by omitting the unsupported VOLUME instruction', async () => {
  const [genericDockerfile, railwayDockerfile] = await Promise.all([
    readFile(join(root, 'Dockerfile'), 'utf8'),
    readFile(join(root, 'Dockerfile.railway'), 'utf8'),
  ])

  assert.match(genericDockerfile, /^VOLUME \/data$/m)
  assert.doesNotMatch(railwayDockerfile, /^\s*VOLUME\b/m)
  assert.match(railwayDockerfile, new RegExp(`^${railwayVolumeMarker}$`, 'm'))
  assert.equal(
    railwayDockerfile.replace(railwayVolumeMarker, 'VOLUME /data'),
    genericDockerfile,
    'shared image behavior must stay identical across generic and Railway Dockerfiles',
  )
})
