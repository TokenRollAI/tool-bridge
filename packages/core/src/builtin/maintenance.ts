import { z } from 'zod'
import {
  databaseCredentialRotationSchema,
  databaseMigrationSchema,
  type MaintenanceManagement,
  redisMaintenanceSchema,
} from '../maintenance'
import { BuiltinCommandRegistry } from './commandRegistry'

const commands = new BuiltinCommandRegistry<MaintenanceManagement>(
  'maintenance',
  '数据库与 Redis 专项维护（管理员）',
)
  .register(
    'status',
    {
      inputSchema: z.strictObject({}),
      scope: 'admin',
      h: '维护阶段及已脱敏的连接状态',
      returns: 'MaintenanceStatus',
    },
    async (_, { deps }) => deps.status(),
  )
  .register(
    'database',
    {
      inputSchema: databaseMigrationSchema,
      scope: 'admin',
      h: '停写并备份迁移至空 PostgreSQL；验证后切换',
      returns: 'MaintenanceStatus',
    },
    async (input, { deps }) => deps.database(input),
  )
  .register(
    'redis',
    {
      inputSchema: redisMaintenanceSchema,
      scope: 'admin',
      h: '验证 Redis 读写与通知后切换，null 停用',
      returns: 'MaintenanceStatus',
    },
    async (input, { deps }) => deps.redis(input),
  )
  .register(
    'rotate_database_credentials',
    {
      inputSchema: databaseCredentialRotationSchema,
      scope: 'admin',
      h: '验证新登录角色后切换，停用原登录身份',
      returns: 'MaintenanceStatus',
    },
    async (input, { deps }) => deps.rotate_database_credentials(input),
  )

export const createMaintenanceModule = (deps: MaintenanceManagement) =>
  commands.module(deps)
