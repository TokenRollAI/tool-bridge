import { z } from 'zod'
import { type KeyManagement, keyResumeSchema, keyRetireSchema, keyRotateSchema } from '../keyManagement'
import { BuiltinCommandRegistry } from './commandRegistry'

const commands = new BuiltinCommandRegistry<KeyManagement>('keys', '加密根、签名密钥与可恢复轮换（管理员）')
  .register('status', { inputSchema: z.strictObject({}), scope: 'admin', h: '查看密钥版本、引用和轮换进度，不含根材料', returns: 'KeyStatus' }, async (_, { deps }) => deps.status())
  .register('rotate', { inputSchema: keyRotateSchema, scope: 'admin', h: '维护窗口内生成新根；旧根默认保留，重加密可恢复', returns: 'KeyStatus' }, async (input, { deps }) => deps.rotate(input))
  .register('resume', { inputSchema: keyResumeSchema, scope: 'admin', h: '继续一批重加密任务，完成后检查旧密文引用', returns: 'KeyStatus' }, async (input, { deps }) => deps.resume(input))
  .register('retire', { inputSchema: keyRetireSchema, scope: 'admin', h: '仅在无引用且签名安全窗口已过后删除旧根', returns: 'KeyStatus' }, async (input, { deps }) => deps.retire(input))
  .register('backup', { inputSchema: z.strictObject({}), scope: 'admin', h: '显式导出包含密钥的实例恢复文件；请安全保存', returns: 'KeyBackup' }, async (_, { deps }) => deps.backup())

export const createKeysModule = (deps: KeyManagement) => commands.module(deps)
