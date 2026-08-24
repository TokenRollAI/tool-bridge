import {
  Download,
  FileUp,
  HardDrive,
  Info,
  Link2,
  Loader2,
  RefreshCw,
  Share2,
  Trash2,
  Unlink,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import type { StoreObjectDescriptor, StoreShareGrant } from '@/lib/types'
import {
  useInvalidate,
  useStoreDelete,
  useStoreObjects,
  useStoreRead,
  useStoreRevokeShare,
  useStoreShare,
  useStoreStat,
  useStoreUpload,
} from '@/lib/queries'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PaginationFooter } from '@/components/PaginationFooter'
import { ConfirmAction } from '@/components/ConfirmAction'
import { CopyButton } from '@/components/CopyButton'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function humanStoreSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KiB`
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MiB`
  return `${(size / 1024 ** 3).toFixed(2)} GiB`
}

function displayTime(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value
}

function ObjectFacts({ object }: { object: StoreObjectDescriptor }) {
  const facts = [
    ['URI', object.uri],
    ['类型', object.contentType],
    ['大小', `${humanStoreSize(object.size)} (${object.size} bytes)`],
    ['Owner', object.owner || '—'],
    ['Producer', object.producer || '—'],
    ['创建时间', displayTime(object.createdAt)],
    ['就绪时间', displayTime(object.readyAt)],
    ['到期时间', object.expiresAt ? displayTime(object.expiresAt) : '未设置'],
    ['来源 Call', object.originCallId || '—'],
    ['Checksum', object.checksum ? `${object.checksum.algorithm}:${object.checksum.value}` : '—'],
  ]
  return (
    <dl className="overflow-hidden rounded-lg border">
      {facts.map(([label, value]) => (
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] border-b last:border-b-0" key={label}>
          <dt className="border-r bg-muted/25 px-3 py-2 text-xs text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-all px-3 py-2 font-mono text-xs">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function StoreStatDialog({ uri, onClose }: { onClose: () => void, uri: string | null }) {
  const stat = useStoreStat(uri)
  return (
    <Dialog onOpenChange={open => !open && onClose()} open={uri !== null}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Store 对象详情</DialogTitle>
          <DialogDescription>稳定 URI 只表示对象身份；读取仍需当次授权。</DialogDescription>
        </DialogHeader>
        {stat.isPending && <Skeleton className="h-64 w-full" />}
        {stat.isError && (
          <EmptyState icon={Info} title="无法读取对象元数据" tone="danger">
            请检查当前 SK 的 Store read scope 与对象 owner。
          </EmptyState>
        )}
        {stat.data && <ObjectFacts object={stat.data} />}
      </DialogContent>
    </Dialog>
  )
}

function SharePanel({
  share,
  onRevoke,
  revoking,
}: {
  onRevoke: (shareId: string) => Promise<void>
  revoking: boolean
  share: StoreShareGrant
}) {
  return (
    <section className="mt-4 rounded-lg border border-primary/25 bg-primary/[0.035] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">短期分享已创建</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {share.shareId}
            {' · '}
            {displayTime(share.expiresAt)}
            {' '}
            到期
          </p>
        </div>
        <div className="flex gap-2">
          <CopyButton label="复制一次性分享链接" size="icon-sm" value={share.$ref} variant="outline" />
          <Button
            disabled={revoking}
            onClick={() => void onRevoke(share.shareId)}
            size="sm"
            variant="outline"
          >
            {revoking ? <Loader2 className="animate-spin" /> : <Unlink />}
            撤销
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        分享链接是 bearer secret，仅通过复制按钮交付；不会写入 toast、调用历史或浏览器 URL。
      </p>
    </section>
  )
}

export function StorePage() {
  const list = useStoreObjects()
  const upload = useStoreUpload()
  const read = useStoreRead()
  const shareMutation = useStoreShare()
  const revoke = useStoreRevokeShare()
  const remove = useStoreDelete()
  const invalidate = useInvalidate()
  const fileInput = useRef<HTMLInputElement>(null)
  const [statUri, setStatUri] = useState<string | null>(null)
  const [share, setShare] = useState<StoreShareGrant | null>(null)
  const [shareTtl, setShareTtl] = useState('3600')
  const [revokeId, setRevokeId] = useState('')
  const objects = list.data?.pages.flatMap(page => page.items) ?? []

  const refresh = async () => {
    await list.refetch()
  }

  const uploadFile = async (file: File) => {
    try {
      await upload.mutateAsync({ file })
      await invalidate('store-list')
      toast.success('对象已上传到 default Store')
    } catch {
      toast.error('Store 上传失败，请检查权限、大小上限或网络后重试')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const download = async (object: StoreObjectDescriptor) => {
    try {
      const grant = await read.mutateAsync(object.uri)
      const anchor = document.createElement('a')
      anchor.href = grant.$ref
      anchor.download = object.filename || 'download'
      anchor.rel = 'noreferrer'
      anchor.style.display = 'none'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      read.reset()
    } catch {
      toast.error('无法签发下载链接，请检查对象权限或是否已删除')
    }
  }

  const createShare = async (uri: string) => {
    const ttlSec = Number(shareTtl)
    if (!Number.isSafeInteger(ttlSec) || ttlSec < 1) {
      toast.error('分享 TTL 必须是正整数秒数')
      return
    }
    try {
      setShare(await shareMutation.mutateAsync({ uri, ttlSec }))
    } catch {
      toast.error('创建分享失败，请检查对象 owner 与 Store write scope')
    }
  }

  const revokeShare = async (shareId: string) => {
    try {
      await revoke.mutateAsync(shareId)
      if (share?.shareId === shareId) setShare(null)
      if (revokeId === shareId) setRevokeId('')
      toast.success('分享已撤销')
    } catch {
      toast.error('撤销分享失败，请核对 share id 与 owner 权限')
      throw new Error('revoke failed')
    }
  }

  const deleteObject = async (uri: string) => {
    try {
      await remove.mutateAsync(uri)
      if (share?.uri === uri) setShare(null)
      await invalidate('store-list', 'store-stat')
      toast.success('Store 对象已删除')
    } catch {
      toast.error('删除失败，请检查对象 owner 与 Store write scope')
      throw new Error('delete failed')
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <PageHeader
        actions={(
          <div className="flex gap-2">
            <Button disabled={list.isRefetching} onClick={() => void refresh()} size="sm" variant="outline">
              <RefreshCw className={list.isRefetching ? 'animate-spin' : ''} />
              刷新
            </Button>
            <Button disabled={upload.isPending} onClick={() => fileInput.current?.click()} size="sm">
              {upload.isPending ? <Loader2 className="animate-spin" /> : <FileUp />}
              上传对象
            </Button>
            <input
              className="hidden"
              onChange={event => event.target.files?.[0] && void uploadFile(event.target.files[0])}
              ref={fileInput}
              type="file"
            />
          </div>
        )}
        description="部署级私有对象存储。设备产物与普通附件不需要挂载 Context，也不暴露 bucket key 或磁盘路径。"
        eyebrow="SYSTEM / STORE"
        title="Default Store"
      />

      <section className="mt-6 grid gap-3 rounded-xl border bg-card/55 p-4 lg:grid-cols-[minmax(0,1fr)_12rem_auto] lg:items-end">
        <div>
          <label className="text-xs font-medium" htmlFor="share-ttl">分享有效期（秒）</label>
          <Input
            className="mt-1.5"
            id="share-ttl"
            min="1"
            onChange={event => setShareTtl(event.target.value)}
            type="number"
            value={shareTtl}
          />
        </div>
        <div>
          <label className="text-xs font-medium" htmlFor="revoke-share">撤销已有 share id</label>
          <Input
            className="mt-1.5 font-mono"
            id="revoke-share"
            onChange={event => setRevokeId(event.target.value)}
            placeholder="share_..."
            value={revokeId}
          />
        </div>
        <Button
          disabled={!revokeId.trim() || revoke.isPending}
          onClick={() => void revokeShare(revokeId.trim())}
          variant="outline"
        >
          <Unlink />
          撤销分享
        </Button>
      </section>

      {share && <SharePanel onRevoke={revokeShare} revoking={revoke.isPending} share={share} />}

      <section className="mt-4 overflow-hidden rounded-xl border bg-card/55">
        {list.isPending && (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {list.isError && (
          <EmptyState className="m-4" icon={HardDrive} title="无法加载 Store 对象" tone="danger">
            请检查当前 SK 的 system/store read scope 与网关状态。
          </EmptyState>
        )}
        {!list.isPending && !list.isError && objects.length === 0 && (
          <EmptyState className="m-4" icon={HardDrive} title="还没有 Store 对象">
            上传本地文件，或让远程设备通过 call.uploadObject 返回拍照、视频等产物。
          </EmptyState>
        )}
        {objects.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>对象</TableHead>
                  <TableHead>Owner / Producer</TableHead>
                  <TableHead>大小</TableHead>
                  <TableHead>就绪时间</TableHead>
                  <TableHead className="text-right">动作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {objects.map(object => (
                  <TableRow key={object.uri}>
                    <TableCell className="max-w-sm">
                      <p className="truncate text-sm font-medium" title={object.filename || object.uri}>
                        {object.filename || object.uri.slice('store://default/'.length)}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={object.uri}>
                        {object.contentType}
                        {' · '}
                        {object.uri}
                      </p>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <p>{object.owner || '—'}</p>
                      <p className="text-muted-foreground">{object.producer || '—'}</p>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{humanStoreSize(object.size)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{displayTime(object.readyAt)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button aria-label="查看对象详情" onClick={() => setStatUri(object.uri)} size="icon-sm" variant="ghost">
                          <Info />
                        </Button>
                        <Button aria-label="下载对象" disabled={read.isPending} onClick={() => void download(object)} size="icon-sm" variant="ghost">
                          <Download />
                        </Button>
                        <Button aria-label="创建分享" disabled={shareMutation.isPending} onClick={() => void createShare(object.uri)} size="icon-sm" variant="ghost">
                          <Share2 />
                        </Button>
                        <ConfirmAction
                          description={(
                            <span className="break-all">
                              对象
                              {object.uri}
                              {' '}
                              将立即不可读。
                            </span>
                          )}
                          onConfirm={() => deleteObject(object.uri)}
                          title="删除 Store 对象？"
                          trigger={(
                            <Button aria-label="删除对象" size="icon-sm" variant="ghost">
                              <Trash2 className="text-destructive" />
                            </Button>
                          )}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <PaginationFooter
          count={objects.length}
          hasNextPage={Boolean(list.hasNextPage)}
          isFetchingNextPage={list.isFetchingNextPage}
          onLoadMore={() => void list.fetchNextPage()}
          unit="个对象"
        />
      </section>

      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Link2 className="size-3.5" />
        store:// URI 是稳定身份，不是公开下载地址；读取和分享都会签发短期 capability。
      </p>
      <StoreStatDialog onClose={() => setStatUri(null)} uri={statUri} />
    </div>
  )
}
