import { describe, expect, it } from 'vitest'
import { contentTypeFor, negotiate } from '../../src/htbp/negotiate'

describe('negotiate(全分支)', () => {
  it('缺失 Accept → markdown(默认表现)', () => {
    expect(negotiate(undefined)).toBe('markdown')
    expect(negotiate('')).toBe('markdown')
  })
  it('application/json → json', () => {
    expect(negotiate('application/json')).toBe('json')
    expect(negotiate('Application/JSON')).toBe('json')
    expect(negotiate('application/json, text/plain')).toBe('json')
  })
  it('text/markdown → markdown', () => {
    expect(negotiate('text/markdown')).toBe('markdown')
    expect(negotiate('TEXT/MARKDOWN')).toBe('markdown')
  })
  it('text/plain(显式)→ dsl', () => {
    expect(negotiate('text/plain')).toBe('dsl')
    expect(negotiate('TEXT/PLAIN')).toBe('dsl')
  })
  it('*/* 与未知类型 → markdown(不表态视同默认)', () => {
    expect(negotiate('*/*')).toBe('markdown')
    expect(negotiate('application/xml')).toBe('markdown')
    expect(negotiate('foo/bar')).toBe('markdown')
  })
  it('优先级 json > markdown > dsl', () => {
    expect(negotiate('application/json, text/markdown')).toBe('json')
    expect(negotiate('text/markdown, application/json')).toBe('json')
    expect(negotiate('text/markdown, text/plain')).toBe('markdown')
    expect(negotiate('text/plain, text/markdown')).toBe('markdown')
  })
})

describe('contentTypeFor', () => {
  it('三种表现的 Content-Type', () => {
    expect(contentTypeFor('dsl')).toBe('text/plain; charset=utf-8')
    expect(contentTypeFor('json')).toBe('application/json; charset=utf-8')
    expect(contentTypeFor('markdown')).toBe('text/markdown; charset=utf-8')
  })
})
