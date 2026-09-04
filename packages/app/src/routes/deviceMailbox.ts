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
  isTBError,
  NodeRegistryStore,
  TBError,
  type TreeNode,
} from '@tool-bridge/core'
import type { AppContext, TbHono } from '../deps'
import type { RouteEnv } from './env'
import { type DeviceNodeMarker, relativeDevicePath } from '../deviceNodes'
import { runHandler } from '../responses'

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
      if (isTBError(cause)) throw cause
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
  reservedRoots: string[] | undefined,
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
    ...(reservedRoots === undefined ? {} : { reservedRoots }),
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

// ---------- 控制面(调用方管理自己发起的 operation;可见性按发起者/admin 裁剪)----------

async function getOperation(c: AppContext, env: RouteEnv): Promise<Response> {
  const input = parseBody(deviceOperationIdentityRequestSchema, await mailboxJsonObject(c))
  const result = await env.mailbox().get(input.deviceId, input.operationId)
  assertCanManage(c.get('ctx'), result)
  return c.json(deviceOperationDetailSchema.parse(result))
}

async function listOperations(c: AppContext, env: RouteEnv): Promise<Response> {
  const input = parseBody(deviceOperationListRequestSchema, await mailboxJsonObject(c))
  const mailbox = env.mailbox()
  const ctx = c.get('ctx')
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

async function cancelOperation(c: AppContext, env: RouteEnv): Promise<Response> {
  const input = parseBody(deviceOperationIdentityRequestSchema, await mailboxJsonObject(c))
  const mailbox = env.mailbox()
  const current = await mailbox.get(input.deviceId, input.operationId)
  assertCanManage(c.get('ctx'), current)
  return c.json(deviceOperationDetailSchema.parse(
    await mailbox.cancel(input.deviceId, input.operationId),
  ))
}

// ---------- 数据面(设备凭证拉取/续租/回执;每次都重验凭证与 mount 授权)----------

function deviceAuthorize(
  c: AppContext,
  env: RouteEnv,
): (target: DeviceOperationAuthorizationTarget) => Promise<void> {
  return async target => await assertCurrentDeviceCredential(c, target, env.deps.reservedRoots)
}

async function claimOperations(c: AppContext, env: RouteEnv): Promise<Response> {
  const input = parseBody(deviceOperationClaimRequestSchema, await mailboxJsonObject(c))
  return c.json(deviceOperationClaimResponseSchema.parse(await env.mailbox().claim({
    ...input,
    deviceKeyId: c.get('ctx').keyId,
    authorize: deviceAuthorize(c, env),
  })))
}

async function renewLeases(c: AppContext, env: RouteEnv): Promise<Response> {
  const input = parseBody(deviceOperationRenewRequestSchema, await mailboxJsonObject(c))
  return c.json(deviceOperationRenewResponseSchema.parse(await env.mailbox().renew({
    ...input,
    deviceKeyId: c.get('ctx').keyId,
    authorize: deviceAuthorize(c, env),
  })))
}

async function completeOperation(c: AppContext, env: RouteEnv): Promise<Response> {
  const input = parseBody(deviceOperationCompleteRequestSchema, await mailboxJsonObject(c))
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
  return c.json(deviceOperationDetailSchema.parse(await env.mailbox().complete({
    deviceId: input.deviceId,
    operationId: input.operationId,
    leaseId: input.leaseId,
    deviceKeyId: c.get('ctx').keyId,
    authorize: deviceAuthorize(c, env),
  }, completion)))
}

/**
 * mailbox 六条端点都是三段字面量固定路径,直接注册为固定路由(Hono 只有
 * `/:path{.*}/~x` 具名后缀形式对 3+ 段不匹配,字面量路由没有这个限制),
 * 不再挤在 POST 通配里做 startsWith 分派。注册顺序:auth 中间件之后、POST 通配之前。
 * 未知 /~device/** 子路径落入通配,由 handleInvoke 的保留段校验拒绝(同码 404)。
 */
export function registerDeviceMailboxRoutes(app: TbHono, env: RouteEnv): void {
  app.post('/~device/operations/get', c => runHandler(async () => await getOperation(c, env)))
  app.post('/~device/operations/list', c => runHandler(async () => await listOperations(c, env)))
  app.post('/~device/operations/cancel', c =>
    runHandler(async () => await cancelOperation(c, env)))
  app.post('/~device/mailbox/claim', c => runHandler(async () => await claimOperations(c, env)))
  app.post('/~device/mailbox/renew', c => runHandler(async () => await renewLeases(c, env)))
  app.post('/~device/mailbox/complete', c =>
    runHandler(async () => await completeOperation(c, env)))
}
