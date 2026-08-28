import { describe, expect, it } from 'vitest'
import { mailboxTargetForRegistryNode } from '../src/lib/deviceMailbox'

describe('DeviceMailboxPanel helpers', () => {
  it('keeps raw device identity separate from its registry mount path', () => {
    expect(mailboxTargetForRegistryNode({
      deviceId: 'phone-1',
      path: 'device/fleet/east-phone',
    })).toEqual({ deviceId: 'phone-1', mountPath: 'device/fleet/east-phone' })
    expect(mailboxTargetForRegistryNode({ path: 'device/legacy-phone' })).toEqual({
      deviceId: 'legacy-phone',
      mountPath: 'device/legacy-phone',
    })
    expect(mailboxTargetForRegistryNode({ path: 'custom/unknown' })).toBeNull()
  })
})
