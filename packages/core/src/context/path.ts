/**
 * Context entry 路径规范化与穿越拒绝(规范性:解析后必须仍在根内)。
 *
 * entry 路径是 namespace 内的相对路径('/' 分隔),与树路径(tree/path.ts)是两套
 * 规则:树路径拒绝保留段,entry 路径拒绝穿越。实现在 core,r2/s3 与
 * file provider 复用同一份判定。
 */

import { TBError } from '../errors'

/** C0 控制区(0x00-0x1f)与 DEL(0x7f);biome 禁止正则含控制字符,按码位判断。 */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function invalid(path: string, reason: string): TBError {
  return new TBError('invalid_argument', `非法 entry 路径 '${path}':${reason}`)
}

/** 对某一形态(原文或 percent-decode 后)做穿越检查;original 仅用于报错回显。 */
function assertNoTraversal(form: string, original: string): void {
  if (form.includes('\\')) throw invalid(original, '不允许反斜杠')
  if (hasControlChar(form)) throw invalid(original, '不允许控制字符')
  if (form.startsWith('/')) throw invalid(original, '不允许绝对路径(前导 /)')
  if (form.split('/').some(seg => seg === '..')) throw invalid(original, '不允许 \'..\' 段')
}

/**
 * 规范化 entry 路径:折叠重复 '/'、去尾 '/'、去 '.' 段,返回规范化相对路径。
 * 拒绝(invalid_argument):空串 / '..' 段 / 绝对路径 / 反斜杠 / 控制字符,
 * 以及 percent-decode 后再现的同类形态(如 '%2e%2e');解码失败(字面 '%')跳过复查。
 */
export function normalizeEntryPath(path: string): string {
  if (typeof path !== 'string' || path === '') throw invalid(path, '不能为空')
  assertNoTraversal(path, path)
  let decoded: string | null = null
  try {
    decoded = decodeURIComponent(path)
  } catch {
    // 名字里字面 '%'(如 "100%")合法:无法解码就没有编码穿越,跳过复查。
  }
  if (decoded !== null && decoded !== path) assertNoTraversal(decoded, path)
  const segs = path.split('/').filter(seg => seg !== '' && seg !== '.')
  if (segs.length === 0) throw invalid(path, '规范化后为空')
  return segs.join('/')
}

/** 尾 '/' 表示目录路径(List 的目录条目 uri 形态)。 */
export function isDirPath(path: string): boolean {
  return path.endsWith('/')
}
