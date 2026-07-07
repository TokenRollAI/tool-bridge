/**
 * DeviceFrame:设备 WS 帧协议的类型与编解码。
 *
 * JSON 文本帧、`type` 区分;decode 拒绝非 JSON / 未知 type / 缺字段(invalid_argument),
 * encode 产出紧凑 JSON。ping/pong 序列化为稳定字面量(PING_FRAME_JSON/PONG_FRAME_JSON)——
 * DO 的 setWebSocketAutoResponse 按字符串精确匹配,设备侧心跳帧不得有其他序列化形态。
 */

import { z } from 'zod'
import { TB_ERROR_CODES, TBError, type TBErrorBody, type TBErrorCode } from '../errors'
import { type DeviceExpose, NODE_KINDS, type NodeKind, type TreePath } from '../types'

// ---------- 帧类型(TS 定义为真源) ----------

/** 设备 → 网关:连接后第一帧;mountPath 缺省 device/<deviceId>。 */
export interface HelloFrame {
  type: 'hello'
  deviceId: string
  mountPath?: TreePath
  expose: DeviceExpose
}

/** 网关 → 设备:hello 确认(含挂载结果)。 */
export interface ReadyFrame {
  type: 'ready'
  mountPath: string
}

/** 网关 → 设备:拒绝帧(发送后网关 close(1008));设备侧以此区分权限拒绝与可重试断线。 */
export interface ErrorFrame {
  type: 'error'
  error: TBErrorBody
}

/** 网关 → 设备:调用转发;path 相对 mountPath(如 "shell")。 */
export interface CallFrame {
  type: 'call'
  id: string
  path: string
  tool: string
  arguments: Record<string, unknown>
}

/** 设备 → 网关:调用结果(与 call 的 id 对应)。 */
export type ResultFrame =
  | { type: 'result'; id: string; ok: true; value: unknown }
  | { type: 'result'; id: string; ok: false; error: TBErrorBody }

/** 双向心跳。 */
export interface PingFrame {
  type: 'ping'
}
export interface PongFrame {
  type: 'pong'
}

/** 网关 → 设备:超时取消提示。 */
export interface CancelFrame {
  type: 'cancel'
  id: string
}

export type DeviceFrame =
  | HelloFrame
  | ReadyFrame
  | ErrorFrame
  | CallFrame
  | ResultFrame
  | PingFrame
  | PongFrame
  | CancelFrame

// ---------- 结构校验(zod;未知字段剥离,nodes 除外) ----------

const tbErrorBodySchema = z.object({
  code: z.enum(TB_ERROR_CODES as [TBErrorCode, ...TBErrorCode[]]),
  message: z.string(),
  retryable: z.boolean(),
})

/**
 * NodeInput 只做边界校验(path/kind/description),config/virtualize 等经 passthrough
 * 原样保留——注册时由 NodeRegistry 全量校验,帧层不复刻。
 * cmds:可选工具表(~help 数据源);老客户端不带则该节点 ~help 只有节点描述。
 */
const deviceNodeCmdSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    inputSchema: z.unknown().optional(),
    effect: z.string().optional(),
    confirm: z.boolean().optional(),
  })
  .passthrough()

const nodeInputSchema = z
  .object({
    path: z.string().min(1),
    kind: z.enum(NODE_KINDS as [NodeKind, ...NodeKind[]]),
    description: z.string(),
    cmds: z.array(deviceNodeCmdSchema).optional(),
  })
  .passthrough()

const deviceExposeSchema = z.object({
  shell: z
    .object({
      description: z.string().optional(),
      allow: z.array(z.string()).optional(),
    })
    .optional(),
  fs: z
    .object({
      roots: z.array(z.string().min(1)).min(1),
      readOnly: z.boolean().optional(),
    })
    .optional(),
  nodes: z.array(nodeInputSchema).optional(),
})

const idSchema = z.string().min(1)

const schemaByType = {
  hello: z.object({
    type: z.literal('hello'),
    deviceId: z.string().min(1),
    mountPath: z.string().min(1).optional(),
    expose: deviceExposeSchema,
  }),
  ready: z.object({ type: z.literal('ready'), mountPath: z.string().min(1) }),
  error: z.object({ type: z.literal('error'), error: tbErrorBodySchema }),
  call: z.object({
    type: z.literal('call'),
    id: idSchema,
    path: z.string(),
    tool: z.string().min(1),
    arguments: z.record(z.unknown()),
  }),
  result: z.discriminatedUnion('ok', [
    z.object({ type: z.literal('result'), id: idSchema, ok: z.literal(true), value: z.unknown() }),
    z.object({
      type: z.literal('result'),
      id: idSchema,
      ok: z.literal(false),
      error: tbErrorBodySchema,
    }),
  ]),
  ping: z.object({ type: z.literal('ping') }),
  pong: z.object({ type: z.literal('pong') }),
  cancel: z.object({ type: z.literal('cancel'), id: idSchema }),
} as const

// ---------- 编解码 ----------

/** ping/pong 的稳定序列化字面量(DO setWebSocketAutoResponse 按此串精确匹配)。 */
export const PING_FRAME_JSON = '{"type":"ping"}'
export const PONG_FRAME_JSON = '{"type":"pong"}'

function invalidFrame(reason: string): TBError {
  return new TBError('invalid_argument', `非法 DeviceFrame:${reason}`)
}

/** 文本帧 → DeviceFrame;非 JSON / 未知 type / 缺字段 → invalid_argument。 */
export function decodeDeviceFrame(text: string): DeviceFrame {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw invalidFrame('非 JSON')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw invalidFrame('必须是 JSON 对象')
  }
  const type = (raw as { type?: unknown }).type
  if (typeof type !== 'string' || !(type in schemaByType)) {
    throw invalidFrame(`未知 type:${JSON.stringify(type)}`)
  }
  const parsed = schemaByType[type as keyof typeof schemaByType].safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw invalidFrame(`${type} 帧字段非法:${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`)
  }
  // 结构已由 schema 校验;zod 推导形状(passthrough 索引签名)与手写接口不完全同型,收窄到真源类型。
  return parsed.data as unknown as DeviceFrame
}

/** DeviceFrame → 紧凑 JSON 文本;ping/pong 恒等于稳定字面量。 */
export function encodeDeviceFrame(frame: DeviceFrame): string {
  if (frame.type === 'ping') return PING_FRAME_JSON
  if (frame.type === 'pong') return PONG_FRAME_JSON
  return JSON.stringify(frame)
}

/** TBError → 拒绝帧(发送后网关 close(1008))。 */
export function deviceErrorFrame(error: TBError): ErrorFrame {
  return { type: 'error', error: error.toJSON() }
}
