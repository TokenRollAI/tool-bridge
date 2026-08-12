/**
 * Zhihu 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const zhihuSearchInput = z.strictObject({
  query: z.string().min(1).describe('The search query keyword.'),
  count: z.int().min(1).max(10).describe('The number of Zhihu search results to return, up to 10.').optional(),
}).describe('Input parameters for a Zhihu site search request.')

export const zhihuSearchOutput = z.looseObject({
  Code: z.int().describe('The upstream response code.').optional(),
  Message: z.string().describe('The upstream response message.').optional(),
  Data: z.looseObject({
    HasMore: z.boolean().describe('Whether more results are available. Zhihu currently returns false.').optional(),
    SearchHashId: z.string().describe('The search request identifier.').optional(),
    Items: z.array(z.looseObject({
      Title: z.string().describe('The content title.').optional(),
      ContentType: z.string().describe('The content type, such as Answer or Article.').optional(),
      ContentID: z.string().describe('The content identifier.').optional(),
      ContentText: z.string().describe('The content excerpt. Highlighted fragments may include em tags.').optional(),
      Url: z.url().describe('The source URL with Zhihu Open Platform attribution parameters.').optional(),
      CommentCount: z.int().describe('The number of comments.').optional(),
      VoteUpCount: z.int().describe('The number of upvotes.').optional(),
      AuthorName: z.string().describe('The author display name.').optional(),
      AuthorAvatar: z.string().describe('The author avatar URL.').optional(),
      AuthorBadge: z.string().describe('The author certification badge image URL.').optional(),
      AuthorBadgeText: z.string().describe('The author certification badge text.').optional(),
      EditTime: z.int().describe('The published or last edited Unix timestamp in seconds.').optional(),
      CommentInfoList: z.array(z.looseObject({
        Content: z.string().describe('The comment content.').optional(),
      }).describe('A selected comment returned with a content item.')).describe('Selected comments returned for this content item.').optional(),
      AuthorityLevel: z.string().describe('The content authority level from 1 to 4.').optional(),
      RankingScore: z.number().describe('The ranking score returned by Zhihu Search.').optional(),
    }).describe('A Zhihu content search result item.')).describe('Search result items.').optional(),
    EmptyReason: z.string().describe('The reason returned when the result set is empty.').optional(),
  }).describe('The Zhihu site search response data.').optional(),
}).describe('A Zhihu site search response.')

export const globalSearchInput = z.strictObject({
  query: z.string().min(1).describe('The search query keyword.'),
  count: z.int().min(1).max(20).describe('The number of global search results to return, up to 20.').optional(),
  filter: z.string().min(1).describe('Advanced filter expression for host or publish_time constraints.').optional(),
  searchDB: z.enum(['all', 'realtime', 'static']).describe('The search index database to query.').optional(),
}).describe('Input parameters for a Zhihu global search request.')

export const globalSearchOutput = z.looseObject({
  Code: z.int().describe('The upstream response code.').optional(),
  Message: z.string().describe('The upstream response message.').optional(),
  Data: z.looseObject({
    HasMore: z.boolean().describe('Whether more results are available.').optional(),
    Items: z.array(z.looseObject({
      Title: z.string().describe('The content title.').optional(),
      ContentType: z.string().describe('The content type, such as Answer or Article.').optional(),
      ContentID: z.string().describe('The content identifier.').optional(),
      ContentText: z.string().describe('The content excerpt. Highlighted fragments may include em tags.').optional(),
      Url: z.url().describe('The source URL with Zhihu Open Platform attribution parameters.').optional(),
      CommentCount: z.int().describe('The number of comments.').optional(),
      VoteUpCount: z.int().describe('The number of upvotes.').optional(),
      AuthorName: z.string().describe('The author display name.').optional(),
      AuthorAvatar: z.string().describe('The author avatar URL.').optional(),
      AuthorBadge: z.string().describe('The author certification badge image URL.').optional(),
      AuthorBadgeText: z.string().describe('The author certification badge text.').optional(),
      EditTime: z.int().describe('The published or last edited Unix timestamp in seconds.').optional(),
      CommentInfoList: z.array(z.looseObject({
        Content: z.string().describe('The comment content.').optional(),
      }).describe('A selected comment returned with a content item.')).describe('Selected comments returned for this content item.').optional(),
      AuthorityLevel: z.string().describe('The content authority level from 1 to 4.').optional(),
      RankingScore: z.number().describe('The ranking score returned by Zhihu Search.').optional(),
    }).describe('A Zhihu content search result item.')).describe('Search result items.').optional(),
  }).describe('The Zhihu global search response data.').optional(),
}).describe('A Zhihu global search response.')

export const hotListInput = z.strictObject({
  limit: z.int().min(1).max(30).describe('The number of hot list items to return, up to 30.').optional(),
}).describe('Input parameters for a Zhihu hot list request.')

export const hotListOutput = z.looseObject({
  Code: z.int().describe('The upstream response code.').optional(),
  Message: z.string().describe('The upstream response message.').optional(),
  Data: z.looseObject({
    Total: z.int().describe('The number of returned hot list items.').optional(),
    Items: z.array(z.looseObject({
      Title: z.string().describe('The hot list title.').optional(),
      Url: z.url().describe('The Zhihu URL for the hot list item.').optional(),
      ThumbnailUrl: z.string().describe('The thumbnail image URL, or an empty string when no image is available.').optional(),
      Summary: z.string().describe('The item summary, or an empty string when no summary is available.').optional(),
    }).describe('A Zhihu hot list item.')).describe('Hot list items.').optional(),
  }).describe('The Zhihu hot list response data.').optional(),
}).describe('A Zhihu hot list response.')

export const zhidaInput = z.strictObject({
  model: z.enum(['zhida-fast-1p5', 'zhida-thinking-1p5', 'zhida-agent']).describe('The Zhida model tier.').optional(),
  messages: z.array(z.strictObject({
    role: z.enum(['system', 'user', 'assistant']).describe('The message role.').optional(),
    content: z.string().min(1).describe('The message content.').optional(),
  }).describe('A message in a Zhida chat completion request.')).min(1).describe('Conversation messages to send to Zhida.').optional(),
}).describe('Input parameters for a non-streaming Zhida chat completion request.')

export const zhidaOutput = z.looseObject({
  id: z.string().describe('The completion identifier.').optional(),
  object: z.string().describe('The response object type.').optional(),
  created: z.int().describe('The creation Unix timestamp in seconds.').optional(),
  model: z.string().describe('The model that produced the response.').optional(),
  choices: z.array(z.looseObject({
    index: z.int().describe('The choice index.').optional(),
    message: z.looseObject({
      role: z.string().describe('The returned message role.').optional(),
      reasoning_content: z.string().describe('The model reasoning content when returned.').optional(),
      content: z.string().describe('The final answer content.').optional(),
    }).describe('The assistant message returned by Zhida.').optional(),
    finish_reason: z.string().describe('The reason the choice finished.').optional(),
  }).describe('A Zhida completion choice.')).describe('Completion choices.').optional(),
}).describe('A non-streaming Zhida chat completion response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const zhihuActions = {
  zhihu_search: {
    description: 'Search Zhihu content and return matching questions, answers, and articles.',
    effect: 'write',
    inputSchema: zhihuSearchInput,
    outputSchema: z.toJSONSchema(zhihuSearchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  global_search: {
    description: 'Search the global web index exposed by Zhihu Open Platform.',
    effect: 'write',
    inputSchema: globalSearchInput,
    outputSchema: z.toJSONSchema(globalSearchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  hot_list: {
    description: 'Get the current Zhihu hot list with titles, links, thumbnails, and summaries.',
    effect: 'write',
    inputSchema: hotListInput,
    outputSchema: z.toJSONSchema(hotListOutput, { io: 'output', unrepresentable: 'any' }),
  },
  zhida: {
    description: 'Create a non-streaming Zhihu Zhida chat completion.',
    effect: 'write',
    inputSchema: zhidaInput,
    outputSchema: z.toJSONSchema(zhidaOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
