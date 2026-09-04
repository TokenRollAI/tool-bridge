import { z } from 'zod'

export interface DeploymentSettings {
  bindAddress: '127.0.0.1' | '0.0.0.0'
  hostPort: number
  image: string
  stateDirectory?: string
  uiDirectory?: string
}
const directory = z.string().min(2).startsWith('/').refine(value => !/(?:^|\/)\.\.(?:\/|$)/.test(value) && !/^\/(?:etc|proc|sys|dev|var\/run)(?:\/|$)/.test(value), '请选择部署目录内的绝对路径')
export const deploymentSettingsSchema: z.ZodType<DeploymentSettings> = z.strictObject({
  image: z.string().min(1).max(512).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/).describe('应用镜像'),
  hostPort: z.number().int().min(1).max(65535).describe('宿主访问端口'),
  bindAddress: z.enum(['127.0.0.1', '0.0.0.0']).describe('监听范围'),
  stateDirectory: directory.optional().describe('宿主数据目录（可选）'),
  uiDirectory: directory.optional().describe('宿主管理界面目录（可选）'),
})
export const deploymentUpdateSchema = z.strictObject({ expectedRevision: z.number().int().nonnegative(), settings: deploymentSettingsSchema })
export const deploymentClaimSchema = z.strictObject({ agentId: z.string().min(1).max(128), instanceId: z.string().min(1), observed: deploymentSettingsSchema })
export const deploymentCompleteSchema = z.strictObject({ jobId: z.string().min(1), leaseToken: z.string().min(1), ok: z.boolean(), error: z.enum(['preflight_failed', 'apply_failed', 'health_failed', 'rollback_failed']).optional() })
export interface DeploymentJobView {
  createdAt: string
  error?: string
  id: string
  revision: number
  state: 'queued' | 'claimed' | 'succeeded' | 'failed'
}
export interface DeploymentStatus {
  agentConnected: boolean
  appliedRevision: number
  desired: DeploymentSettings | null
  effective: DeploymentSettings | null
  instanceId: string
  job?: DeploymentJobView
  revision: number
  state: 'unmanaged' | 'disconnected' | 'applied' | 'pending' | 'applying' | 'failed' | 'drifted'
}
export interface DeploymentClaim {
  desired: DeploymentSettings
  instanceId: string
  jobId: string
  leaseExpiresAt: string
  leaseToken: string
  previous: DeploymentSettings
  revision: number
}
export interface DeploymentManagement {
  claim(input: { agentId: string, instanceId: string, observed: DeploymentSettings }): Promise<{ job: DeploymentClaim | null }>
  complete(input: { error?: 'preflight_failed' | 'apply_failed' | 'health_failed' | 'rollback_failed', jobId: string, leaseToken: string, ok: boolean }): Promise<DeploymentStatus>
  get(): Promise<DeploymentStatus>
  update(input: { expectedRevision: number, settings: DeploymentSettings }): Promise<DeploymentStatus>
}
