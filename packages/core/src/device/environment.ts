import { z } from 'zod'
import type { DeviceEnvironment } from '../types'

/** A small explicit allowlist: never accept arbitrary process/env metadata. */
export const deviceEnvironmentSchema: z.ZodType<DeviceEnvironment> = z.strictObject({
  platform: z.enum(['darwin', 'linux', 'win32', 'android', 'ios', 'other']),
  arch: z.string().min(1).max(32).regex(/^[a-zA-Z0-9._-]+$/).optional(),
  runtime: z.enum(['node', 'bun', 'react-native', 'other']).optional(),
  runtimeVersion: z.string().min(1).max(64).regex(/^[a-zA-Z0-9.+_-]+$/).optional(),
  runtimeId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/).optional(),
})
