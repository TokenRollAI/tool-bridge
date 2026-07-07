import { describe, expect, it } from 'vitest'
import { checkAllowlist, rewriteRemotePath } from '../../src/tool/remote'

const base = 'https://peer.example.com/tb'

describe('rewriteRemotePath(透传改写)', () => {
  it('节点根:请求 path === 挂载前缀 → baseUrl 本身', () => {
    expect(rewriteRemotePath('docs/remote', 'docs/remote', base)).toBe(
      'https://peer.example.com/tb',
    )
  })

  it('后代 path:剥离挂载前缀,相对路径拼到 baseUrl 下', () => {
    expect(rewriteRemotePath('docs/remote', 'docs/remote/sub/leaf', base)).toBe(
      'https://peer.example.com/tb/sub/leaf',
    )
  })

  it('保留段 ~help(挂在节点根)→ baseUrl/~help', () => {
    expect(rewriteRemotePath('docs/remote', 'docs/remote/~help', base)).toBe(
      'https://peer.example.com/tb/~help',
    )
  })

  it('保留段 ~tree(挂在后代)→ 相对路径 + ~tree', () => {
    expect(rewriteRemotePath('docs/remote', 'docs/remote/sub/~tree', base)).toBe(
      'https://peer.example.com/tb/sub/~tree',
    )
  })

  it('保留段 ~skill 同形透传', () => {
    expect(rewriteRemotePath('r', 'r/a/~skill', 'https://p.example.com')).toBe(
      'https://p.example.com/a/~skill',
    )
  })

  it('baseUrl 尾斜杠归一,不产生双斜杠', () => {
    expect(rewriteRemotePath('r', 'r/x', 'https://p.example.com/')).toBe('https://p.example.com/x')
  })
})

describe('checkAllowlist(host 后缀白名单)', () => {
  it('后缀命中(子域)', () => {
    expect(checkAllowlist('https://api.example.com/x', ['example.com'])).toBe(true)
  })

  it('后缀命中(精确 host)', () => {
    expect(checkAllowlist('https://example.com', ['example.com'])).toBe(true)
  })

  it('不命中:相似但非段边界(notexample.com)', () => {
    expect(checkAllowlist('https://notexample.com', ['example.com'])).toBe(false)
  })

  it('空 allowlist:拒绝一切', () => {
    expect(checkAllowlist('https://example.com', [])).toBe(false)
  })

  it('带端口的 host 仍按主机名匹配', () => {
    expect(checkAllowlist('https://api.example.com:8443/x', ['example.com'])).toBe(true)
  })

  it('多条 allowlist:任一命中即通过', () => {
    expect(checkAllowlist('https://a.foo.io', ['example.com', 'foo.io'])).toBe(true)
  })

  it('无 host 的 URL → 拒', () => {
    expect(checkAllowlist('not-a-url', ['example.com'])).toBe(false)
  })
})
