/** 两棵 JSON 的第一处结构差异,报成 JSON 指针 + 两侧取值(用于定位 schema 分歧根因)。 */
export function firstDiff(left, right, path = '') {
  if (left === right) return null
  const bothObjects = left !== null && right !== null
    && typeof left === 'object' && typeof right === 'object'
    && Array.isArray(left) === Array.isArray(right)
  if (!bothObjects) return { path, left, right }
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
  for (const k of keys) {
    const d = firstDiff(left[k], right[k], `${path}/${k}`)
    if (d !== null) return d
  }
  return null
}
