/** Host-neutral runtime configuration contract; product values use the managed schema. */
export const DEFAULT_MAX_HOPS = 4

export interface RuntimeRemoteSettings {
  allowInsecure: boolean
  allowlist: string[]
  federatedSearch?: {
    maxConcurrency?: number
    maxResponseBodyBytes?: number
    maxSources?: number
    minChildWorkMs?: number
    perHopReturnReserveMs?: number
    sessionTtlMs?: number
    totalDeadlineMs?: number
  }
  instanceId?: string
  maxHops: number
}
