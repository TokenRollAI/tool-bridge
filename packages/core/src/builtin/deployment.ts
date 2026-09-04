import { z } from 'zod'
import { deploymentClaimSchema, deploymentCompleteSchema, type DeploymentManagement, deploymentSettingsSchema, deploymentUpdateSchema } from '../deployment'
import { BuiltinCommandRegistry } from './commandRegistry'

const commands = new BuiltinCommandRegistry<DeploymentManagement>('deployment', '部署执行器、期望配置与实际生效状态（管理员）')
  .register('schema', { inputSchema: z.strictObject({}), scope: 'admin', h: '查询部署设置字段', returns: 'JSON Schema' }, async () => z.toJSONSchema(deploymentSettingsSchema))
  .register('get', { inputSchema: z.strictObject({}), scope: 'admin', h: '读取部署配置与执行器状态', returns: 'DeploymentStatus' }, async (_, { deps }) => deps.get())
  .register('status', { inputSchema: z.strictObject({}), scope: 'admin', h: '核对部署任务与已应用版本', returns: 'DeploymentStatus' }, async (_, { deps }) => deps.get())
  .register('update', { inputSchema: deploymentUpdateSchema, scope: 'admin', h: '保存配置并创建白名单部署任务', returns: 'DeploymentStatus' }, async (input, { deps }) => deps.update(input))
  .register('claim', { inputSchema: deploymentClaimSchema, scope: 'admin', h: '本机执行器独占领取固定部署任务', returns: '{job:DeploymentClaim|null}' }, async (input, { deps }) => deps.claim(input))
  .register('complete', { inputSchema: deploymentCompleteSchema, scope: 'admin', h: '提交实例检查或恢复结果', returns: 'DeploymentStatus' }, async (input, { deps }) => deps.complete(input))

export const createDeploymentModule = (deps: DeploymentManagement) => commands.module(deps)
