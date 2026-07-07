import { describe, expect, it } from 'vitest'
import { isTBError } from '../../src/errors'
import { authHeaderFor, buildHttpRequest, effectFor } from '../../src/tool/httpTool'
import type { HttpToolDef } from '../../src/types'

const endpoint = 'https://api.example.com'

function def(over: Partial<HttpToolDef>): HttpToolDef {
  return {
    name: 't',
    description: 'd',
    method: 'GET',
    pathTemplate: '/things',
    ...over,
  }
}

describe('buildHttpRequest 拼装(定型)', () => {
  it('{param} 占位从 args 取,URL 编码后替换,取用即移出剩余集', () => {
    const req = buildHttpRequest(
      def({ method: 'GET', pathTemplate: '/users/{id}/repos' }),
      endpoint,
      { id: 'a b', sort: 'name' },
    )
    // id 消费进 path(编码),sort 未消费进 query
    expect(req.url).toBe('https://api.example.com/users/a%20b/repos?sort=name')
    expect(req.method).toBe('GET')
    expect(req.body).toBeUndefined()
  })

  it('缺占位参数 → invalid_argument', () => {
    try {
      buildHttpRequest(def({ pathTemplate: '/users/{id}' }), endpoint, {})
      throw new Error('应抛 invalid_argument')
    } catch (e) {
      expect(isTBError(e) && e.code).toBe('invalid_argument')
    }
  })

  it('GET:剩余 args → query(标量 String() 编码)', () => {
    const req = buildHttpRequest(def({ method: 'GET', pathTemplate: '/search' }), endpoint, {
      q: 'hello world',
      n: 5,
    })
    expect(req.url).toBe('https://api.example.com/search?q=hello%20world&n=5')
    expect(req.body).toBeUndefined()
  })

  it('DELETE:剩余 args 同样入 query(无 body)', () => {
    const req = buildHttpRequest(def({ method: 'DELETE', pathTemplate: '/items/{id}' }), endpoint, {
      id: '7',
      force: true,
    })
    expect(req.url).toBe('https://api.example.com/items/7?force=true')
    expect(req.body).toBeUndefined()
  })

  it('POST:剩余 args → JSON body,附 content-type', () => {
    const req = buildHttpRequest(def({ method: 'POST', pathTemplate: '/items/{id}' }), endpoint, {
      id: '7',
      title: 'x',
      count: 2,
    })
    expect(req.url).toBe('https://api.example.com/items/7')
    expect(req.body).toBe(JSON.stringify({ title: 'x', count: 2 }))
    expect(req.headers['content-type']).toBe('application/json')
  })

  it('PUT:与 POST 同,body 承载剩余 args', () => {
    const req = buildHttpRequest(def({ method: 'PUT', pathTemplate: '/x' }), endpoint, { a: 1 })
    expect(req.method).toBe('PUT')
    expect(req.body).toBe(JSON.stringify({ a: 1 }))
  })

  it('endpoint 尾斜杠与 pathTemplate 前斜杠归一,不产生双斜杠', () => {
    const req = buildHttpRequest(def({ pathTemplate: 'things' }), 'https://api.example.com/', {})
    expect(req.url).toBe('https://api.example.com/things')
  })
})

describe('effectFor 缺省派生(定型)', () => {
  it('显式 effect 优先', () => {
    expect(effectFor({ method: 'GET', effect: 'destructive' })).toBe('destructive')
  })
  it('缺省:GET → read', () => {
    expect(effectFor({ method: 'GET' })).toBe('read')
  })
  it('缺省:POST/PUT/DELETE → write', () => {
    expect(effectFor({ method: 'POST' })).toBe('write')
    expect(effectFor({ method: 'PUT' })).toBe('write')
    expect(effectFor({ method: 'DELETE' })).toBe('write')
  })
})

describe('authHeaderFor(定型)', () => {
  it('默认 Authorization / Bearer', () => {
    expect(authHeaderFor({}, 'tok')).toEqual(['Authorization', 'Bearer tok'])
  })
  it('自定义头名与 scheme', () => {
    expect(authHeaderFor({ authHeader: 'X-Api-Key', authScheme: 'Token' }, 'tok')).toEqual([
      'X-Api-Key',
      'Token tok',
    ])
  })
  it('authScheme 空串 → 原样注入 secret 值(无 scheme 前缀)', () => {
    expect(authHeaderFor({ authHeader: 'X-Api-Key', authScheme: '' }, 'tok')).toEqual([
      'X-Api-Key',
      'tok',
    ])
  })
})
