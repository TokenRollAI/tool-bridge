export function encodeTreePath(path: string): string {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

export function isPathSegmentSafe(value: string): boolean {
  return !value.includes('/')
}
