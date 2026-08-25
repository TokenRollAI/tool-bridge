/**
 * Device compatibility adapter around the platform-neutral Store package.
 *
 * The device credential interface is structurally compatible with the smaller
 * Store HTTP credential contract; this layer keeps the established device API
 * while all protocol parsing and transfer behavior lives in `src/store`.
 */

import type {
  StoreChecksum,
  StoreObjectDescriptor,
} from '../store/wire'
import type { DeviceCredentialProvider } from './connection'
import {
  type CapabilityUploadOptions,
  type UploadObjectOptions as NeutralUploadObjectOptions,
  type UploadObjectInput,
  uploadObject as uploadStoreObject,
  uploadObjectWithCapability as uploadStoreObjectWithCapability,
} from '../store/upload'

export type {
  StoreChecksum,
  StoreObjectDescriptor,
  UploadObjectInput,
}

export type CallUploadObjectOptions = UploadObjectInput

export type UploadObjectOptions = Omit<NeutralUploadObjectOptions, 'credentialProvider'> & {
  credentialProvider: DeviceCredentialProvider
}

/** Upload a new object using device HTTP credentials. */
export async function uploadObject(opts: UploadObjectOptions): Promise<StoreObjectDescriptor> {
  return await uploadStoreObject(opts)
}

/** @internal Used by connectDevice's call-scoped authoring surface. */
export async function uploadObjectWithCapability(
  opts: CapabilityUploadOptions,
): Promise<StoreObjectDescriptor> {
  return await uploadStoreObjectWithCapability(opts)
}
