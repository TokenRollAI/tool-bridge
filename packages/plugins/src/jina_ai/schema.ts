/**
 * Jina AI 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const createEmbeddingsInput = z.strictObject({
  model: z.string().describe('The Jina AI embedding model identifier.'),
  input: z.array(z.union([z.string().describe('Text to embed.'), z.looseObject({}).describe('A JSON object returned by Jina AI.')]).describe('A text or multimodal embedding input.')).min(1).describe('The texts or multimodal inputs to embed.'),
  encoding_format: z.string().describe('The encoding format for returned embeddings.').optional(),
  dimensions: z.int().describe('The requested embedding dimensionality.').optional(),
  normalized: z.boolean().describe('Whether returned embeddings should be normalized.').optional(),
}).describe('Input for generating embeddings with Jina AI.')

export const createEmbeddingsOutput = z.looseObject({}).describe('A JSON object returned by Jina AI.')

export const rerankDocumentsInput = z.strictObject({
  model: z.string().describe('The Jina AI reranker model identifier.'),
  query: z.string().describe('The query used to rank documents.'),
  documents: z.array(z.string().describe('A document to rank.')).min(1).describe('The documents to rank.'),
  top_n: z.int().describe('The maximum number of results to return.').optional(),
  return_documents: z.boolean().describe('Whether to include document text in each result.').optional(),
}).describe('Input for ranking documents by relevance with Jina AI.')

export const rerankDocumentsOutput = z.looseObject({}).describe('A JSON object returned by Jina AI.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const jinaAiActions = {
  create_embeddings: {
    description: 'Create vector embeddings for text or multimodal inputs with Jina AI.',
    effect: 'write',
    inputSchema: createEmbeddingsInput,
    outputSchema: z.toJSONSchema(createEmbeddingsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  rerank_documents: {
    description: 'Rank documents by relevance to a query with Jina AI.',
    effect: 'write',
    inputSchema: rerankDocumentsInput,
    outputSchema: z.toJSONSchema(rerankDocumentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
