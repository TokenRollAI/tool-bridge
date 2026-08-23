import { useNavigate, useParams, useSearchParams } from 'react-router'
import { GitBranch, Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { AddToolWizard } from '@/components/add-tool/AddToolWizard'
import { MountDialog } from '@/pages/system/forms/MountDialog'
import { decodeTreePath, encodeTreePath } from '@/lib/path'
import { ConfirmAction } from '@/components/ConfirmAction'
import { useInvalidate, useInvoke } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { type CanvasActionTarget, TreeCanvas } from './TreeCanvas'
import { NodeInspector } from './NodeInspector'

function parentPath(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

/** 以 `/` 为总根的可点击路径，帮助用户建立主树 → 子树的层级感。 */
function CanvasBreadcrumb({
  selectedPath,
  onNavigate,
}: {
  onNavigate: (path: string) => void
  selectedPath: string | null
}) {
  const parts = selectedPath?.split('/').filter(Boolean) ?? []
  return (
    <nav
      aria-label="当前能力树路径"
      className="flex min-w-0 items-center gap-1 overflow-x-auto font-mono text-[11px]"
    >
      <GitBranch className="size-3.5 shrink-0 text-primary" />
      <button
        className={cn(
          'shrink-0 rounded px-1.5 py-1 transition-colors hover:bg-secondary hover:text-foreground',
          selectedPath === '' ? 'bg-primary/10 text-primary' : 'text-muted-foreground',
        )}
        onClick={() => onNavigate('')}
        type="button"
      >
        /
      </button>
      {parts.map((part, index) => {
        const path = parts.slice(0, index + 1).join('/')
        const active = path === selectedPath
        return (
          <span className="flex shrink-0 items-center gap-1" key={path}>
            <span aria-hidden className="text-muted-foreground/55">/</span>
            <button
              className={cn(
                'rounded px-1.5 py-1 transition-colors hover:bg-secondary hover:text-foreground',
                active ? 'bg-primary/10 text-primary' : 'text-muted-foreground',
              )}
              onClick={() => onNavigate(path)}
              type="button"
            >
              {part}
            </button>
          </span>
        )
      })}
    </nav>
  )
}

/**
 * 画布主页：`/` 总根 + 可展开子树 + 右侧 Inspector。
 * 选中态仍由 URL 驱动，快捷挂载/卸载只复用既有 registry 数据面。
 */
export function CanvasPage() {
  const { '*': splat } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const invoke = useInvoke()
  const invalidate = useInvalidate()
  const [mountTarget, setMountTarget] = useState<CanvasActionTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CanvasActionTarget | null>(null)
  // splat 是原始 pathname 片段(react-router 不替消费者解码);逐段解码回真实节点路径,
  // 再去尾斜杠。`undefined`(index 路由)= 未选中,不能塌成空串 —— 空串是根节点的合法路径。
  const selectedPath = splat === undefined ? null : decodeTreePath(splat).replace(/\/+$/, '')
  const selectedTool = searchParams.get('tool') ?? undefined
  const openCommandDirectory = searchParams.get('tab') === 'invoke'

  const select = useCallback(
    (path: string) => navigate(`/nodes/${encodeTreePath(path)}`),
    [navigate],
  )
  const close = useCallback(() => navigate('/'), [navigate])
  const openCommand = useCallback(
    (path: string, commandName: string) => {
      navigate(`/nodes/${encodeTreePath(path)}?tool=${encodeURIComponent(commandName)}`)
    },
    [navigate],
  )
  const openCommands = useCallback(
    (path: string) => navigate(`/nodes/${encodeTreePath(path)}?tab=invoke`),
    [navigate],
  )
  const onUnmounted = useCallback(
    (path: string) => {
      const parent = parentPath(path)
      navigate(parent === '' ? '/' : `/nodes/${encodeTreePath(parent)}`)
    },
    [navigate],
  )

  const quickUnmount = async () => {
    const target = deleteTarget
    if (!target) return
    try {
      await invoke.mutateAsync({
        commandPath: 'system/registry/delete',
        args: { path: target.path },
      })
      toast.success(`已卸载 ${target.path}`)
      await invalidate()
      if (
        selectedPath === target.path
        || selectedPath?.startsWith(`${target.path}/`) === true
      ) {
        onUnmounted(target.path)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '卸载节点失败')
      throw error
    }
  }

  const open = selectedPath !== null

  return (
    <div className="relative flex h-full min-h-0 bg-panel">
      <div className={cn('relative h-full min-w-0 flex-1', open && 'hidden lg:block')}>
        <TreeCanvas
          onAddChild={setMountTarget}
          onDelete={setDeleteTarget}
          onOpenCommand={openCommand}
          onOpenCommands={openCommands}
          onSelect={select}
          selectedPath={selectedPath}
        />

        <div className="absolute top-3 left-3 z-10 flex max-w-[calc(100%-5.5rem)] items-center gap-2 rounded-xl border bg-card/95 p-1.5 shadow-md backdrop-blur-sm">
          <AddToolWizard
            trigger={(
              <Button className="shrink-0" size="sm">
                <Plus />
                <span className="hidden sm:inline">添加工具</span>
              </Button>
            )}
          />
          <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
          <CanvasBreadcrumb onNavigate={select} selectedPath={selectedPath} />
        </div>

        <div className="pointer-events-none absolute bottom-3 left-14 z-10 hidden rounded-lg border bg-card/90 px-2.5 py-1.5 text-[10px] whitespace-nowrap text-muted-foreground shadow-sm xl:block">
          点击卡片查看详情 · 节点右侧可展开子树、命令或管理挂载
        </div>
      </div>

      {open && (
        <aside
          className={cn(
            'flex h-full w-full flex-col border-l bg-panel shadow-xl',
            'lg:w-[min(38rem,46vw)] lg:shrink-0',
          )}
        >
          <NodeInspector
            initialTool={selectedTool}
            initialView={openCommandDirectory ? 'invoke' : undefined}
            key={`${selectedPath}:${selectedTool ?? ''}:${openCommandDirectory ? 'invoke' : ''}`}
            onClose={close}
            onUnmounted={onUnmounted}
            path={selectedPath}
          />
        </aside>
      )}

      {mountTarget && (
        <MountDialog
          defaultPath={mountTarget.path === '' ? '' : `${mountTarget.path}/`}
          existingPaths={mountTarget.childPaths}
          hasUnloadedPaths={mountTarget.hasUnloadedPaths}
          key={mountTarget.path}
          onOpenChange={next => !next && setMountTarget(null)}
          open
          trigger={null}
        />
      )}

      <ConfirmAction
        actionLabel="确认卸载"
        description={(
          <div className="grid gap-2">
            <p>{deleteTarget?.description || '该节点没有提供说明。'}</p>
            <p>卸载后该子树不可见；空的中间目录将被回收。</p>
          </div>
        )}
        onConfirm={quickUnmount}
        onOpenChange={next => !next && setDeleteTarget(null)}
        open={deleteTarget !== null}
        title={`卸载 ${deleteTarget?.path ?? '节点'}?`}
      />
    </div>
  )
}
