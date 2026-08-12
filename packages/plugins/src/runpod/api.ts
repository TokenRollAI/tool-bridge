/**
 * Runpod 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/runpod/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取(平台经 authRef 注入,插件不自持),出站走 `guardedFetch`,
 * 错误抛 `TBError` 七码。
 *
 * Runpod 的两个特点决定了这里的形状:
 * - `/pods` 回的是**裸数组**,不是信封;整形后包成 `{pods}` 交给调用方。
 * - 生命周期接口(start/stop/restart/reset/delete)成功时回**空体**,没有可解析的 JSON;
 *   故不看响应内容,一律合成 `{podId,action,success:true}`。
 *
 * 与上游的有意偏离:上游 `createRunpodError` 把 404 压成 400(`notFoundAsInvalidInput`)、
 * 把 5xx 压成 502;这里把原始状态原样交给 `upstreamError` 统一归一 —— 找不到 Pod 就是
 * not_found,那正是调用方需要区分的信息。
 *
 * 一处 schema 与上游行为对不上的地方:五个生命周期 action 的 `podId` 在上游 action 定义
 * 里是 **optional**,但 executor 无条件要求它。schema 是生成的、不改,故这里保留运行时
 * 校验 —— 少了它会打出 `/pods//start`。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type {
  deletePodInput,
  getPodInput,
  listPodsInput,
  resetPodInput,
  restartPodInput,
  startPodInput,
  stopPodInput,
} from './schema'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'
import { guardedFetch } from '../_runtime/guardedFetch'

const SERVICE = 'runpod'
const API_BASE = 'https://rest.runpod.io/v1'

type Json = Record<string, unknown>
type QueryValue = boolean | number | string | readonly string[] | undefined

/** 上游 `optionalString` 的等价物:非字符串、或去空白后为空,都算缺失。 */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function record(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** 数组值重复同名键(与 rocketlane 的逗号拼接相反,这是 Runpod 自己的约定)。 */
function buildUrl(path: string, query: Record<string, QueryValue>): string {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item)
      continue
    }
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/**
 * 生命周期接口成功时回空体,故 `emptySuccess` 决定"空体算什么"。
 * 非 2xx 且解不出 JSON 时把原文塞进 `{message}`,留给错误消息提取 —— Runpod 的网关
 * 错误常是纯文本,丢掉它调用方就只剩一个状态码。
 */
async function readPayload(response: Response, emptySuccess: unknown): Promise<unknown> {
  const body = await response.text()
  if (body.trim() === '') return emptySuccess ?? {}
  try {
    return JSON.parse(body) as unknown
  } catch {
    if (!response.ok) return { message: body }
    throw upstreamError(502, 'Runpod returned invalid JSON')
  }
}

/** 错误体三种形状:纯文本、`{message|error|detail}`、以及嵌套的 `{error:{message|detail}}`。 */
function errorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return text(payload)
  const body = record(payload)
  if (body === undefined) return undefined
  const direct = text(body.message) ?? text(body.error) ?? text(body.detail)
  if (direct !== undefined) return direct
  const nested = record(body.error)
  return text(nested?.message) ?? text(nested?.detail)
}

interface RequestInput {
  emptySuccess?: unknown
  method?: 'DELETE' | 'GET' | 'POST'
  path: string
  query?: Record<string, QueryValue>
}

async function request(ctx: ProviderContext, input: RequestInput): Promise<unknown> {
  // 取凭证放在 try 外:它抛的是配置错误,不该被下面的传输失败兜底吞成 502。
  const apiKey = requireApiKey(ctx, SERVICE)

  let response: Response
  let payload: unknown
  try {
    response = await guardedFetch(buildUrl(input.path, input.query ?? {}), {
      method: input.method ?? 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    })
    payload = await readPayload(response, input.emptySuccess)
  } catch (error) {
    // readPayload 抛的已经是归一过的 TBError,不该被再包一层说成传输失败。
    if (error instanceof TBError) throw error
    // 传输层失败必须就地归一:漏出去的裸 Error 会被 plugin-sdk 抹成 "internal plugin error"
    // 500,把"上游不通/出网被拦"说成插件自身故障,还丢掉唯一有诊断价值的那句消息。
    throw upstreamError(502, error instanceof Error ? `Runpod request failed: ${error.message}` : 'Runpod request failed')
  }

  if (!response.ok) {
    throw upstreamError(response.status, errorMessage(payload) ?? `Runpod request failed with status ${response.status}`)
  }
  return payload
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
}

function objectArray(value: unknown): Json[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map(item => record(item)).filter((item): item is Json => item !== undefined)
}

/** 只留值为指定类型的键;整个字段不是对象才回 undefined(空对象仍然透出,与上游一致)。 */
function typedRecord<T extends 'number' | 'string'>(
  value: unknown,
  kind: T,
): Record<string, T extends 'number' ? number : string> | undefined {
  const input = record(value)
  if (input === undefined) return undefined
  return Object.fromEntries(
    Object.entries(input).filter(([, item]) => typeof item === kind),
  ) as Record<string, T extends 'number' ? number : string>
}

/** 白名单整形:上游 Pod 对象字段很多,只透出契约里声明过的那些,值为 undefined 的键剥掉。 */
function normalizePod(value: unknown): Json {
  const pod = record(value)
  if (pod === undefined) throw upstreamError(502, 'Runpod returned an invalid Pod payload')
  const id = text(pod.id)
  if (id === undefined) throw upstreamError(502, 'Runpod response is missing id')

  const normalized: Json = {
    id,
    name: text(pod.name),
    desiredStatus: text(pod.desiredStatus),
    image: text(pod.image),
    machineId: text(pod.machineId),
    endpointId: text(pod.endpointId),
    templateId: text(pod.templateId),
    publicIp: text(pod.publicIp),
    costPerHr: num(pod.costPerHr),
    adjustedCostPerHr: num(pod.adjustedCostPerHr),
    interruptible: bool(pod.interruptible),
    locked: bool(pod.locked),
    lastStartedAt: text(pod.lastStartedAt),
    lastStatusChange: text(pod.lastStatusChange),
    cpuFlavorId: text(pod.cpuFlavorId),
    vcpuCount: num(pod.vcpuCount),
    memoryInGb: num(pod.memoryInGb),
    containerDiskInGb: num(pod.containerDiskInGb),
    volumeInGb: num(pod.volumeInGb),
    volumeMountPath: text(pod.volumeMountPath),
    ports: stringArray(pod.ports),
    portMappings: typedRecord(pod.portMappings, 'number'),
    env: typedRecord(pod.env, 'string'),
    gpu: record(pod.gpu),
    machine: record(pod.machine),
    networkVolume: record(pod.networkVolume),
    savingsPlans: objectArray(pod.savingsPlans),
  }
  for (const [key, item] of Object.entries(normalized)) {
    if (item === undefined) delete normalized[key]
  }
  return normalized
}

/** 五个生命周期 action 共用:podId 必填(schema 标 optional,但少了它 URL 就残)。 */
function requirePodId(value: string | undefined): string {
  const podId = text(value)
  if (podId === undefined) throw new TBError('invalid_argument', 'podId is required')
  return podId
}

async function lifecycle(
  input: { podId?: string },
  ctx: ProviderContext,
  config: { action: string, method: 'DELETE' | 'POST', pathSuffix: string },
): Promise<Json> {
  const podId = requirePodId(input.podId)
  await request(ctx, {
    method: config.method,
    path: `/pods/${encodeURIComponent(podId)}${config.pathSuffix}`,
    emptySuccess: { podId, action: config.action, success: true },
  })
  return { podId, action: config.action, success: true }
}

export async function listPods(
  input: z.infer<typeof listPodsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: '/pods',
    query: {
      computeType: input.computeType,
      cpuFlavorId: input.cpuFlavorId,
      dataCenterId: input.dataCenterId,
      desiredStatus: input.desiredStatus,
      endpointId: input.endpointId,
      gpuTypeId: input.gpuTypeId,
      id: input.id,
      imageName: input.imageName,
      includeMachine: input.includeMachine,
      includeNetworkVolume: input.includeNetworkVolume,
      includeSavingsPlans: input.includeSavingsPlans,
      includeTemplate: input.includeTemplate,
      includeWorkers: input.includeWorkers,
      name: input.name,
      networkVolumeId: input.networkVolumeId,
      templateId: input.templateId,
    },
  })
  if (!Array.isArray(payload)) throw upstreamError(502, 'Runpod returned a non-array Pods payload')
  return { pods: payload.map(pod => normalizePod(pod)) }
}

export async function getPod(
  input: z.infer<typeof getPodInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const payload = await request(ctx, {
    path: `/pods/${encodeURIComponent(input.podId)}`,
    query: {
      includeMachine: input.includeMachine,
      includeNetworkVolume: input.includeNetworkVolume,
      includeSavingsPlans: input.includeSavingsPlans,
      includeTemplate: input.includeTemplate,
      includeWorkers: input.includeWorkers,
    },
  })
  return { pod: normalizePod(payload) }
}

export async function startPod(
  input: z.infer<typeof startPodInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return lifecycle(input, ctx, { action: 'start', method: 'POST', pathSuffix: '/start' })
}

export async function stopPod(
  input: z.infer<typeof stopPodInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return lifecycle(input, ctx, { action: 'stop', method: 'POST', pathSuffix: '/stop' })
}

export async function restartPod(
  input: z.infer<typeof restartPodInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return lifecycle(input, ctx, { action: 'restart', method: 'POST', pathSuffix: '/restart' })
}

export async function resetPod(
  input: z.infer<typeof resetPodInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return lifecycle(input, ctx, { action: 'reset', method: 'POST', pathSuffix: '/reset' })
}

export async function deletePod(
  input: z.infer<typeof deletePodInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return lifecycle(input, ctx, { action: 'delete', method: 'DELETE', pathSuffix: '' })
}
