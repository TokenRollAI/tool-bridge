import { describe, expect, it } from 'vitest'
import { contentTypeFor, negotiate } from '../../src/htbp/negotiate'

describe('negotiate(全分支)', () => {
  it('缺失 Accept → dsl(默认表现)', () => {
    expect(negotiate(undefined)).toBe('dsl')
    expect(negotiate('')).toBe('dsl')
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
  it('text/plain 与 */* → dsl', () => {
    expect(negotiate('text/plain')).toBe('dsl')
    expect(negotiate('*/*')).toBe('dsl')
  })
  it('未知类型 → dsl', () => {
    expect(negotiate('application/xml')).toBe('dsl')
    expect(negotiate('foo/bar')).toBe('dsl')
  })
  it('json 优先于 markdown(两者共存取 json)', () => {
    expect(negotiate('application/json, text/markdown')).toBe('json')
    expect(negotiate('text/markdown, application/json')).toBe('json')
  })
})

describe('contentTypeFor', () => {
  it('三种表现的 Content-Type', () => {
    expect(contentTypeFor('dsl')).toBe('text/plain; charset=utf-8')
    expect(contentTypeFor('json')).toBe('application/json; charset=utf-8')
    expect(contentTypeFor('markdown')).toBe('text/markdown; charset=utf-8')
  })
})
