import { describe, expect, it } from 'vitest'
import { safeRequestLogPath } from '../src/app'

describe('safeRequestLogPath', () => {
  it('脱敏 Context 与 Store bearer URL 的 token path segment', () => {
    expect(safeRequestLogPath('https://tb.example/~ref/secret-token')).toBe('/~ref/<redacted>')
    expect(safeRequestLogPath('https://tb.example/~store/refs/owner-token')).toBe(
      '/~store/refs/<redacted>',
    )
    expect(safeRequestLogPath('https://tb.example/~store/shares/share-token')).toBe(
      '/~store/shares/<redacted>',
    )
  })

  it('保留不含 bearer 的诊断路径', () => {
    expect(safeRequestLogPath('https://tb.example/system/store/list')).toBe('/system/store/list')
    expect(safeRequestLogPath('https://tb.example/~store/uploads/upload-id')).toBe(
      '/~store/uploads/upload-id',
    )
  })
})
