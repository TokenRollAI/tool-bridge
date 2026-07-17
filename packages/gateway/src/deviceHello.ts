import {
  type CallContext,
  check,
  checkRegisterPath,
  type DeviceExpose,
  type DeviceNodeInput,
  identify,
  type NodeInput,
  NodeRegistryStore,
  normalizePath,
  parseNodeInput,
  type StateStore,
  TBError,
  type TreePath,
  validatePath,
} from '@tool-bridge/core'

/**
 * 设备 hello 帧的验证与落库(宿主中立):deviceId 一致性 → identify 认证 →
 * mountPath 校验 → register 判定 → fs roots 校验 → 逐节点 checkRegisterPath →
 * registry.write(mount 根带 online:true)。CF DeviceSession DO 与 Node DeviceHub
 * 共用本模块,保证两宿主的树形态与权限判定序不漂移;连接生命周期(meta 持久化、
 * 断线回收)属宿主形态,各自实现。
 */

export interface DeviceHello {
  deviceId: string
  expose: DeviceExpose
  mountPath?: TreePath
}

export interface HelloAcceptance {
  keyId: string
  mountPath: TreePath
}

export function assertDeviceId(deviceId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(deviceId)) {
    throw new TBError('invalid_argument', 'deviceId 只能包含字母、数字、\'.\'、\'_\'、\'-\'(DO 路由约束)')
  }
}

function basenameLike(path: string): string {
  const trimmed = path.replace(/[\\/]+$/g, '')
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

export function assertFsRoots(roots: readonly string[]): void {
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

export async function processDeviceHello(opts: {
  authorization: string | undefined
  deviceIdHint: string
  hello: DeviceHello
  now?: string
  store: StateStore
}): Promise<HelloAcceptance> {
  const { store, hello } = opts
  if (hello.deviceId !== opts.deviceIdHint) {
    throw new TBError('invalid_argument', 'hello.deviceId 必须与 deviceId 查询参数一致')
  }
  const authCtx = await identify(store, opts.authorization, new Date().toISOString())
  if (authCtx === null) throw TBError.unauthenticated()

  const mountPath = normalizePath(hello.mountPath ?? `device/${hello.deviceId}`)
  const invalid = validatePath(mountPath)
  if (invalid) throw invalid
  if (!check(authCtx, mountPath, 'register').allow) {
    throw new TBError('permission_denied', `no scope grants 'register' on '${mountPath}'`)
  }
  if (hello.expose.fs !== undefined) assertFsRoots(hello.expose.fs.roots)

  const inputs = nodesForHello(mountPath, hello.deviceId, hello.expose)
  const registry = new NodeRegistryStore(store)
  for (const input of inputs) {
    await assertRegisterPath(registry, authCtx, input.path)
  }

  const now = opts.now ?? new Date().toISOString()
  for (const input of inputs) {
    await registry.write(
      input,
      authCtx.keyId,
      now,
      input.path === mountPath ? { online: true } : {},
    )
  }
  return { mountPath, keyId: authCtx.keyId }
}

function nodesForHello(mountPath: TreePath, deviceId: string, expose: DeviceExpose): NodeInput[] {
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
    nodes.push(customNodeInput(mountPath, deviceId, raw))
  }
  return nodes
}

/**
 * expose.nodes 自定义节点:路径挂到 mountPath 下,并对可调用
 * kind(tool/context)注入 providerConfig 转发标记 { deviceId, mountPath, cmds? }
 * (与 device-fs 同构)——网关据此把调用经帧协议 call 转发回设备;cmds(SDK 随
 * NodeInput 上送的工具表)是节点 ~help 的数据源。标记为网关权威,覆盖设备侧同名字段。
 */
function customNodeInput(mountPath: TreePath, deviceId: string, raw: DeviceNodeInput): NodeInput {
  const { cmds, ...rest } = raw
  const input = parseNodeInput({ ...rest, path: joinTreePath(mountPath, raw.path) })
  const marker = { deviceId, mountPath, ...(cmds !== undefined ? { cmds } : {}) }
  if (input.kind === 'tool') {
    const base
      = input.config?.kind === 'tool' ? input.config : { kind: 'tool' as const, provider: '@local' }
    input.config = { ...base, providerConfig: { ...(base.providerConfig ?? {}), ...marker } }
  } else if (input.kind === 'context') {
    const base
      = input.config?.kind === 'context'
        ? input.config
        : { kind: 'context' as const, provider: '@local' }
    input.config = { ...base, providerConfig: { ...(base.providerConfig ?? {}), ...marker } }
  }
  return input
}

async function assertRegisterPath(
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
