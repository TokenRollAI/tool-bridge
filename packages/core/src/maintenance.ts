import { z } from 'zod'

const revision = z.number().int().nonnegative()
const databaseUrl = z.string().min(1).max(8192)
export const databaseMigrationSchema = z.strictObject({
  expectedRevision: revision,
  expectedInstanceId: z.string().min(1),
  databaseUrl,
})
export const databaseCredentialRotationSchema = z.strictObject({
  databaseAdminUrl: databaseUrl.optional(),
  expectedRevision: revision,
  expectedInstanceId: z.string().min(1),
  password: z.string().min(24).max(4096),
})
export const redisMaintenanceSchema = z.strictObject({
  expectedRevision: revision,
  redisUrl: z.string().min(1).max(8192).nullable(),
})

export interface MaintenanceJournal {
  lastError?: string
  operation: 'database' | 'database_credentials' | 'redis'
  phase: 'running' | 'failed' | 'complete'
  startedAt: string
  step: string
}
export interface MaintenanceStatus {
  database: { host: string, name: string, port: number, user: string }
  journal?: MaintenanceJournal
  redisConfigured: boolean
  revision: number
}
export interface MaintenanceManagement {
  database(
    input: z.infer<typeof databaseMigrationSchema>,
  ): Promise<MaintenanceStatus>
  redis(
    input: z.infer<typeof redisMaintenanceSchema>,
  ): Promise<MaintenanceStatus>
  rotate_database_credentials(
    input: z.infer<typeof databaseCredentialRotationSchema>,
  ): Promise<MaintenanceStatus>
  status(): Promise<MaintenanceStatus>
}
