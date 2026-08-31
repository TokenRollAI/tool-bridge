/**
 * 设备连接生命周期的宿主中立编排(与 processDeviceHello 配对)。
 *
 * CF DeviceSession DO 与 Node DeviceHub 共用本模块:invoke 热路径的授权重验、
 * 断线收尾、回收删子树的业务序列都在这里单点实现,防两宿主漂移。宿主只保留
 * 各自的调度形态(DO alarm vs setTimeout+sweepOrphans)、连接代际判定
 * (DO 的 activeConnId / Hub 的 activeByDevice)与 meta 存取。
 */
import {
  checkRegisterPath,
  identify,
  type MutableSearchIndex,
  type NodeRegistryStore,
  type StateStore,
  type TreePath,
} from '@tool-bridge/core'
import { SearchSynchronizer } from './search/synchronizer'

/**
 * invoke/唤醒热路径的授权重验:不仅校验凭据有效与 keyId 和 hello 落库一致,还用
 * hello 落库时同一个 `checkRegisterPath` 复核该 SK **现在**仍能注册 mountPath
 * (scope 与 registerPaths 事后收紧都失效)。existing 传 null:此处判的是
 * "现在还能不能注册",不是占用冲突。identify 是异步 I/O,期间连接可能被顶替——
 * "连接仍是当前活动连接"的代际复核属宿主形态,由调用方在前后自持。
 */
export async function reverifyDeviceAuthority(opts: {
  authorization: string | undefined
  keyId: string
  mountPath: TreePath
  /** 部署配置追加的保留根;与 processDeviceHello 同口径,缺省即仅内置 RESERVED_ROOTS。 */
  reservedRoots?: string[]
  store: StateStore
}): Promise<boolean> {
  const authCtx = await identify(opts.store, opts.authorization, new Date().toISOString())
  if (authCtx === null || authCtx.keyId !== opts.keyId) return false
  return checkRegisterPath({
    sk: {
      scopes: authCtx.scopes,
      id: authCtx.keyId,
      ...(authCtx.registerPaths !== undefined ? { registerPaths: authCtx.registerPaths } : {}),
    },
    targetPath: opts.mountPath,
    action: 'write',
    existing: null,
    ...(opts.reservedRoots !== undefined ? { reservedRoots: opts.reservedRoots } : {}),
  }).allow
}

/**
 * 断线收尾的业务段:registry 下线。节点可能已被管理面删除——容忍失败,宿主仍要
 * 推进自己的断线状态(记 disconnectedAt、排回收)。now 由宿主给出并与其 meta
 * 写入共用,保证断线时刻单一。
 */
export async function markDeviceDisconnected(opts: {
  mountPath: TreePath
  now: string
  registry: NodeRegistryStore
}): Promise<void> {
  try {
    await opts.registry.setOnline(opts.mountPath, false, opts.now)
  } catch {
    // 节点已被外部删除;只推进宿主侧状态即可。
  }
}

/**
 * 回收删子树:SearchSynchronizer.markSubtree → registry.deleteSubtree →
 * removeSubtreeQuietly。顺序是正确性前提——先标脏再删 canonical,派生索引才不会
 * 在删除窗口内保留幽灵条目。registry 删除容忍"已被外部清理"。宿主随后自行清理
 * 本地 meta(DO storage / devicemeta: 键)。
 */
export async function reclaimDeviceSubtree(opts: {
  mountPath: TreePath
  registry: NodeRegistryStore
  search?: MutableSearchIndex
  state: StateStore
}): Promise<void> {
  const searchSync = opts.search === undefined
    ? undefined
    : new SearchSynchronizer(opts.state, opts.search)
  const marker = await searchSync?.markSubtree(opts.mountPath)
  try {
    await opts.registry.deleteSubtree(opts.mountPath)
  } catch {
    // 已被外部清理时,宿主本地状态仍可回收。
  }
  await searchSync?.removeSubtreeQuietly(opts.mountPath, marker)
}

/**
 * hello 接受但 searchIndexed=false 时的宿主告警文案(单一措辞,防两宿主分叉):
 * registry 已超 canonical audit 容量,设备可调用但工具暂不进全局搜索。
 */
export function deviceSearchCapacityWarning(deviceId: string, mountPath: TreePath): string {
  return `[tool-bridge] device '${deviceId}' mounted at ${mountPath} but its tools are NOT in the search index: registry exceeds the tool-search capacity (TOOL_SEARCH_AUDIT_NODE_LIMIT). The device is callable but won't appear in tool search until capacity frees up.`
}
