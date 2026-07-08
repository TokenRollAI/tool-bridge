import { describe, expect, it } from 'vitest'
import { renderHelpMarkdown } from '../../src/htbp/helpMarkdown'
import type { HelpModel } from '../../src/htbp/model'

const mcpModel: HelpModel = {
  node: { path: 'docs/context7', kind: 'mcp', description: 'Context7 文档检索' },
  cmds: [
    {
      name: 'resolve-library-id',
      method: 'POST',
      path: '/docs/context7',
      h: '解析库 id。\n\n多行说明全文保留。',
      inputSchema: {
        type: 'object',
        properties: { libraryName: { type: 'string' } },
        required: ['libraryName'],
      },
      returns: 'markdown 文档库列表',
      scope: 'call',
    },
    {
      name: 'drop-db',
      method: 'POST',
      path: '/docs/context7',
      scope: 'write',
      effect: 'destructive',
      confirm: true,
    },
  ],
}

describe('renderHelpMarkdown:语义明确(不用单字符缩写)', () => {
  const md = renderHelpMarkdown(mcpModel)

  it('标题为节点路径,引言含 kind 与协议版本', () => {
    expect(md.startsWith('# /docs/context7\n')).toBe(true)
    expect(md).toContain('> HTBP 0.1 node · kind: `mcp`')
    expect(md).toContain('Context7 文档检索')
  })

  it('调用信封用完整语句 + 代码块解释(取代 DSL 的 body 单行)', () => {
    expect(md).toContain('## How to call')
    expect(md).toContain('POST /docs/context7')
    expect(md).toContain('{"tool": "<command name>", "arguments": {...}}')
    expect(md).toContain('permission your Secret Key must hold')
  })

  it('每 cmd 一节:标题、描述全文、Invoke/scope/returns 完整措辞', () => {
    expect(md).toContain('### `resolve-library-id`')
    expect(md).toContain('多行说明全文保留。')
    expect(md).toContain(
      '- Invoke: `POST /docs/context7` with body `{"tool": "resolve-library-id", "arguments": {...}}`',
    )
    expect(md).toContain('- Required scope: `call`')
    expect(md).toContain('- Returns: markdown 文档库列表')
  })

  it('inputSchema 以缩进 JSON 代码块呈现', () => {
    expect(md).toContain('Arguments (JSON Schema of the `arguments` field):')
    expect(md).toContain('"libraryName": {')
  })

  it('destructive + confirm → 明确的"先向用户确认"警示', () => {
    expect(md).toContain('- Effect: `destructive` — **ask the user to confirm before calling**')
  })

  it('全量形态下无 schema 的 cmd → Arguments: none declared', () => {
    expect(md).toContain('- Arguments: none declared')
  })
})

describe('renderHelpMarkdown:使用路径清晰(索引形态与 children)', () => {
  it('index 模型:hint 渲染为 Next step 引言,无 schema 的 cmd 给出下钻 GET 路径', () => {
    const m: HelpModel = {
      node: { path: 'logs', kind: 'mcp', description: 'SLS' },
      cmds: [{ name: 'explore', method: 'POST', path: '/logs', h: '概览', scope: 'call' }],
      index: true,
      hint: "this is an index; GET /logs/<tool>/~help returns one tool's full spec",
    }
    const md = renderHelpMarkdown(m)
    expect(md).toContain('> **Next step**: this is an index')
    expect(md).toContain('- Arguments: schema not shown in this index — `GET /logs/explore/~help`')
  })

  it('directory 模型:children 表格 + 下钻提示;空描述显示 —', () => {
    const m: HelpModel = {
      node: { path: '', kind: 'directory', description: 'tool-bridge root' },
      cmds: [],
      children: [
        { path: 'system', kind: 'directory', description: 'Platform admin' },
        { path: 'device', kind: 'directory', description: '' },
      ],
    }
    const md = renderHelpMarkdown(m)
    expect(md).toContain('# /\n')
    expect(md).toContain('| Path | Kind | Description |')
    expect(md).toContain('| `system` | directory | Platform admin |')
    expect(md).toContain('| `device` | directory | — |')
    expect(md).toContain('Fetch `GET /<path>/~help` to learn how to use a child node.')
  })

  it('表格单元格描述折叠单行并转义竖线', () => {
    const m: HelpModel = {
      node: { path: 'a', kind: 'directory', description: 'A' },
      cmds: [],
      children: [{ path: 'a/b', kind: 'http', description: '第一行|带竖线\n第二行' }],
    }
    expect(renderHelpMarkdown(m)).toContain('| `a/b` | http | 第一行\\|带竖线 第二行 |')
  })

  it('无 cmd 无 children → 显式说明', () => {
    const m: HelpModel = { node: { path: 'x', kind: 'directory', description: '' }, cmds: [] }
    expect(renderHelpMarkdown(m)).toContain('This node exposes no commands and no child nodes.')
  })

  it('flatBody(直连工具路径):body 即 arguments 本体,下钻路径不重复工具段', () => {
    const m: HelpModel = {
      node: { path: 'docs/x', kind: 'mcp', description: 'X' },
      cmds: [
        {
          name: 'echo',
          method: 'POST',
          path: '/docs/x/echo',
          h: '回显',
          scope: 'call',
          flatBody: true,
        },
      ],
      index: true,
      hint: 'index',
    }
    const md = renderHelpMarkdown(m)
    expect(md).toContain('Each command has its own direct URL')
    expect(md).toContain('- Invoke: `POST /docs/x/echo` with body `{...arguments}`')
    expect(md).toContain('- Arguments: schema not shown in this index — `GET /docs/x/echo/~help`')
    expect(md).not.toContain('/docs/x/echo/echo')
  })
})
