/**
 * Langbase 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listMemoriesInput = z.strictObject({}).describe('This action does not require any input parameters.')

export const listMemoriesOutput = z.strictObject({
  memories: z.array(z.strictObject({
    name: z.string().describe('The memory name.'),
    description: z.string().describe('The memory description.'),
    ownerLogin: z.string().describe('The login of the memory owner.'),
    url: z.url().describe('The Langbase Studio URL for the memory.'),
    chunkSize: z.int().describe('The configured chunk size for this memory.').optional(),
    chunkOverlap: z.int().describe('The configured chunk overlap for this memory.').optional(),
    embeddingModel: z.enum(['openai:text-embedding-3-large', 'cohere:embed-v4.0', 'cohere:embed-multilingual-v3.0', 'cohere:embed-multilingual-light-v3.0', 'google:text-embedding-004']).describe('The embedding model configured for this memory.').optional(),
  }).describe('A Langbase memory summary.')).describe('The Langbase memories returned by the API.').optional(),
}).describe('The Langbase memories returned by the list endpoint.')

export const createMemoryInput = z.strictObject({
  name: z.string().min(1).describe('The memory name.'),
  description: z.string().describe('A short description of the memory.').optional(),
  embedding_model: z.enum(['openai:text-embedding-3-large', 'cohere:embed-v4.0', 'cohere:embed-multilingual-v3.0', 'cohere:embed-multilingual-light-v3.0', 'google:text-embedding-004']).describe('The embedding model to use for the memory.').optional(),
  chunk_size: z.int().max(30000).describe('The maximum number of characters in a chunk.').optional(),
  chunk_overlap: z.int().min(0).describe('The number of overlapping characters between adjacent chunks.').optional(),
  top_k: z.int().min(1).max(100).describe('The default number of chunks to return during retrieval.').optional(),
}).describe('Input parameters for creating a Langbase memory.')

export const createMemoryOutput = z.strictObject({
  memory: z.strictObject({
    name: z.string().describe('The memory name.'),
    description: z.string().describe('The memory description.'),
    ownerLogin: z.string().describe('The login of the memory owner.'),
    url: z.url().describe('The Langbase Studio URL for the memory.'),
    chunkSize: z.int().describe('The configured chunk size for this memory.').optional(),
    chunkOverlap: z.int().describe('The configured chunk overlap for this memory.').optional(),
    embeddingModel: z.enum(['openai:text-embedding-3-large', 'cohere:embed-v4.0', 'cohere:embed-multilingual-v3.0', 'cohere:embed-multilingual-light-v3.0', 'google:text-embedding-004']).describe('The embedding model configured for this memory.').optional(),
  }).describe('A Langbase memory summary.').optional(),
}).describe('The normalized Langbase memory returned by create.')

export const deleteMemoryInput = z.strictObject({
  memoryName: z.string().min(1).describe('The Langbase memory name to delete.').optional(),
}).describe('Input parameters for deleting a Langbase memory.')

export const deleteMemoryOutput = z.strictObject({
  success: z.boolean().describe('Whether Langbase deleted the memory successfully.').optional(),
}).describe('The Langbase delete result.')

export const retrieveMemoryInput = z.strictObject({
  query: z.string().min(1).describe('The search query used to retrieve similar chunks.'),
  memory: z.array(z.strictObject({
    name: z.string().min(1).describe('The name of the memory to search.'),
    filters: z.unknown().describe('Optional Langbase memory filters forwarded as-is, such as ["field", "Eq", "value"] or nested ["And"|"Or", ...] filter trees.').optional(),
  }).describe('A memory reference used during retrieval.')).min(1).describe('The Langbase memories to search.'),
  topK: z.int().min(1).max(100).describe('The number of top chunks to return.').optional(),
}).describe('Input parameters for retrieving similar chunks from Langbase memories.')

export const retrieveMemoryOutput = z.strictObject({
  matches: z.array(z.strictObject({
    text: z.string().describe('The retrieved text segment.').optional(),
    similarity: z.number().describe('The similarity score returned by Langbase.').optional(),
    meta: z.record(z.string(), z.string().describe('A metadata value.')).describe('Additional metadata returned for the retrieved chunk.').optional(),
  }).describe('A single retrieved Langbase memory chunk.')).describe('The retrieved Langbase memory matches.').optional(),
}).describe('The normalized Langbase retrieval results.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const langbaseActions = {
  list_memories: {
    description: 'List Langbase memories available to the connected User or Org API key and return stable memory summaries.',
    effect: 'read',
    inputSchema: listMemoriesInput,
    outputSchema: z.toJSONSchema(listMemoriesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_memory: {
    description: 'Create a Langbase memory with the official Memory Create API and return the normalized created memory summary.',
    effect: 'write',
    inputSchema: createMemoryInput,
    outputSchema: z.toJSONSchema(createMemoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_memory: {
    description: 'Delete an existing Langbase memory by name and return whether the delete request succeeded.',
    effect: 'destructive',
    inputSchema: deleteMemoryInput,
    outputSchema: z.toJSONSchema(deleteMemoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  retrieve_memory: {
    description: 'Retrieve similar chunks from one or more Langbase memories with the official Memory Retrieve API.',
    effect: 'read',
    inputSchema: retrieveMemoryInput,
    outputSchema: z.toJSONSchema(retrieveMemoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
