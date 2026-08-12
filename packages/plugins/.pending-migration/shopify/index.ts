/**
 * Shopify REST Admin (Legacy) —— 从 open-connector 迁移的 provider(13 个只读 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 凭证是**两个字段**:`apiKey`(Admin API access token)与 `shopDomain`(店铺域名)。
 * 字段名与上游 `definition.ts` 的 auth[0](api_key + extraFields)逐字一致 —— 名字对不上
 * 就取不到值,而 `requireCredential` 会把它报成 internal(provider 自身的 bug)。
 * shopDomain 不是密钥,但它决定出站主机,故与 token 一起走 authRef 而不是 providerConfig。
 *
 * credentialProbe 选 `get_shop`:上游 credentialValidators 打的正是 `/shop.json`,
 * 且它 effect 为 read、零入参 —— 三个条件都满足。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import {
  countArticles,
  countBlogs,
  countPages,
  getArticle,
  getBlog,
  getPage,
  getShop,
  listArticleAuthors,
  listArticles,
  listArticleTags,
  listBlogArticleTags,
  listBlogs,
  listPages,
} from './api'
import { shopifyActions } from './schema'

export type { ProviderEnv as Env }

export function createShopifyPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Shopify REST Admin (Legacy)',
    actions: shopifyActions,
    credentialFields: [
      {
        key: 'apiKey',
        label: 'Admin API access token',
        required: true,
        secret: true,
        description: 'Shopify Admin API access token(shpat_...),走 X-Shopify-Access-Token 头;在自建应用的 API 凭据页获取',
      },
      {
        key: 'shopDomain',
        label: 'Shop domain',
        required: true,
        secret: false,
        description: '店铺的 myshopify.com 域名(如 acme.myshopify.com);后台地址也接受,会取其主机名',
      },
    ],
    credentialProbe: 'get_shop',
    handlers: {
      get_shop: getShop,
      list_blogs: listBlogs,
      get_blog: getBlog,
      count_blogs: countBlogs,
      list_pages: listPages,
      get_page: getPage,
      count_pages: countPages,
      list_articles: listArticles,
      get_article: getArticle,
      count_articles: countArticles,
      list_article_tags: listArticleTags,
      list_blog_article_tags: listBlogArticleTags,
      list_article_authors: listArticleAuthors,
    },
  })
}

export default createShopifyPlugin()
