import type { RegistryNode } from './types'

export interface DeviceMailboxTarget {
  deviceId: string
  mountPath: string
}

/** Registry 的 mount path 不是设备身份；优先使用 hello 由系统写入的原始 deviceId。 */
export function mailboxTargetForRegistryNode(
  node: Pick<RegistryNode, 'deviceId' | 'path'>,
): DeviceMailboxTarget | null {
  const legacyDefaultMount = /^device\/([^/]+)$/.exec(node.path)
  const deviceId = node.deviceId ?? legacyDefaultMount?.[1]
  if (deviceId === undefined || deviceId === '') return null
  return { deviceId, mountPath: node.path }
}
