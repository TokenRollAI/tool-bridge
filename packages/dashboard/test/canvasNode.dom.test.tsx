import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ReactFlowProvider } from '@xyflow/react'
import type { FlowNodeData } from '@/canvas/treeGraph'
import { CanvasNode } from '@/canvas/CanvasNode'

/**
 * 画布节点的真实渲染证据:kind 图标框、子节点计数、truncated 懒加载提示、
 * remote 标识都要出现。CanvasNode 需在 ReactFlowProvider 内渲染(用到 Handle)。
 */

function renderNode(data: Partial<FlowNodeData>) {
  const full: FlowNodeData = {
    label: 'tavily',
    path: 'tools/tavily',
    kind: 'tool',
    description: 'search',
    depth: 1,
    truncated: false,
    remoteScope: false,
    expanded: false,
    childCount: 0,
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

  it('truncated 且无已加载子节点 → 展示"展开加载"入口', () => {
    renderNode({ truncated: true, childCount: 0 })
    expect(screen.getByText('展开加载')).toBeTruthy()
  })

  it('remote 节点显示 REMOTE 标识', () => {
    renderNode({ kind: 'remote', remoteScope: true, label: 'peer' })
    expect(screen.getByText('REMOTE')).toBeTruthy()
  })
})
