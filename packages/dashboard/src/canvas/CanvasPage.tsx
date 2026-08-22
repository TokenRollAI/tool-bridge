import { useNavigate, useParams } from 'react-router'
import { useCallback } from 'react'
import { Plus } from 'lucide-react'
import { AddToolWizard } from '@/components/add-tool/AddToolWizard'
import { Button } from '@/components/ui/button'
import { encodeTreePath } from '@/lib/path'
import { cn } from '@/lib/utils'
import { NodeInspector } from './NodeInspector'
import { TreeCanvas } from './TreeCanvas'

/**
 * 画布主页:左侧工作树画布 + 右侧 Inspector 抽屉。
 *
 * 选中态由 URL 驱动(`/nodes/<path>`),因此命令面板跳转、deep-link、浏览器前进后退
 * 都能定位到画布上的节点并打开对应 Inspector —— 与旧 NodePage 的 deep-link 契约一致。
 * 根路径 `/` 不选中任何节点(画布全景)。
 */
export function CanvasPage() {
  const { '*': splat } = useParams()
  const navigate = useNavigate()
  const selectedPath = splat === undefined ? null : splat.replace(/\/+$/, '')

  const select = useCallback(
    (path: string) => navigate(`/nodes/${encodeTreePath(path)}`),
    [navigate],
  )
  const close = useCallback(() => navigate('/'), [navigate])
  const onUnmounted = useCallback(
    (path: string) => {
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      navigate(parent === '' ? '/' : `/nodes/${encodeTreePath(parent)}`)
    },
    [navigate],
  )

  const open = selectedPath !== null

  return (
    <div className="relative flex h-full min-h-0">
      <div className={cn('relative h-full min-w-0 flex-1', open && 'hidden lg:block')}>
        <TreeCanvas onSelect={select} selectedPath={selectedPath} />
        <div className="absolute top-3 left-3 z-10">
          <AddToolWizard
            trigger={(
              <Button className="shadow-md" size="sm">
                <Plus />
                添加工具
              </Button>
            )}
          />
        </div>
      </div>

      {open && (
        <aside
          className={cn(
            'flex h-full w-full flex-col border-l shadow-xl',
            'lg:w-[min(30rem,42vw)] lg:shrink-0',
          )}
        >
          <NodeInspector
            key={selectedPath}
            onClose={close}
            onUnmounted={onUnmounted}
            path={selectedPath}
          />
        </aside>
      )}
    </div>
  )
}
