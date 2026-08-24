import { beforeEach, describe, expect, it } from 'vitest'
import type { CallContext } from '../../src/types'
import { createStoreModule, storeScopeForCmd } from '../../src/builtin/store'
import { StoreService } from '../../src/objectStoreService/service'
import { MemoryObjectStore } from '../../src/context/objectStore'
import { MemoryStateStore } from '../../src/store'
import { isTBError } from '../../src/errors'

const ctx: CallContext = {
  keyId: 'rotating-key-id-must-not-own-objects',
  owner: 'agent:stable-owner',
  scopes: [],
  traceId: 'trace-1',
}

describe('builtin store 模块', () => {
  let service: StoreService
  let seenOrigin: string | undefined
  let mod: ReturnType<typeof createStoreModule>

  beforeEach(() => {
    service = new StoreService(new MemoryStateStore(), new MemoryObjectStore(), {
      tokenSecret: 'builtin-store-token-secret-value',
      now: () => '2026-08-25T00:00:00.000Z',
    })
    mod = createStoreModule({
      service,
      callbacks: {
        createUpload(start, runtime) {
          seenOrigin = runtime?.requestOrigin
          return { ...start, url: `${runtime?.requestOrigin}/~store/uploads/${start.uploadId}` }
        },
        read(object, runtime) {
          seenOrigin = runtime?.requestOrigin
          return { $ref: `${runtime?.requestOrigin}/~store/objects/${object.id}` }
        },
        share(result, runtime) {
          seenOrigin = runtime?.requestOrigin
          return { ...result, $ref: `${runtime?.requestOrigin}/~store/shares/${result.shareId}` }
        },
      },
    })
  })

  it('Help 列全命令与权威 scope/path 映射', () => {
    const help = mod.help('system/store')
    expect(Object.fromEntries(help.cmds.map(cmd => [cmd.name, cmd.scope]))).toEqual({
      create_upload: 'write',
      complete_upload: 'write',
      abort_upload: 'write',
      stat: 'read',
      read: 'read',
      share: 'write',
      revoke_share: 'write',
      delete: 'write',
      list: 'read',
    })
    expect(help.cmds.every(cmd => cmd.path === `/system/store/${cmd.name}`)).toBe(true)
    expect(JSON.stringify(help)).not.toContain('callCapability')
    expect(JSON.stringify(help)).not.toContain('uploadToken')
    expect(JSON.stringify(help)).not.toContain('shareToken')
    expect(storeScopeForCmd('create_upload')).toBe('write')
    expect(storeScopeForCmd('read')).toBe('read')
    expect(storeScopeForCmd('unknown')).toBeUndefined()
  })

  it('create_upload 使用 ctx.owner 而非 keyId，并把请求 origin 仅交给 callback', async () => {
    const start = await mod.dispatch('create_upload', {
      contentType: 'image/jpeg',
      size: 3,
    }, ctx, { requestOrigin: 'https://bridge.example' }) as {
      objectUri: string
      uploadToken: string
    }
    expect(seenOrigin).toBe('https://bridge.example')
    await service.commitRelayUpload({ uploadToken: start.uploadToken, body: 'img' })
    expect(await service.stat(start.objectUri, { owner: ctx.owner })).toMatchObject({
      owner: ctx.owner,
    })
    await expect(service.stat(start.objectUri, { owner: ctx.keyId })).rejects.toBeDefined()
  })

  it('capability token 字段进入普通 builtin body 时权威拒绝，而不是静默忽略', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['create_upload', { contentType: 'image/jpeg', callCapability: 'secret' }],
      ['complete_upload', { uploadId: 'x', uploadToken: 'secret' }],
      ['abort_upload', { uploadId: 'x', uploadToken: 'secret' }],
      ['stat', { uri: 'store://default/Abcdefghijklmnopqrstuv12', shareToken: 'secret' }],
      ['read', { uri: 'store://default/Abcdefghijklmnopqrstuv12', shareToken: 'secret' }],
    ]
    for (const [cmd, args] of cases) {
      await expect(mod.dispatch(cmd, args, ctx)).rejects.toSatisfy(
        error => isTBError(error) && error.code === 'invalid_argument',
      )
    }
  })
})
