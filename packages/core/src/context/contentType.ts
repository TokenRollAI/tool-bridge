/**
 * contentType 的统一校验与规范化(单一实现)。
 *
 * Store 上传(objectStoreService/service)与 context 的 create_upload
 * (context/objectProvider)共用:非空字符串、长度 ≤255、必须含 '/'、
 * 不得含 CR/LF/NUL;通过后 trim 并小写(MIME type 大小写不敏感,统一小写
 * 保证存储比较与签名一致)。错误文案由调用方给出以保留各自的高信息量提示。
 */

import { TBError } from '../errors'

export function normalizeContentType(value: unknown, message: string): string {
  if (
    typeof value !== 'string'
    || value.trim() === ''
    || value.length > 255
    || !value.includes('/')
    || /[\r\n\0]/.test(value)
  ) {
    throw new TBError('invalid_argument', message)
  }
  return value.trim().toLowerCase()
}
