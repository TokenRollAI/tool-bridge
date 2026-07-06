import { describe, expect, it } from 'vitest'
import { CliError } from '../src/http'
import { parseScope } from '../src/scope'

describe('parseScope("pattern:actions")', () => {
  it('解析单动作', () => {
    expect(parseScope('docs/**:read')).toEqual({ pattern: 'docs/**', actions: ['read'] })
  })

  it('解析多动作(逗号分隔,去空白)', () => {
    expect(parseScope('docs/** : read, call ')).toEqual({
      pattern: 'docs/**',
      actions: ['read', 'call'],
    })
  })

  it('保留 glob 各形态的 pattern', () => {
    expect(parseScope('**:admin').pattern).toBe('**')
    expect(parseScope('device/build-01/**:call').pattern).toBe('device/build-01/**')
  })

  it('缺冒号 → CliError', () => {
    expect(() => parseScope('docs/**')).toThrow(CliError)
  })

  it('空 pattern → CliError', () => {
    expect(() => parseScope(':read')).toThrow(CliError)
  })

  it('无动作 → CliError', () => {
    expect(() => parseScope('docs/**:')).toThrow(CliError)
  })

  it('非法动作 → CliError', () => {
    expect(() => parseScope('docs/**:frobnicate')).toThrow(/invalid action/)
  })
})
