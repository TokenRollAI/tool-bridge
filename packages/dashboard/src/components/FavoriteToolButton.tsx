import { Star } from 'lucide-react'
import { toast } from 'sonner'
import { useFavorites } from '@/lib/useFavorites'
import { toggleFavorite } from '@/lib/favorites'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'

export function FavoriteToolButton({ path, tool }: { path: string, tool: string }) {
  const { favorites, scope } = useFavorites()
  const selected = favorites.some(item => item.path === path && item.tool === tool)
  return (
    <Button
      aria-label={`${selected ? '取消收藏' : '收藏'} ${tool}`}
      aria-pressed={selected}
      onClick={() => {
        if (toggleFavorite(scope, { path, tool }) === 'full') toast.error('最多收藏 50 个工具，请先移除不再使用的收藏')
      }}
      size="icon"
      title={selected ? '取消收藏' : '收藏到工作台'}
      variant="ghost"
    >
      <Star className={cn(selected && 'fill-primary/20 text-primary')} />
    </Button>
  )
}
