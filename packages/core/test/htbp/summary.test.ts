import { describe, expect, it } from 'vitest'
import { collapseToOneLine, summarizeOneLine } from '../../src/htbp/summary'

describe('collapseToOneLine', () => {
  it('换行与连续空白折叠为单空格,去首尾空白', () => {
    expect(collapseToOneLine('  a\n\n b\t c  ')).toBe('a b c')
  })
})

describe('summarizeOneLine', () => {
  it('取首个非空行(跳过前导空行)', () => {
    expect(summarizeOneLine('\n\n概述句。\n\n## 详情\n正文')).toBe('概述句。')
  })

  it('短文本原样返回', () => {
    expect(summarizeOneLine('解析库 id')).toBe('解析库 id')
  })

  it('超长首行截断并补 …(不超过 max)', () => {
    const long = 'x'.repeat(300)
    const out = summarizeOneLine(long, 160)
    expect(out.length).toBeLessThanOrEqual(160)
    expect(out.endsWith('…')).toBe(true)
  })

  it('空文本 → 空串', () => {
    expect(summarizeOneLine('')).toBe('')
    expect(summarizeOneLine('\n \n')).toBe('')
  })
})
