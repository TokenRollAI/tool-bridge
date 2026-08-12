/**
 * PubMed —— 从 open-connector 迁移的 provider(NCBI E-utilities,8 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * **没有 credentialProbe**,两个理由都成立:
 * - PubMed 支持匿名调用(上游 `authTypes` 含 `no_auth`),没凭证也能用,探针无从谈起;
 * - 八个 action 没有一个能"空参调"。`get_article` / `get_articles` / `convert_article_ids`
 *   在 schema 里字段全是 optional(上游没标 required),但 executor 里是必填 —— 空参调它们
 *   会得到 invalid_argument,那个错误看起来像凭证问题,实际是探针选错了。
 *
 * 凭证是 **URL 上的 `api_key` query 参数**(NCBI 的设计),部署侧日志需脱敏,详见 `api.ts`。
 */

import {
  convertArticleIds,
  findRelatedArticles,
  getArticle,
  getArticleReferences,
  getArticles,
  getCitingArticles,
  matchCitation,
  searchArticles,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { pubmedActions } from './schema'

export type { ProviderEnv as Env }

export function createPubmedPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'PubMed',
    actions: pubmedActions,
    handlers: {
      search_articles: searchArticles,
      match_citation: matchCitation,
      get_article: getArticle,
      get_articles: getArticles,
      find_related_articles: findRelatedArticles,
      get_citing_articles: getCitingArticles,
      get_article_references: getArticleReferences,
      convert_article_ids: convertArticleIds,
    },
  })
}

export default createPubmedPlugin()
