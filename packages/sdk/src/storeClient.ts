/** Compatibility surface for the package root; implementation lives in `./store`. */

export { createStoreClient } from './store/client'
export type {
  StoreClient,
  StoreClientOptions,
  StoreListOptions,
} from './store/client'
export type {
  StoreClientObjectDescriptor,
  StoreListPage,
  StoreReadGrant,
  StoreShareGrant,
} from './store/wire'
