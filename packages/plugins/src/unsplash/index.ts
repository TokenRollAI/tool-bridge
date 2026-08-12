/**
 * Unsplash —— 从 open-connector 迁移的 provider(6 个 photo/topic action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { getPhoto, getRandomPhoto, getTopicPhotos, listPhotos, listTopics, searchPhotos } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { unsplashActions } from './schema'

export type { ProviderEnv as Env }

export function createUnsplashPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Unsplash',
    actions: unsplashActions,
    // 上游 `credentialValidators.apiKey` 打的就是 `/photos?page=1&per_page=1`,
    // 对应这里的 list_photos:read、无必填入参,平台空参调它即可验证 access key。
    credentialProbe: 'list_photos',
    handlers: {
      list_photos: listPhotos,
      search_photos: searchPhotos,
      get_photo: getPhoto,
      get_random_photo: getRandomPhoto,
      list_topics: listTopics,
      get_topic_photos: getTopicPhotos,
    },
  })
}

export default createUnsplashPlugin()
