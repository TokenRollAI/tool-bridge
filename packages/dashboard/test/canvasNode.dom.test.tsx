import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReactFlowProvider } from '@xyflow/react'
import type { FlowNodeData } from '@/canvas/treeGraph'
import { CanvasNode } from '@/canvas/CanvasNode'

/**
 * 画布节点的真实渲染证据:kind 图标框、子节点计数、truncated 懒加载提示、
 * remote 标识都要出现。CanvasNode 需在 ReactFlowProvider 内渲染(用到 Handle)。
 */

function renderNode(data: Partial<FlowNodeData>) {
  const full: FlowNodeData = {
    role: 'tree',
    label: 'tavily',
    path: 'tools/tavily',
    kind: 'tool',
    description: 'search',
    depth: 1,
    truncated: false,
    remoteScope: false,
    expanded: false,
    childCount: 0,
    childPaths: [],
    canLoadCommands: true,
    canMountChild: true,
    canUnmountSelf: true,
    virtualRoot: false,
    ...data,
  }
  return render(
    <ReactFlowProvider>
      <CanvasNode
        data={full as unknown as Record<string, unknown>}
        dragging={false}
        id={full.path}
        isConnectable={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        selected={false}
        type="tbNode"
        zIndex={0}
      />
    </ReactFlowProvider>,
  )
}

afterEach(cleanup)

describe('CanvasNode 渲染', () => {
  it('展示节点短名与子节点计数', () => {
    renderNode({ childCount: 3 })
    expect(screen.getByText('tavily')).toBeTruthy()
    expect(screen.getByText(/3/)).toBeTruthy()
    expect(screen.getByText(/子节点/)).toBeTruthy()
  })

  it('truncated 节点提供可访问的展开按钮', () => {
    renderNode({ truncated: true, childCount: 0 })
    expect(screen.getByRole('button', { name: '展开 tools/tavily' }).getAttribute('aria-expanded'))
      .toBe('false')
  })

  it('remote 节点显示 REMOTE 标识', () => {
    renderNode({ kind: 'remote', remoteScope: true, label: 'peer' })
    expect(screen.getByText('REMOTE')).toBeTruthy()
  })

  it('直接展示用途，并把详情/新增/删除快捷动作交给画布', () => {
    const onAction = vi.fn()
    renderNode({ description: '搜索公开网页', onAction })

    expect(screen.getByText('搜索公开网页')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看 tools/tavily 详情' }))
    fireEvent.click(screen.getByRole('button', { name: '在 tools/tavily 下挂载节点' }))
    fireEvent.click(screen.getByRole('button', { name: '卸载 tools/tavily' }))

    expect(onAction.mock.calls).toEqual([['inspect'], ['add'], ['delete']])
  })

  it('实体工具可按需直接显示命令', () => {
    const onAction = vi.fn()
    renderNode({ onAction })

    const button = screen.getByRole('button', { name: '显示 tools/tavily 的命令' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(onAction).toHaveBeenCalledWith('commands')
  })

  it('命令叶使用调用动作且不暴露挂载操作', () => {
    const onCommandAction = vi.fn()
    renderNode({
      role: 'command',
      label: 'search',
      commandName: 'search',
      commandPath: 'tools/tavily/search',
      commandScope: 'call',
      canLoadCommands: false,
      canMountChild: false,
      canUnmountSelf: false,
      onAction: onCommandAction,
    })
    fireEvent.click(screen.getByRole('button', { name: '调用 search' }))
    expect(onCommandAction).toHaveBeenCalledWith('invoke')
    expect(screen.queryByRole('button', { name: /挂载节点/ })).toBeNull()
  })

  it('系统节点不提供新增或卸载快捷动作', () => {
    renderNode({
      path: 'system/registry',
      label: 'registry',
      kind: 'builtin',
      canMountChild: false,
      canUnmountSelf: false,
    })
    expect(screen.queryByRole('button', { name: /挂载节点/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /卸载 system\/registry/ })).toBeNull()
  })
})
