import { DurableObject } from 'cloudflare:workers'
import {
  type CallContext,
  check,
  checkRegisterPath,
  type DeviceCallRequest,
  type DeviceCallResult,
  type DeviceExpose,
  type DeviceFrame,
  DeviceGatewaySession,
  type DeviceNodeInput,
  decodeDeviceFrame,
  encodeDeviceFrame,
  identify,
  type NodeInput,
  NodeRegistryStore,
  normalizePath,
  PING_FRAME_JSON,
  PONG_FRAME_JSON,
  parseNodeInput,
  type StateStore,
  TBError,
  type TreePath,
  validatePath,
} from '@tool-bridge/core'
import { ensureBootstrapped } from './bootstrap'
import { KvStateStore } from './kvStateStore'

interface DeviceSessionEnv {
  TB_KV: KVNamespace
  TB_BOOTSTRAP_ADMIN_SK?: string
  TB_SECRET_ENCRYPTION_KEY?: string
  TB_DEVICE_RECLAIM_SEC?: string
}

interface SocketAttachment {
  connId: string
  deviceIdHint: string
  authorization?: string
}

interface DeviceMeta {
  deviceId: string
  mountPath: TreePath
  keyId: string
  expose: DeviceExpose
  activeConnId?: string
  connectedAt?: string
  disconnectedAt?: string
}

const META_KEY = 'meta'
const RESULT_KEY_PREFIX = 'result:'
const DEFAULT_RECLAIM_SEC = 24 * 60 * 60

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function tbErrorResponse(error: TBError): Response {
  return jsonResponse(error.toJSON(), error.httpStatus)
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function assertDeviceId(deviceId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(deviceId)) {
    throw new TBError('invalid_argument', "deviceId 只能包含字母、数字、'.'、'_'、'-'(DO 路由约束)")
  }
}

function resultKey(id: string): string {
  return `${RESULT_KEY_PREFIX}${id}`
}

function isSocketAttachment(value: unknown): value is SocketAttachment {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { connId?: unknown }).connId === 'string' &&
    typeof (value as { deviceIdHint?: unknown }).deviceIdHint === 'string'
  )
}

function attachmentOf(ws: WebSocket): SocketAttachment {
  const raw = ws.deserializeAttachment()
  if (!isSocketAttachment(raw)) {
    throw new TBError('invalid_argument', 'device WebSocket 缺少连接附件')
  }
  return raw
}

function basenameLike(path: string): string {
  const trimmed = path.replace(/[\\/]+$/g, '')
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

function assertFsRoots(roots: readonly string[]): void {
  const seen = new Set<string>()
  for (const root of roots) {
    const base = basenameLike(root)
    if (!base) throw new TBError('invalid_argument', `fs root 非法:'${root}'`)
    if (seen.has(base)) {
      throw new TBError('invalid_argument', `fs roots basename 冲突:'${base}'`)
    }
    seen.add(base)
  }
}

function joinTreePath(base: TreePath, rel: string): TreePath {
  return normalizePath(`${base}/${rel.replace(/^\/+|\/+$/g, '')}`)
}

function invokeRequestFromBody(body: unknown): DeviceCallRequest {
  if (typeof body !== 'object' || body === null) {
    throw new TBError('invalid_argument', 'device invoke body must be an object')
  }
  const b = body as Record<string, unknown>
  if (
    typeof b.id !== 'string' ||
    typeof b.path !== 'string' ||
    typeof b.tool !== 'string' ||
    typeof b.arguments !== 'object' ||
    b.arguments === null ||
    Array.isArray(b.arguments)
  ) {
    throw new TBError('invalid_argument', 'device invoke body must be {id,path,tool,arguments}')
  }
  return {
    id: b.id,
    path: b.path,
    tool: b.tool,
    arguments: b.arguments as Record<string, unknown>,
  }
}

/**
 * DeviceSession Durable Object:每 deviceId 一个 DO,负责 WS hibernation、
 * requestId 待决/结果表、设备节点生命周期与 HTTP→WS 调用转发。
 */
export class DeviceSession extends DurableObject<DeviceSessionEnv> {
  /** 惰性建会话(Promise 防并发重建):hibernation 唤醒后由 sessionFor 按 meta 恢复 ready 态。 */
  private readonly sessions = new Map<WebSocket, Promise<DeviceGatewaySession>>()

  constructor(ctx: DurableObjectState, env: DeviceSessionEnv) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING_FRAME_JSON, PONG_FRAME_JSON))
  }

  override async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        return await this.acceptWebSocket(request, url)
      }
      if (request.method === 'POST' && url.pathname === '/invoke') {
        const body = await request.json().catch(() => null)
        return jsonResponse(await this.invoke(invokeRequestFromBody(body)))
      }
      throw TBError.notFound('not found')
    } catch (err) {
      if (err instanceof TBError) return tbErrorResponse(err)
      return tbErrorResponse(new TBError('internal', 'internal error'))
    }
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const session = await this.sessionFor(ws)
    let frame: DeviceFrame
    try {
      const text =
        typeof message === 'string' ? message : new TextDecoder().decode(new Uint8Array(message))
      frame = decodeDeviceFrame(text)
    } catch (err) {
      session.reject(err instanceof TBError ? err : new TBError('invalid_argument', '非法帧'))
      return
    }
    session.handleFrame(frame)
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.closeSocket(ws)
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.closeSocket(ws)
  }

  override async alarm(): Promise<void> {
    const meta = await this.ctx.storage.get<DeviceMeta>(META_KEY)
    if (
      meta === undefined ||
      meta.activeConnId !== undefined ||
      meta.disconnectedAt === undefined
    ) {
      return
    }
    const reclaimMs = parsePositiveInt(this.env.TB_DEVICE_RECLAIM_SEC, DEFAULT_RECLAIM_SEC) * 1000
    if (Date.now() - Date.parse(meta.disconnectedAt) < reclaimMs) {
      await this.ctx.storage.setAlarm(Date.parse(meta.disconnectedAt) + reclaimMs)
      return
    }
    const registry = await this.registry()
    try {
      await registry.deleteSubtree(meta.mountPath)
    } catch {
      // 已被外部清理时,DO 本地状态仍可回收。
    }
    await this.ctx.storage.deleteAll()
  }

  private async acceptWebSocket(request: Request, url: URL): Promise<Response> {
    const deviceIdHint = url.searchParams.get('deviceId') ?? ''
    assertDeviceId(deviceIdHint)
    await ensureBootstrapped(new KvStateStore(this.env.TB_KV), this.env)

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    const attachment: SocketAttachment = {
      connId: crypto.randomUUID(),
      deviceIdHint,
      ...(request.headers.get('authorization') !== null
        ? { authorization: request.headers.get('authorization') ?? undefined }
        : {}),
    }
    this.ctx.acceptWebSocket(server, [`device:${deviceIdHint}`])
    server.serializeAttachment(attachment)
    return new Response(null, { status: 101, webSocket: client })
  }

  private sessionFor(ws: WebSocket): Promise<DeviceGatewaySession> {
    const existing = this.sessions.get(ws)
    if (existing !== undefined) return existing
    const created = this.initSession(ws)
    this.sessions.set(ws, created)
    return created
  }

  /** 建会话;若该连接的 hello 已在休眠前完成(meta.activeConnId 匹配)则直接恢复 ready。 */
  private async initSession(ws: WebSocket): Promise<DeviceGatewaySession> {
    const session = this.createSession(ws)
    try {
      const attachment = attachmentOf(ws)
      const meta = await this.ctx.storage.get<DeviceMeta>(META_KEY)
      if (meta !== undefined && meta.activeConnId === attachment.connId) {
        session.restoreReady()
      }
    } catch {
      // 附件缺失/损坏:按新连接处理,等 hello。
    }
    return session
  }

  private createSession(ws: WebSocket): DeviceGatewaySession {
    const session = new DeviceGatewaySession(
      {
        send: (frame) => ws.send(encodeDeviceFrame(frame)),
        close: (code) => ws.close(code),
        onHello: (hello) => {
          this.ctx.waitUntil(
            this.acceptHello(ws, session, hello).catch((err) => {
              session.reject(err instanceof TBError ? err : new TBError('internal', 'hello 失败'))
            }),
          )
        },
        onResult: (id, result) => {
          this.ctx.waitUntil(this.ctx.storage.put(resultKey(id), result))
        },
      },
      {
        setTimer: (cb, ms) => {
          const id = setTimeout(cb, ms)
          return () => clearTimeout(id)
        },
      },
    )
    return session
  }

  private async acceptHello(
    ws: WebSocket,
    session: DeviceGatewaySession,
    hello: { deviceId: string; mountPath?: TreePath; expose: DeviceExpose },
  ): Promise<void> {
    const attachment = attachmentOf(ws)
    if (hello.deviceId !== attachment.deviceIdHint) {
      throw new TBError('invalid_argument', 'hello.deviceId 必须与 deviceId 查询参数一致')
    }
    const store = new KvStateStore(this.env.TB_KV)
    await ensureBootstrapped(store, this.env)
    const authCtx = await identify(store, attachment.authorization, new Date().toISOString())
    if (authCtx === null) throw TBError.unauthenticated()

    const mountPath = normalizePath(hello.mountPath ?? `device/${hello.deviceId}`)
    const invalid = validatePath(mountPath)
    if (invalid) throw invalid
    if (!check(authCtx, mountPath, 'register').allow) {
      throw new TBError('permission_denied', `no scope grants 'register' on '${mountPath}'`)
    }
    if (hello.expose.fs !== undefined) assertFsRoots(hello.expose.fs.roots)

    const inputs = this.nodesForHello(mountPath, hello.deviceId, hello.expose)
    const registry = new NodeRegistryStore(store)
    for (const input of inputs) {
      await this.assertRegisterPath(registry, authCtx, input.path)
    }

    const now = new Date().toISOString()
    for (const input of inputs) {
      await registry.write(
        input,
        authCtx.keyId,
        now,
        input.path === mountPath ? { online: true } : {},
      )
    }
    await this.ctx.storage.put<DeviceMeta>(META_KEY, {
      deviceId: hello.deviceId,
      mountPath,
      keyId: authCtx.keyId,
      expose: hello.expose,
      activeConnId: attachment.connId,
      connectedAt: now,
    })
    await this.ctx.storage.deleteAlarm()
    this.closeSupersededSockets(ws, attachment.connId)
    session.accept(mountPath)
  }

  private nodesForHello(mountPath: TreePath, deviceId: string, expose: DeviceExpose): NodeInput[] {
    const nodes: NodeInput[] = [
      {
        path: mountPath,
        kind: 'directory',
        description: `设备 ${deviceId}`,
      },
    ]
    if (expose.shell !== undefined) {
      nodes.push({
        path: joinTreePath(mountPath, 'shell'),
        kind: 'device',
        description: expose.shell.description ?? '设备 shell(远程命令执行)',
        config: { kind: 'device', deviceId, expose: { shell: expose.shell } },
      })
    }
    if (expose.fs !== undefined) {
      nodes.push({
        path: joinTreePath(mountPath, 'fs'),
        kind: 'context',
        description: '设备文件系统',
        config: {
          kind: 'context',
          provider: 'device-fs',
          readOnly: expose.fs.readOnly ?? false,
          providerConfig: { deviceId, mountPath, roots: expose.fs.roots },
        },
      })
    }
    for (const raw of expose.nodes ?? []) {
      nodes.push(this.customNodeInput(mountPath, deviceId, raw))
    }
    return nodes
  }

  /**
   * expose.nodes 自定义节点:路径挂到 mountPath 下,并对可调用
   * kind(tool/context)注入 providerConfig 转发标记 { deviceId, mountPath, cmds? }
   * (与 device-fs 同构)——网关据此把调用经帧协议 call 转发回设备;cmds(SDK 随
   * NodeInput 上送的工具表)是节点 ~help 的数据源。标记为网关权威,覆盖设备侧同名字段。
   */
  private customNodeInput(mountPath: TreePath, deviceId: string, raw: DeviceNodeInput): NodeInput {
    const { cmds, ...rest } = raw
    const input = parseNodeInput({ ...rest, path: joinTreePath(mountPath, raw.path) })
    const marker = { deviceId, mountPath, ...(cmds !== undefined ? { cmds } : {}) }
    if (input.kind === 'tool') {
      const base =
        input.config?.kind === 'tool' ? input.config : { kind: 'tool' as const, provider: '@local' }
      input.config = { ...base, providerConfig: { ...(base.providerConfig ?? {}), ...marker } }
    } else if (input.kind === 'context') {
      const base =
        input.config?.kind === 'context'
          ? input.config
          : { kind: 'context' as const, provider: '@local' }
      input.config = { ...base, providerConfig: { ...(base.providerConfig ?? {}), ...marker } }
    }
    return input
  }

  private async assertRegisterPath(
    registry: NodeRegistryStore,
    ctx: CallContext,
    targetPath: TreePath,
  ): Promise<void> {
    if (!check(ctx, targetPath, 'register').allow) {
      throw new TBError('permission_denied', `no scope grants 'register' on '${targetPath}'`)
    }
    let existing: { registeredBy: string } | null = null
    try {
      existing = await registry.get(targetPath)
    } catch {
      existing = null
    }
    const res = checkRegisterPath({
      sk: {
        scopes: ctx.scopes,
        id: ctx.keyId,
        ...(ctx.registerPaths !== undefined ? { registerPaths: ctx.registerPaths } : {}),
      },
      targetPath,
      action: 'write',
      existing,
    })
    if (!res.allow) throw res.error
  }

  private closeSupersededSockets(current: WebSocket, currentConnId: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === current) continue
      try {
        const attachment = attachmentOf(ws)
        if (attachment.connId !== currentConnId) ws.close(1000, 'replaced')
      } catch {
        ws.close(1000, 'replaced')
      }
    }
  }

  private async closeSocket(ws: WebSocket): Promise<void> {
    const pending = this.sessions.get(ws)
    this.sessions.delete(ws)
    if (pending !== undefined) (await pending).dispose()

    let attachment: SocketAttachment
    try {
      attachment = attachmentOf(ws)
    } catch {
      return
    }
    const meta = await this.ctx.storage.get<DeviceMeta>(META_KEY)
    if (meta === undefined || meta.activeConnId !== attachment.connId) return
    await this.markDisconnected(meta)
  }

  /** 连接失效统一收尾(正常关闭 / activeSocket 发现半开丢失):registry 下线 + 清 activeConnId + 回收 alarm。 */
  private async markDisconnected(meta: DeviceMeta): Promise<void> {
    const now = new Date().toISOString()
    const registry = await this.registry()
    try {
      await registry.setOnline(meta.mountPath, false, now)
    } catch {
      // 节点可能已被管理面删除;只更新 DO 状态即可。
    }
    await this.ctx.storage.put<DeviceMeta>(META_KEY, {
      ...meta,
      activeConnId: undefined,
      disconnectedAt: now,
    })
    const reclaimSec = parsePositiveInt(this.env.TB_DEVICE_RECLAIM_SEC, DEFAULT_RECLAIM_SEC)
    await this.ctx.storage.setAlarm(Date.now() + reclaimSec * 1000)
  }

  async invoke(req: DeviceCallRequest): Promise<DeviceCallResult> {
    const cached = await this.ctx.storage.get<DeviceCallResult>(resultKey(req.id))
    if (cached !== undefined) return cached

    const ws = await this.activeSocket()
    if (ws === null) {
      return { ok: false, error: TBError.deviceOffline().toJSON() }
    }
    const session = await this.sessionFor(ws)
    return await new Promise<DeviceCallResult>((resolve) => session.call(req, resolve))
  }

  private async activeSocket(): Promise<WebSocket | null> {
    const meta = await this.ctx.storage.get<DeviceMeta>(META_KEY)
    if (meta === undefined || meta.activeConnId === undefined) return null
    const tagged = this.ctx.getWebSockets(`device:${meta.deviceId}`)
    const sockets = tagged.length > 0 ? tagged : this.ctx.getWebSockets()
    for (const ws of sockets) {
      try {
        const attachment = attachmentOf(ws)
        if (attachment.connId === meta.activeConnId) return ws
      } catch {
        // ignore malformed attachment
      }
    }
    await this.markDisconnected(meta)
    return null
  }

  private async registry(): Promise<NodeRegistryStore> {
    const store: StateStore = new KvStateStore(this.env.TB_KV)
    await ensureBootstrapped(store, this.env)
    return new NodeRegistryStore(store)
  }
}
