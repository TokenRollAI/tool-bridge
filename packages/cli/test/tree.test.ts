import { describe, expect, it } from 'vitest'
import type { TreeJson } from '../src/types'
import { renderTree } from '../src/commands/tree'

describe('renderTree 缩进树渲染', () => {
  it('渲染层级缩进 + 描述', () => {
    const tree: TreeJson = {
      path: '',
      kind: 'directory',
      children: [
        {
          path: 'docs',
          kind: 'directory',
          description: 'docs subtree',
          children: [{ path: 'docs/context7', kind: 'mcp', description: 'Context7' }],
        },
        { path: 'system', kind: 'directory' },
      ],
    }
    expect(renderTree(tree)).toBe(
      [
        '/ (directory)',
        '  docs (directory) — docs subtree',
        '    docs/context7 (mcp) — Context7',
        '  system (directory)',
      ].join('\n'),
    )
  })

  it('标注 offline 与 truncated', () => {
    const tree: TreeJson = {
      path: 'device/x',
      kind: 'device',
      presence: { state: 'offline', lastSeenAt: '2026-01-01T00:00:00.000Z' },
      truncated: true,
    }
    expect(renderTree(tree)).toBe('device/x (device) [offline, truncated]')
  })

  it('presence stale 标注 stale', () => {
    const tree: TreeJson = {
      path: 'device/x',
      kind: 'device',
      presence: { state: 'stale', lastSeenAt: '2026-01-01T00:00:00.000Z' },
    }
    expect(renderTree(tree)).toBe('device/x (device) [stale]')
  })

  it('presence online 保持安静,不加 flag', () => {
    const tree: TreeJson = {
      path: 'device/x',
      kind: 'device',
      presence: { state: 'online', lastSeenAt: '2026-01-01T00:00:00.000Z' },
    }
    expect(renderTree(tree)).toBe('device/x (device)')
  })
})
