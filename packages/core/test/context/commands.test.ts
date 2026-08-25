import { describe, expect, it, vi } from 'vitest'
import type { ContextProvider } from '../../src/context/types'
import {
  dispatchContextCmd,
  dispatchContextUploadCmd,
  parseContextCmdArgs,
} from '../../src/context/help'
import { isTBError } from '../../src/errors'

function makeProvider() {
  const provider: ContextProvider = {
    list: vi.fn(async () => ({ items: [] })),
    get: vi.fn(async path => ({
      uri: `node://docs/${path}`,
      contentType: 'text/plain',
      content: 'body',
      metadata: {},
      updatedAt: '2026-08-25T00:00:00.000Z',
      version: 'v1',
    })),
    write: vi.fn(async path => ({
      uri: `node://docs/${path}`,
      contentType: 'text/plain',
      metadata: {},
      updatedAt: '2026-08-25T00:00:00.000Z',
      version: 'v1',
    })),
    update: vi.fn(async path => ({
      uri: `node://docs/${path}`,
      contentType: 'text/plain',
      metadata: {},
      updatedAt: '2026-08-25T00:00:00.000Z',
      version: 'v2',
    })),
    delete: vi.fn(async () => undefined),
    search: vi.fn(async () => ({ items: [] })),
  }
  return provider
}

describe('Context command registry dispatch', () => {
  it('六动词与 provider 参数形状对拍', async () => {
    const provider = makeProvider()
    await dispatchContextCmd(provider, 'list', { path: 'a', opts: { limit: 2 } })
    await dispatchContextCmd(provider, 'get', { path: 'a/x' })
    await dispatchContextCmd(provider, 'write', {
      path: 'a/x',
      entry: { content: 'x', contentType: 'text/plain', metadata: { source: 'test' } },
    })
    await dispatchContextCmd(provider, 'update', {
      path: 'a/x', patch: { metadata: { state: 'done' }, ifVersion: 'v1' },
    })
    await dispatchContextCmd(provider, 'delete', { path: 'a/x' })
    await dispatchContextCmd(provider, 'search', {
      query: 'x', opts: { cursor: 'c', limit: 3, mode: 'keyword' },
    })

    expect(provider.list).toHaveBeenCalledWith('a', { limit: 2 })
    expect(provider.get).toHaveBeenCalledWith('a/x')
    expect(provider.write).toHaveBeenCalledWith('a/x', {
      content: 'x', contentType: 'text/plain', metadata: { source: 'test' },
    })
    expect(provider.update).toHaveBeenCalledWith('a/x', {
      metadata: { state: 'done' }, ifVersion: 'v1',
    })
    expect(provider.delete).toHaveBeenCalledWith('a/x')
    expect(provider.search).toHaveBeenCalledWith('x', {
      cursor: 'c', limit: 3, mode: 'keyword',
    })
  })

  it('顶层、entry 和 opts 的未知字段在 provider 前拒绝', async () => {
    const provider = makeProvider()
    const cases: Array<[string, Record<string, unknown>]> = [
      ['get', { path: 'a', token: 'secret' }],
      ['write', {
        path: 'a',
        entry: { content: 'x', contentType: 'text/plain', unknown: true },
      }],
      ['list', { opts: { limit: 1, filter: { x: 'y' } } }],
    ]
    for (const [command, args] of cases) {
      await expect(dispatchContextCmd(provider, command, args)).rejects.toSatisfy(
        error => isTBError(error) && error.code === 'invalid_argument',
      )
    }
    expect(provider.get).not.toHaveBeenCalled()
    expect(provider.write).not.toHaveBeenCalled()
    expect(provider.list).not.toHaveBeenCalled()
  })

  it('宿主 transport 转发前复用相同 schema', () => {
    expect(parseContextCmdArgs('list', { path: 'a', opts: { limit: 2 } })).toEqual({
      path: 'a', opts: { limit: 2 },
    })
    expect(() => parseContextCmdArgs('list', {
      path: 'a', opts: { limit: 2, token: 'secret' },
    })).toThrow(/invalid arguments for 'list'/)
  })

  it('未实现动词优先保持 unknown cmd 文案', async () => {
    await expect(dispatchContextCmd({}, 'write', { entry: null }))
      .rejects.toMatchObject({
        code: 'invalid_argument',
        message: 'unknown cmd \'write\'(provider 未实现)',
      })
    await expect(dispatchContextCmd({}, 'watch', {})).rejects.toMatchObject({
      code: 'invalid_argument',
      message: 'unknown cmd \'watch\'',
    })
  })

  it('create_upload 经同一 strict schema 把规范输入交给宿主 callback', async () => {
    const upload = vi.fn(async input => ({ uri: `node://docs/${input.path}` }))
    await expect(dispatchContextUploadCmd({
      path: 'camera/a.jpg', contentType: 'image/jpeg', overwrite: false,
    }, upload)).resolves.toEqual({ uri: 'node://docs/camera/a.jpg' })
    expect(upload).toHaveBeenCalledWith({
      path: 'camera/a.jpg', contentType: 'image/jpeg', overwrite: false,
    })
    await expect(dispatchContextUploadCmd({
      path: 'camera/a.jpg', contentType: 'image/jpeg', uploadToken: 'secret',
    }, upload)).rejects.toSatisfy(error => isTBError(error) && error.code === 'invalid_argument')
    expect(upload).toHaveBeenCalledTimes(1)
  })
})
