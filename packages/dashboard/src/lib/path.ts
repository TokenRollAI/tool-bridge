export function encodeTreePath(path: string): string {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

/**
 * `encodeTreePath` 的逆:逐段 `decodeURIComponent`。
 *
 * 必须逐段解码而非整串:整串解码会把编码过的 `%2F` 还原成 `/` 被误当分隔符,与服务端
 * `decodePath` 的逐段口径不一致。单段畸形(如落单的 `%`)时回退原文,不抛 —— deep-link
 * 里的畸形串宁可原样透传给上游按 404 处理,也不能让整个路由解析崩掉。
 */
export function decodeTreePath(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join('/')
}

export function isPathSegmentSafe(value: string): boolean {
  return !value.includes('/')
}
