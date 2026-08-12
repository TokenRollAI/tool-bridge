/**
 * Semantic Scholar —— 从 open-connector 迁移的 provider(16 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 凭证是**单个 API key**(`x-api-key` 头),对应上游 `definition.ts` 的 `auth[0]`。
 *
 * **不声明 credentialProbe**:探针要求"已注册、effect 为 read、且无必填入参",而这里 16 个
 * action 全都有必填入参(paperId / authorId / query)。上游 `credentialValidators` 打的是
 * `/paper/search?query=semantic+scholar&limit=1`,但那是它自己拼的固定查询,不对应任何一个
 * action —— 不为了当探针硬造一个工具。代价:配错的 key 要等第一次业务调用才报
 * `permission_denied`。
 */

import {
  autocompletePapers,
  bulkSearchPapers,
  getAuthor,
  getAuthorPapers,
  getAuthors,
  getPaper,
  getPaperAuthors,
  getPaperCitations,
  getPaperReferences,
  getPapers,
  matchPaperTitle,
  recommendForPaper,
  recommendPapers,
  searchAuthors,
  searchPapers,
  searchSnippets,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { semanticScholarActions } from './schema'

export type { ProviderEnv as Env }

export function createSemanticScholarPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Semantic Scholar',
    actions: semanticScholarActions,
    handlers: {
      get_paper: getPaper,
      get_papers: getPapers,
      search_papers: searchPapers,
      bulk_search_papers: bulkSearchPapers,
      match_paper_title: matchPaperTitle,
      autocomplete_papers: autocompletePapers,
      get_paper_authors: getPaperAuthors,
      get_paper_citations: getPaperCitations,
      get_paper_references: getPaperReferences,
      search_authors: searchAuthors,
      get_author: getAuthor,
      get_authors: getAuthors,
      get_author_papers: getAuthorPapers,
      search_snippets: searchSnippets,
      recommend_for_paper: recommendForPaper,
      recommend_papers: recommendPapers,
    },
  })
}

export default createSemanticScholarPlugin()
