import { z } from 'zod'
import {
  type ConfigManagement,
  configUpdateSchema,
  revisionSchema,
  runtimeConfigSchema,
  storageActivateSchema,
  storageIdSchema,
  type StorageManagement,
  storageRevisionSchema,
  storageRotateSchema,
  storageWriteSchema,
} from '../managedConfig'
import { BuiltinCommandRegistry } from './commandRegistry'

const configCommands = new BuiltinCommandRegistry<ConfigManagement>('config', '实例配置与生效状态（管理员）')
  .register('schema', { inputSchema: z.strictObject({}), scope: 'admin', h: '配置目录、字段说明与默认值', returns: 'JSON Schema' }, async () => z.toJSONSchema(runtimeConfigSchema))
  .register('get', { inputSchema: z.strictObject({}), scope: 'admin', h: '读取期望值、实际值和 revision', returns: 'ConfigStatus' }, async (_, { deps }) => deps.get())
  .register('status', { inputSchema: z.strictObject({}), scope: 'admin', h: '检查配置应用状态', returns: 'ConfigStatus' }, async (_, { deps }) => deps.get())
  .register('validate', { inputSchema: runtimeConfigSchema, scope: 'admin', h: '校验完整候选配置', returns: 'RuntimeConfig' }, async input => input)
  .register('update', { inputSchema: configUpdateSchema, scope: 'admin', h: '按 revision 保存配置；尚未应用', returns: 'ConfigStatus' }, async (input, { deps }) => deps.update(input))
  .register('apply', { inputSchema: revisionSchema, scope: 'admin', h: '应用指定 revision 并检查实际状态', returns: 'ConfigStatus' }, async (input, { deps }) => deps.apply(input))

const storageCommands = new BuiltinCommandRegistry<StorageManagement>('storage', '对象存储后端、验证和默认上传目标（管理员）')
  .register('list', { inputSchema: z.strictObject({}), scope: 'admin', h: '列出默认与历史存储后端', returns: 'Page<StorageBackendView>' }, async (_, { deps }) => deps.list())
  .register('get', { inputSchema: storageIdSchema, scope: 'admin', h: '读取后端状态，不回显凭证', returns: 'StorageBackendView' }, async (input, { deps }) => deps.get(input))
  .register('write', { inputSchema: storageWriteSchema, scope: 'admin', h: '创建未启用的后端，凭证只写入加密保管库', returns: 'StorageBackendView' }, async (input, { deps }) => deps.write(input))
  .register('test', { inputSchema: storageRevisionSchema, scope: 'admin', h: '验证实际读写和条件写能力', returns: 'StorageBackendView' }, async (input, { deps }) => deps.test(input))
  .register('activate', { inputSchema: storageActivateSchema, scope: 'admin', h: '设为新上传默认值；旧对象保留原后端', returns: 'StorageBackendView' }, async (input, { deps }) => deps.activate(input))
  .register('update', { inputSchema: storageRotateSchema, scope: 'admin', h: '验证并轮换凭证，位置不变', returns: 'StorageBackendView' }, async (input, { deps }) => deps.update(input))
  .register('delete', { inputSchema: storageRevisionSchema, scope: 'admin', h: '删除没有对象或 Context 引用的非默认后端', returns: '{ok:true}' }, async (input, { deps }) => deps.delete(input))

export const createConfigModule = (deps: ConfigManagement) => configCommands.module(deps)
export const createStorageModule = (deps: StorageManagement) => storageCommands.module(deps)
