import { extname } from 'node:path'

/**
 * 扩展名 → MIME 的唯一映射表。此前 ctx put / ctx upload / store upload 各持一份,
 * 覆盖不一致(同一个 .pdf 一处给 application/pdf、一处落到 octet-stream);
 * 这里取三表并集,冲突取更精确的 MIME。刻意不引 mime 库:CLI 只需要这十几个常见后缀,
 * 冷门类型走显式 --content-type。
 */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
}

/**
 * 按扩展名猜 contentType。fallback 由调用方定:二进制直传(ctx upload / store upload)
 * 用缺省 application/octet-stream(未知扩展名不冒充文本);ctx put 是文本写入通道 → text/plain。
 */
export function guessContentType(file: string, fallback = 'application/octet-stream'): string {
  return CONTENT_TYPE_BY_EXT[extname(file).toLowerCase()] ?? fallback
}
