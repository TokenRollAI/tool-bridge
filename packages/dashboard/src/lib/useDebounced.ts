import { useEffect, useState } from 'react'

/** 300ms 防抖(搜索/前缀输入 → 查询参数)。 */
export function useDebounced(value: string): string {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), 300)
    return () => clearTimeout(t)
  }, [value])
  return v
}
