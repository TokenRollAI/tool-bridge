import { describe, expect, it, vi } from 'vitest'
import type { SkillhubProvider } from '../../src/skillhub/provider'
import { dispatchSkillhubCmd } from '../../src/skillhub/help'
import { isTBError } from '../../src/errors'

function makeProvider(): SkillhubProvider {
  return {
    list: vi.fn(async () => ({ items: [] })),
    get: vi.fn(async id => ({
      id,
      name: id,
      description: 'skill',
      updatedAt: '2026-08-25T00:00:00.000Z',
      content: '# Skill',
      files: [],
    })),
    get_file: vi.fn(async (id, path) => ({
      path,
      content: id,
      contentType: 'text/plain',
      version: 'v1',
    })),
    search: vi.fn(async () => ({ items: [] })),
    publish: vi.fn(async input => ({
      id: input.id ?? 'derived',
      name: 'skill',
      description: 'skill',
      fileCount: input.files.length,
    })),
    remove: vi.fn(async () => undefined),
  }
}

describe('Skillhub command registry dispatch', () => {
  it('get(file) / publish 与 provider 参数形状对拍', async () => {
    const provider = makeProvider()
    await dispatchSkillhubCmd(provider, 'get', { id: 'pdf', file: 'scripts/run.sh' })
    await dispatchSkillhubCmd(provider, 'publish', {
      id: 'pdf',
      files: [{ path: 'SKILL.md', content: '# PDF', contentType: 'text/markdown' }],
    })
    expect(provider.get_file).toHaveBeenCalledWith('pdf', 'scripts/run.sh')
    expect(provider.get).not.toHaveBeenCalled()
    expect(provider.publish).toHaveBeenCalledWith({
      id: 'pdf',
      files: [{ path: 'SKILL.md', content: '# PDF', contentType: 'text/markdown' }],
    })
  })

  it('顶层、opts 与 files[] 未知字段在 provider 前拒绝', async () => {
    const provider = makeProvider()
    const cases: Array<[string, Record<string, unknown>]> = [
      ['get', { id: 'pdf', token: 'secret' }],
      ['list', { opts: { limit: 1, filter: 'nope' } }],
      ['publish', { files: [{ path: 'SKILL.md', content: '# PDF', mode: 0o755 }] }],
    ]
    for (const [command, args] of cases) {
      await expect(dispatchSkillhubCmd(provider, command, args)).rejects.toSatisfy(
        error => isTBError(error) && error.code === 'invalid_argument',
      )
    }
    expect(provider.get).not.toHaveBeenCalled()
    expect(provider.list).not.toHaveBeenCalled()
    expect(provider.publish).not.toHaveBeenCalled()
  })

  it('缺 files 保持旧文案，未知 cmd 保持 invalid_argument', async () => {
    const provider = makeProvider()
    await expect(dispatchSkillhubCmd(provider, 'publish', {})).rejects.toMatchObject({
      code: 'invalid_argument',
      message: 'publish 需要数组 \'files\'',
    })
    await expect(dispatchSkillhubCmd(provider, 'watch', {})).rejects.toMatchObject({
      code: 'invalid_argument',
      message: 'unknown cmd \'watch\'',
    })
  })
})
