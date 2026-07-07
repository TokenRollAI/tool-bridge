import { describe, expect, it } from 'vitest'
import { parseHelpDsl, renderHelpDsl } from '../../src/htbp/helpDsl'
import type { HelpModel } from '../../src/htbp/model'

describe('renderHelpDsl 格式', () => {
  const model: HelpModel = {
    node: { path: 'docs/context7', kind: 'mcp', description: 'Context7 文档检索' },
    cmds: [
      {
        name: 'resolve-library-id',
        method: 'POST',
        path: '/docs/context7',
        inputSchema: {
          type: 'object',
          properties: { libraryName: { type: 'string' } },
          required: ['libraryName'],
        },
        returns: 'markdown 文档库列表',
        scope: 'call',
      },
    ],
  }
  const lines = renderHelpDsl(model).split('\n')

  it('首行为 htbp 0.1', () => {
    expect(lines[0]).toBe('htbp 0.1')
  })

  it('node 行:node <path> <kind> "<description>"', () => {
    expect(lines[1]).toBe('node docs/context7 mcp "Context7 文档检索"')
  })

  it('cmd 行:cmd <name> POST <path>', () => {
    expect(lines[2]).toBe('cmd resolve-library-id POST /docs/context7')
  })

  it('body 行为请求信封示意(tool+arguments),单行 JSON 且带两空格缩进', () => {
    expect(lines[3]).toBe(
      '  body {"tool":"resolve-library-id","arguments":{"type":"object","properties":{"libraryName":{"type":"string"}},"required":["libraryName"]}}',
    )
  })

  it('returns / scope 行带缩进,scope 必有', () => {
    expect(lines[4]).toBe('  returns markdown 文档库列表')
    expect(lines[5]).toBe('  scope call')
  })

  it('confirm/effect 可选:提供时渲染,effect 带文本、confirm 无参', () => {
    const m: HelpModel = {
      node: { path: 'x', kind: 'device', description: 'x' },
      cmds: [
        {
          name: 'shell',
          method: 'POST',
          path: '/x',
          scope: 'call',
          effect: '执行命令',
          confirm: true,
        },
      ],
    }
    const out = renderHelpDsl(m)
    expect(out).toContain('  effect 执行命令')
    expect(out).toContain('\n  confirm')
    expect(out.trimEnd().endsWith('  confirm')).toBe(true)
  })

  it('根节点(空路径)node 行渲染为 node / directory "..."', () => {
    const m: HelpModel = {
      node: { path: '', kind: 'directory', description: '根' },
      cmds: [],
    }
    expect(renderHelpDsl(m).split('\n')[1]).toBe('node / directory "根"')
  })

  it('directory 子节点续为 node 行(无 cmd 行)', () => {
    const m: HelpModel = {
      node: { path: 'a', kind: 'directory', description: 'A' },
      cmds: [],
      children: [
        { path: 'a/b', kind: 'mcp', description: 'B' },
        { path: 'a/c', kind: 'http', description: 'C' },
      ],
    }
    const out = renderHelpDsl(m).split('\n')
    expect(out).toEqual([
      'htbp 0.1',
      'node a directory "A"',
      'node a/b mcp "B"',
      'node a/c http "C"',
    ])
  })
})

describe('parseHelpDsl(最小 parser,向前兼容)', () => {
  it('提取 htbp / cmd(name,method,path,scope)/ node', () => {
    const text = [
      'htbp 0.1',
      'node docs mcp "文档"',
      'cmd search POST /docs',
      '  body {"tool":"search"}',
      '  returns 结果',
      '  scope call',
    ].join('\n')
    const parsed = parseHelpDsl(text)
    expect(parsed.htbp).toBe('0.1')
    expect(parsed.nodes).toEqual([{ path: 'docs', kind: 'mcp', description: '文档' }])
    expect(parsed.cmds).toEqual([{ name: 'search', method: 'POST', path: '/docs', scope: 'call' }])
  })

  it('未知行被忽略(向前兼容)', () => {
    const text = [
      'htbp 0.1',
      'node x builtin "x"',
      'futurekey some new directive',
      'cmd a POST /x',
      '  scope read',
      '  unknownattr whatever',
    ].join('\n')
    const parsed = parseHelpDsl(text)
    expect(parsed.cmds).toEqual([{ name: 'a', method: 'POST', path: '/x', scope: 'read' }])
    expect(parsed.nodes).toHaveLength(1)
  })

  it('scope 行归属最近的 cmd', () => {
    const text = [
      'htbp 0.1',
      'cmd a POST /x',
      '  scope read',
      'cmd b POST /y',
      '  scope call',
    ].join('\n')
    const parsed = parseHelpDsl(text)
    expect(parsed.cmds.map((c) => [c.name, c.scope])).toEqual([
      ['a', 'read'],
      ['b', 'call'],
    ])
  })

  it('缺失 scope 的 cmd:scope 为 undefined(不抛错)', () => {
    const parsed = parseHelpDsl('htbp 0.1\ncmd a POST /x')
    expect(parsed.cmds[0]?.scope).toBeUndefined()
  })

  it('容忍 CRLF 行尾', () => {
    const parsed = parseHelpDsl('htbp 0.1\r\nnode x mcp "x"\r\ncmd a POST /x\r\n  scope read\r\n')
    expect(parsed.htbp).toBe('0.1')
    expect(parsed.cmds[0]).toEqual({ name: 'a', method: 'POST', path: '/x', scope: 'read' })
  })

  it('renderHelpDsl 的输出可被 parseHelpDsl 往返', () => {
    const model: HelpModel = {
      node: { path: 'a', kind: 'directory', description: 'A' },
      cmds: [{ name: 'x', method: 'POST', path: '/a', scope: 'call' }],
      children: [{ path: 'a/b', kind: 'mcp', description: 'B' }],
    }
    const parsed = parseHelpDsl(renderHelpDsl(model))
    expect(parsed.cmds).toEqual([{ name: 'x', method: 'POST', path: '/a', scope: 'call' }])
    expect(parsed.nodes.map((n) => n.path)).toEqual(['a', 'a/b'])
  })
})
