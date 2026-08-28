/** Durable device mailbox HTTP control and device data planes. */

import {
  deviceOperationClaimRequestSchema,
  deviceOperationClaimResponseSchema,
  deviceOperationCompleteRequestSchema,
  deviceOperationDetailSchema,
  deviceOperationIdentityRequestSchema,
  deviceOperationListRequestSchema,
  deviceOperationListResponseSchema,
  deviceOperationRenewRequestSchema,
  deviceOperationRenewResponseSchema,
} from '@tool-bridge/core/protocol'
import {
  check,
  checkRegisterPath,
  type DeviceOperationAuthorizationTarget,
  type DeviceOperationCompletion,
  type DeviceOperationSummary,
  NodeRegistryStore,
  TBError,
  type TreeNode,
} from '@tool-bridge/core'
import type { AppContext } from '../deps'
import type { RouteEnv } from './env'
import { type DeviceNodeMarker, relativeDevicePath } from '../deviceNodes'

export const DEVICE_MAILBOX_IDEMPOTENCY_HEADER = 'x-tb-idempotency-key'
const DEVICE_MAILBOX_HTTP_BODY_BYTES = 272 * 1024
const DEVICE_MAILBOX_LIST_LIMIT_DEFAULT = 50
const DEVICE_MAILBOX_LIST_LIMIT_MAX = 200

function invalidRequest(message: string): TBError {
  return new TBError('invalid_argument', message)
}

export async function mailboxJsonObject(
  c: AppContext,
  opts: { allowEmpty?: boolean } = {},
): Promise<Record<string, unknown>> {
  const declaredLength = Number(c.req.header('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > DEVICE_MAILBOX_HTTP_BODY_BYTES) {
    throw new TBError('rate_limited', 'device mailbox request body is too large', {
      retryable: false,
    })
  }
  const reader = c.req.raw.body?.getReader()
  let raw = ''
  if (reader !== undefined) {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
    let received = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        received += chunk.value.byteLength
        if (received > DEVICE_MAILBOX_HTTP_BODY_BYTES) {
          await reader.cancel().catch(() => {})
          throw new TBError('rate_limited', 'device mailbox request body is too large', {
            retryable: false,
          })
        }
        raw += decoder.decode(chunk.value, { stream: true })
      }
      raw += decoder.decode()
    } catch (cause) {
      if (cause instanceof TBError) throw cause
      throw invalidRequest('body must be valid UTF-8 JSON')
    }
  }
  let parsed: unknown = opts.allowEmpty === true && raw === '' ? {} : null
  if (raw !== '') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidRequest('body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

function parseBody<T>(
  schema: { safeParse(value: unknown): { data: T, success: true } | { error: { issues: Array<{ message: string }> }, success: false } },
  body: unknown,
): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw invalidRequest(parsed.error.issues[0]?.message ?? 'invalid request')
  return parsed.data
}

export function deviceOperationTtlSeconds(url: URL): number | undefined {
  for (const key of url.searchParams.keys()) {
    if (key !== 'ttlSeconds') throw invalidRequest(`unknown enqueue query parameter '${key}'`)
  }
  const value = url.searchParams.get('ttlSeconds')
  if (value === null) return undefined
  if (!/^[1-9]\d*$/.test(value)) throw invalidRequest('ttlSeconds must be a positive integer')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw invalidRequest('ttlSeconds must be a safe integer')
  return parsed
}

function canManage(ctx: AppContext['var']['ctx'], operation: DeviceOperationSummary): boolean {
  return ctx.owner === operation.caller.owner || check(ctx, operation.targetPath, 'admin').allow
}

function assertCanManage(ctx: AppContext['var']['ctx'], operation: DeviceOperationSummary): void {
  if (!canManage(ctx, operation)) throw TBError.notFound('device operation not found')
}

async function assertCurrentDeviceCredential(
  c: AppContext,
  target: DeviceOperationAuthorizationTarget,
): Promise<void> {
  const ctx = c.get('ctx')
  if (ctx.keyId !== target.deviceKeyId) {
    throw new TBError('permission_denied', 'device credential does not own this operation')
  }
  let existing: { registeredBy: string } | null = null
  try {
    existing = await new NodeRegistryStore(c.get('store')).get(target.mountPath)
  } catch {
    existing = null
  }
  const allowed = checkRegisterPath({
    action: 'write',
    existing,
    sk: {
      id: ctx.keyId,
      scopes: ctx.scopes,
      ...(ctx.registerPaths === undefined ? {} : { registerPaths: ctx.registerPaths }),
    },
    targetPath: target.mountPath,
  })
  if (!allowed.allow) throw allowed.error
}

export interface EnqueueDeviceCommandInput {
  arguments: Record<string, unknown>
  command: string
  marker: DeviceNodeMarker
  node: TreeNode
  ttlSeconds?: number
}

/** 普通 invoke 的 mailbox/fallback 分支共用的权威入队动作。 */
export async function enqueueDeviceCommand(
  c: AppContext,
  env: RouteEnv,
  input: EnqueueDeviceCommandInput,
): Promise<Response> {
  const { arguments: args, command, marker, node } = input
  const ctx = c.get('ctx')
  const result = await env.mailbox().enqueue({
    arguments: args,
    caller: { keyId: ctx.keyId, owner: ctx.owner },
    deviceId: marker.deviceId,
    deviceKeyId: node.registeredBy,
    mountPath: marker.mountPath,
    // 管理面与审计链必须能区分同一 tool 节点下的不同命令；权限仍按前缀 scope 判定。
    targetPath: `${node.path}/${command}`,
    path: `${relativeDevicePath(node.path, marker.mountPath)}/${command}`,
    traceId: ctx.traceId,
    ...(c.req.header(DEVICE_MAILBOX_IDEMPOTENCY_HEADER) === undefined
      ? {}
      : { idempotencyKey: c.req.header(DEVICE_MAILBOX_IDEMPOTENCY_HEADER) }),
    ...(input.ttlSeconds === undefined ? {} : { ttlSeconds: input.ttlSeconds }),
  })
  const response = c.json(deviceOperationDetailSchema.parse(result), 202)
  response.headers.set('x-tb-delivery', 'mailbox')
  return response
}

export async function handleDeviceMailboxControl(c: AppContext, env: RouteEnv): Promise<Response> {
  const path = new URL(c.req.url).pathname.replace(/\/+$/, '')
  const body = await mailboxJsonObject(c)
  const mailbox = env.mailbox()
  const ctx = c.get('ctx')
  if (path === '/~device/operations/get') {
    const input = parseBody(deviceOperationIdentityRequestSchema, body)
    const result = await mailbox.get(input.deviceId, input.operationId)
    assertCanManage(ctx, result)
    return c.json(deviceOperationDetailSchema.parse(result))
  }
  if (path === '/~device/operations/list') {
    const input = parseBody(deviceOperationListRequestSchema, body)
    const limit = Math.min(
      input.opts?.limit ?? DEVICE_MAILBOX_LIST_LIMIT_DEFAULT,
      DEVICE_MAILBOX_LIST_LIMIT_MAX,
    )
    let cursor = input.opts?.cursor
    const items: DeviceOperationSummary[] = []
    // 底层 cursor 来自每设备的完整 keyspace，不能在过滤隐藏记录后原样回传，否则即使
    // items=[] 也会泄漏其他 owner 的记录数量。每次 raw page 不大于剩余可见容量，保证
    // resume cursor 永远位于最后一条已返回记录之后，不跳过可见 operation。
    while (items.length < limit) {
      const previous = cursor
      const page = await mailbox.list({
        deviceId: input.deviceId,
        limit: limit - items.length,
        ...(cursor === undefined ? {} : { cursor }),
        ...(input.opts?.states === undefined ? {} : { states: input.opts.states }),
      })
      items.push(...page.items.filter(item => canManage(ctx, item)))
      cursor = page.cursor
      if (cursor === undefined) {
        return c.json(deviceOperationListResponseSchema.parse({ items }))
      }
      if (cursor === previous) {
        throw new TBError('internal', 'device mailbox list cursor did not advance')
      }
    }

    const resumeCursor = cursor
    if (resumeCursor === undefined) {
      return c.json(deviceOperationListResponseSchema.parse({ items }))
    }
    // 只有确认后面还有至少一条当前调用方可见的记录才暴露续页信号。探测可以按大页
    // 前进；真正的下一页仍从 resumeCursor 开始，因此不会吞掉被探测到的记录。
    let probeCursor: string | undefined = resumeCursor
    while (probeCursor !== undefined) {
      const previous: string = probeCursor
      const page = await mailbox.list({
        deviceId: input.deviceId,
        cursor: probeCursor,
        limit: DEVICE_MAILBOX_LIST_LIMIT_MAX,
        ...(input.opts?.states === undefined ? {} : { states: input.opts.states }),
      })
      if (page.items.some(item => canManage(ctx, item))) {
        return c.json(deviceOperationListResponseSchema.parse({ items, cursor: resumeCursor }))
      }
      probeCursor = page.cursor
      if (probeCursor === previous) {
        throw new TBError('internal', 'device mailbox list cursor did not advance')
      }
    }
    return c.json(deviceOperationListResponseSchema.parse({ items }))
  }
  if (path === '/~device/operations/cancel') {
    const input = parseBody(deviceOperationIdentityRequestSchema, body)
    const current = await mailbox.get(input.deviceId, input.operationId)
    assertCanManage(ctx, current)
    return c.json(deviceOperationDetailSchema.parse(
      await mailbox.cancel(input.deviceId, input.operationId),
    ))
  }
  throw TBError.notFound('no such path')
}

export async function handleDeviceMailboxData(c: AppContext, env: RouteEnv): Promise<Response> {
  const path = new URL(c.req.url).pathname.replace(/\/+$/, '')
  const body = await mailboxJsonObject(c)
  const mailbox = env.mailbox()
  const ctx = c.get('ctx')
  const authorize = async (target: DeviceOperationAuthorizationTarget): Promise<void> =>
    await assertCurrentDeviceCredential(c, target)

  if (path === '/~device/mailbox/claim') {
    const input = parseBody(deviceOperationClaimRequestSchema, body)
    return c.json(deviceOperationClaimResponseSchema.parse(await mailbox.claim({
      ...input,
      deviceKeyId: ctx.keyId,
      authorize,
    })))
  }
  if (path === '/~device/mailbox/renew') {
    const input = parseBody(deviceOperationRenewRequestSchema, body)
    return c.json(deviceOperationRenewResponseSchema.parse(await mailbox.renew({
      ...input,
      deviceKeyId: ctx.keyId,
      authorize,
    })))
  }
  if (path === '/~device/mailbox/complete') {
    const input = parseBody(deviceOperationCompleteRequestSchema, body)
    let completion: DeviceOperationCompletion
    if (input.outcome === 'succeeded') {
      completion = { outcome: 'succeeded', result: input.result }
    } else if (input.outcome === 'result_unknown') {
      completion = {
        outcome: 'result_unknown',
        ...(input.error === undefined ? {} : { error: input.error }),
      }
    } else {
      completion = { outcome: input.outcome, error: input.error }
    }
    return c.json(deviceOperationDetailSchema.parse(await mailbox.complete({
      deviceId: input.deviceId,
      operationId: input.operationId,
      leaseId: input.leaseId,
      deviceKeyId: ctx.keyId,
      authorize,
    }, completion)))
  }
  throw TBError.notFound('no such path')
}
