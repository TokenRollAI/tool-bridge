/**
 * device 节点:通道取用、帧协议 call 转发,以及"这个节点是不是设备代注册产物"的标记判定。
 * 传输实现由宿主注入(CF = DeviceSession DO / Node = 进程内 ws),这里只认 DeviceChannel。
 */
import {
  type CallContext,
  DEVICE_CALL_TIMEOUT_MS,
  type DeviceCallContext,
  type DeviceCallResult,
  TBError,
  type TBErrorBody,
  type ToolSpec,
  type TreeNode,
  type TreePath,
} from '@tool-bridge/core'
import type { DeviceChannel, TbAppDeps } from './deps'
import { issueDeviceCallUpload } from './store'

// ---------- device 节点 ----------

export function tbErrorFromBody(body: TBErrorBody): TBError {
  return new TBError(body.code, body.message, { retryable: body.retryable })
}

/** 设备通道缺省(deviceTransport 未注入)→ device 能力禁用。 */
export function requireDevice(deps: TbAppDeps): DeviceChannel {
  if (deps.device === undefined) {
    throw TBError.unimplemented('device capability disabled: no device transport')
  }
  return deps.device
}

export async function invokeDevice(
  deps: TbAppDeps,
  deviceId: string,
  req: { arguments: Record<string, unknown>, context?: DeviceCallContext, path: string },
): Promise<unknown> {
  const id = crypto.randomUUID()
  const upload = req.context === undefined
    ? null
    : await issueDeviceCallUpload(deps, deviceId, id, req.context)
  let body: DeviceCallResult
  try {
    body = (await requireDevice(deps).invoke(deviceId, {
      id,
      path: req.path,
      arguments: req.arguments,
      ...(req.context === undefined ? {} : { context: upload?.context ?? req.context }),
    })) as DeviceCallResult
  } finally {
    // A returned/cancelled call must not leave its create capability replayable.
    // Revocation is best effort: expiry remains the hard backstop and cleanup
    // will converge state even if the call's final network hop failed.
    await upload?.revoke().catch(() => {})
  }
  if (!body || !('ok' in body)) {
    throw new TBError('unavailable', 'device session returned invalid result')
  }
  if (body.ok) return body.value
  throw tbErrorFromBody(body.error)
}

/**
 * 从鉴权后的 CallContext 构造下发给设备的 DeviceCallContext。
 *
 * 只读取网关权威事实(keyId/owner/traceId),绝不读取调用 arguments。故意不含
 * scopes / SK / 敏感参数:设备不做授权裁决,scope 判定在网关侧已完成。
 * expiresAt 以网关时钟对齐 DEVICE_CALL_TIMEOUT_MS —— 即设备看到的期限正好是网关
 * 真正取消该 call 的时刻,设备复检以此为准,不信任设备本地时钟。
 */
export function deviceCallContextFrom(ctx: CallContext): DeviceCallContext {
  const now = Date.now()
  return {
    caller: { keyId: ctx.keyId, owner: ctx.owner },
    traceId: ctx.traceId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DEVICE_CALL_TIMEOUT_MS).toISOString(),
  }
}

/** device 自定义节点转发标记:hello 代注册时网关写入 providerConfig。 */
export interface DeviceNodeMarker {
  /** 注册时随 NodeInput 上送的工具表(~help 数据源);老客户端不带。 */
  cmds?: ToolSpec[]
  deviceId: string
  mountPath: string
}

export function deviceMarkerOf(pc: Record<string, unknown> | undefined): DeviceNodeMarker | null {
  if (pc === undefined || typeof pc.deviceId !== 'string' || typeof pc.mountPath !== 'string') {
    return null
  }
  return {
    deviceId: pc.deviceId,
    mountPath: pc.mountPath,
    ...(Array.isArray(pc.cmds) ? { cmds: pc.cmds as ToolSpec[] } : {}),
  }
}

/** kind:'tool' 且带设备标记的自定义节点(SDK registerTool → connect 代注册产物)。 */
export function deviceToolMarker(node: TreeNode): DeviceNodeMarker | null {
  if (node.kind !== 'tool' || node.config?.kind !== 'tool') return null
  return deviceMarkerOf(node.config.providerConfig)
}

/** 帧协议 call 的 path = 节点路径相对设备 mountPath(如 'tools/echo')。 */
export function relativeDevicePath(nodePath: TreePath, mountPath: string): string {
  if (nodePath.startsWith(`${mountPath}/`)) return nodePath.slice(mountPath.length + 1)
  throw new TBError('invalid_argument', `device 节点 '${nodePath}' 不在挂载 '${mountPath}' 下`)
}
/**
 * device 转发标记只能由 hello 代注册写入:注册面手工携带 providerConfig
 * 的 deviceId+mountPath → 拒,防止把任意节点调用劫持转发到他人设备(与 device-fs 口径一致)。
 */
export function assertNoDeviceMarker(config: unknown): void {
  const pc = (config as { providerConfig?: unknown }).providerConfig
  if (
    pc !== null
    && typeof pc === 'object'
    && deviceMarkerOf(pc as Record<string, unknown>) !== null
  ) {
    throw new TBError(
      'invalid_argument',
      'providerConfig 的 device 转发标记由网关代写,不得经注册面携带',
    )
  }
}
