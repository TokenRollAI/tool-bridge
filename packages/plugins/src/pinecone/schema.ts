/**
 * Pinecone 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listIndexesInput = z.strictObject({}).describe('The input for listing Pinecone indexes.')

export const listIndexesOutput = z.strictObject({
  indexes: z.array(z.looseObject({
    name: z.string().describe('The index name.'),
    host: z.string().describe('The index host for data-plane operations.').optional(),
    dimension: z.int().describe('The vector dimension when present.').nullable().optional(),
    metric: z.string().describe('The similarity metric used by the index.').optional(),
    vector_type: z.string().describe('The vector type stored by the index.').optional(),
    deletion_protection: z.string().describe('Whether deletion protection is enabled for the index.').optional(),
    spec: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
    status: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
    tags: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
  }).describe('A Pinecone index description.')).describe('The indexes returned by Pinecone.').optional(),
}).describe('The Pinecone indexes response.')

export const describeIndexInput = z.strictObject({
  name: z.string().min(1).describe('The Pinecone index name. Index names must be unique within a project.').optional(),
}).describe('The input for describing one Pinecone index.')

export const describeIndexOutput = z.strictObject({
  index: z.looseObject({
    name: z.string().describe('The index name.'),
    host: z.string().describe('The index host for data-plane operations.').optional(),
    dimension: z.int().describe('The vector dimension when present.').nullable().optional(),
    metric: z.string().describe('The similarity metric used by the index.').optional(),
    vector_type: z.string().describe('The vector type stored by the index.').optional(),
    deletion_protection: z.string().describe('Whether deletion protection is enabled for the index.').optional(),
    spec: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
    status: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
    tags: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
  }).describe('A Pinecone index description.').optional(),
}).describe('The Pinecone index description response.')

export const createIndexInput = z.strictObject({
  name: z.string().min(1).describe('The Pinecone index name. Index names must be unique within a project.'),
  dimension: z.int().min(1).max(20000).describe('The vector dimension for dense indexes.').optional(),
  metric: z.enum(['cosine', 'euclidean', 'dotproduct']).describe('The similarity metric for the index.').optional(),
  cloud: z.enum(['aws', 'gcp', 'azure']).describe('The public cloud for a serverless index.'),
  region: z.string().min(1).describe('The cloud region where the serverless index is created.'),
  vectorType: z.enum(['dense', 'sparse']).describe('The index vector type.').optional(),
  deletionProtection: z.enum(['enabled', 'disabled']).describe('Whether deletion protection is enabled.').optional(),
  tags: z.record(z.string(), z.string().describe('One tag value.')).describe('The tags to attach to the index.').optional(),
}).describe('The input for creating a Pinecone serverless index.')

export const createIndexOutput = z.strictObject({
  index: z.looseObject({
    name: z.string().describe('The index name.'),
    host: z.string().describe('The index host for data-plane operations.').optional(),
    dimension: z.int().describe('The vector dimension when present.').nullable().optional(),
    metric: z.string().describe('The similarity metric used by the index.').optional(),
    vector_type: z.string().describe('The vector type stored by the index.').optional(),
    deletion_protection: z.string().describe('Whether deletion protection is enabled for the index.').optional(),
    spec: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
    status: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
    tags: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
  }).describe('A Pinecone index description.').optional(),
}).describe('The Pinecone create index response.')

export const configureIndexInput = z.strictObject({
  name: z.string().min(1).describe('The Pinecone index name. Index names must be unique within a project.'),
  deletionProtection: z.enum(['enabled', 'disabled']).describe('Whether deletion protection is enabled.').optional(),
  tags: z.record(z.string(), z.string().describe('One tag value.')).describe('The replacement tags to set on the index.').optional(),
  readCapacity: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
}).describe('The input for configuring an existing Pinecone index.')

export const configureIndexOutput = z.strictObject({
  index: z.looseObject({
    name: z.string().describe('The index name.'),
    host: z.string().describe('The index host for data-plane operations.').optional(),
    dimension: z.int().describe('The vector dimension when present.').nullable().optional(),
    metric: z.string().describe('The similarity metric used by the index.').optional(),
    vector_type: z.string().describe('The vector type stored by the index.').optional(),
    deletion_protection: z.string().describe('Whether deletion protection is enabled for the index.').optional(),
    spec: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
    status: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
    tags: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
  }).describe('A Pinecone index description.').optional(),
}).describe('The Pinecone configure index response.')

export const deleteIndexInput = z.strictObject({
  name: z.string().min(1).describe('The Pinecone index name. Index names must be unique within a project.').optional(),
}).describe('The input for deleting one Pinecone index.')

export const deleteIndexOutput = z.strictObject({
  accepted: z.boolean().describe('Whether Pinecone accepted the delete request.').optional(),
}).describe('The Pinecone delete index response.')

export const getIndexStatsInput = z.strictObject({
  indexHost: z.url().describe('The full Pinecone index host URL used for data-plane operations, such as https://example.svc.us-east-1-aws.pinecone.io.'),
  filter: z.looseObject({}).describe('The Pinecone metadata filter expression used to select records.').optional(),
}).describe('The input for retrieving Pinecone index statistics.')

export const getIndexStatsOutput = z.strictObject({
  stats: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
}).describe('The Pinecone index statistics response.')

export const upsertVectorsInput = z.strictObject({
  indexHost: z.url().describe('The full Pinecone index host URL used for data-plane operations, such as https://example.svc.us-east-1-aws.pinecone.io.'),
  vectors: z.array(z.strictObject({
    id: z.string().min(1).describe('The vector identifier.'),
    values: z.array(z.number().describe('One dense vector value.')).min(1).max(20000).describe('The dense vector values.').optional(),
    sparseValues: z.strictObject({
      indices: z.array(z.int().describe('One sparse vector index.')).min(1).max(2048).describe('The sparse vector indices.').optional(),
      values: z.array(z.number().describe('One value.')).min(1).max(2048).describe('The sparse vector values matching the indices array.').optional(),
    }).describe('The sparse vector values and indices.').optional(),
    metadata: z.looseObject({}).describe('The metadata object associated with a Pinecone record.').optional(),
  }).describe('One vector record to upsert into Pinecone.')).min(1).max(1000).describe('The vectors to upsert.'),
  namespace: z.string().min(1).describe('The Pinecone namespace to read or write.').optional(),
}).describe('The input for upserting vectors into Pinecone.')

export const upsertVectorsOutput = z.strictObject({
  upsertedCount: z.int().min(0).describe('The number of vectors upserted.').optional(),
  raw: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
}).describe('The Pinecone upsert response.')

export const queryVectorsInput = z.strictObject({
  indexHost: z.url().describe('The full Pinecone index host URL used for data-plane operations, such as https://example.svc.us-east-1-aws.pinecone.io.'),
  values: z.array(z.number().describe('One dense vector value.')).min(1).max(20000).describe('The dense vector values.').optional(),
  sparseValues: z.strictObject({
    indices: z.array(z.int().describe('One sparse vector index.')).min(1).max(2048).describe('The sparse vector indices.').optional(),
    values: z.array(z.number().describe('One value.')).min(1).max(2048).describe('The sparse vector values matching the indices array.').optional(),
  }).describe('The sparse vector values and indices.').optional(),
  id: z.string().min(1).describe('The vector ID to use as the query vector.').optional(),
  topK: z.int().min(1).max(10000).describe('The number of similar vectors to return.'),
  namespace: z.string().min(1).describe('The Pinecone namespace to read or write.').optional(),
  filter: z.looseObject({}).describe('The Pinecone metadata filter expression used to select records.').optional(),
  includeValues: z.boolean().describe('Whether to include vector values in the response.').optional(),
  includeMetadata: z.boolean().describe('Whether to include vector metadata in the response.').optional(),
}).describe('The input for querying Pinecone vectors.')

export const queryVectorsOutput = z.strictObject({
  matches: z.array(z.looseObject({}).describe('One match.')).describe('The vector matches returned by Pinecone.').optional(),
  namespace: z.string().describe('The namespace returned by Pinecone.').nullable().optional(),
  usage: z.looseObject({}).describe('The Pinecone usage object returned by the operation.').nullable().optional(),
  raw: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
}).describe('The Pinecone query response.')

export const fetchVectorsInput = z.strictObject({
  indexHost: z.url().describe('The full Pinecone index host URL used for data-plane operations, such as https://example.svc.us-east-1-aws.pinecone.io.'),
  ids: z.array(z.string().min(1).describe('One vector ID.')).min(1).max(1000).describe('The vector IDs to fetch.'),
  namespace: z.string().min(1).describe('The Pinecone namespace to read or write.').optional(),
}).describe('The input for fetching Pinecone vectors.')

export const fetchVectorsOutput = z.strictObject({
  vectors: z.record(z.string(), z.looseObject({
    id: z.string().describe('The vector identifier.'),
    values: z.array(z.number().describe('One dense vector value.')).min(1).max(20000).describe('The dense vector values.').optional(),
    sparseValues: z.strictObject({
      indices: z.array(z.int().describe('One sparse vector index.')).min(1).max(2048).describe('The sparse vector indices.').optional(),
      values: z.array(z.number().describe('One value.')).min(1).max(2048).describe('The sparse vector values matching the indices array.').optional(),
    }).describe('The sparse vector values and indices.').optional(),
    metadata: z.looseObject({}).describe('The metadata object associated with a Pinecone record.').optional(),
  }).describe('A vector record returned by Pinecone.')).describe('The vectors keyed by ID.').optional(),
  namespace: z.string().describe('The namespace returned by Pinecone.').nullable().optional(),
  usage: z.looseObject({}).describe('The Pinecone usage object returned by the operation.').nullable().optional(),
  raw: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
}).describe('The Pinecone fetch vectors response.')

export const listVectorIdsInput = z.strictObject({
  indexHost: z.url().describe('The full Pinecone index host URL used for data-plane operations, such as https://example.svc.us-east-1-aws.pinecone.io.'),
  namespace: z.string().min(1).describe('The Pinecone namespace to read or write.').optional(),
  prefix: z.string().min(1).describe('The ID prefix used to filter vector IDs.').optional(),
  limit: z.int().min(1).max(1000).describe('The maximum number of IDs to return.').optional(),
  paginationToken: z.string().min(1).describe('The pagination token returned by a previous Pinecone response.').optional(),
}).describe('The input for listing Pinecone vector IDs.')

export const listVectorIdsOutput = z.strictObject({
  vectors: z.array(z.looseObject({}).describe('One vector ID object.')).describe('The vector ID objects returned by Pinecone.').optional(),
  pagination: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').nullable().optional(),
  raw: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
}).describe('The Pinecone list vector IDs response.')

export const deleteVectorsInput = z.strictObject({
  indexHost: z.url().describe('The full Pinecone index host URL used for data-plane operations, such as https://example.svc.us-east-1-aws.pinecone.io.'),
  ids: z.array(z.string().min(1).describe('One vector ID.')).min(1).max(1000).describe('The vector IDs to delete.').optional(),
  namespace: z.string().min(1).describe('The Pinecone namespace to read or write.').optional(),
  filter: z.looseObject({}).describe('The Pinecone metadata filter expression used to select records.').optional(),
  deleteAll: z.boolean().describe('Whether to delete all records in the namespace.').optional(),
}).describe('The input for deleting Pinecone vectors.')

export const deleteVectorsOutput = z.strictObject({
  raw: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
}).describe('The Pinecone delete vectors response.')

export const updateVectorInput = z.strictObject({
  indexHost: z.url().describe('The full Pinecone index host URL used for data-plane operations, such as https://example.svc.us-east-1-aws.pinecone.io.'),
  id: z.string().min(1).describe('The vector ID to update.').optional(),
  values: z.array(z.number().describe('One dense vector value.')).min(1).max(20000).describe('The dense vector values.').optional(),
  sparseValues: z.strictObject({
    indices: z.array(z.int().describe('One sparse vector index.')).min(1).max(2048).describe('The sparse vector indices.').optional(),
    values: z.array(z.number().describe('One value.')).min(1).max(2048).describe('The sparse vector values matching the indices array.').optional(),
  }).describe('The sparse vector values and indices.').optional(),
  setMetadata: z.looseObject({}).describe('The metadata object associated with a Pinecone record.').optional(),
  namespace: z.string().min(1).describe('The Pinecone namespace to read or write.').optional(),
  filter: z.looseObject({}).describe('The Pinecone metadata filter expression used to select records.').optional(),
  dryRun: z.boolean().describe('Whether to count matching records without applying the update.').optional(),
}).describe('The input for updating Pinecone vectors.')

export const updateVectorOutput = z.strictObject({
  matchedRecords: z.int().min(0).describe('The number of records matched when Pinecone returns a count.').nullable().optional(),
  raw: z.looseObject({}).describe('A JSON object accepted or returned by Pinecone.').optional(),
}).describe('The Pinecone update vector response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const pineconeActions = {
  list_indexes: {
    description: 'List Pinecone indexes in the authenticated project.',
    effect: 'read',
    inputSchema: listIndexesInput,
    outputSchema: z.toJSONSchema(listIndexesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  describe_index: {
    description: 'Describe one Pinecone index by name.',
    effect: 'read',
    inputSchema: describeIndexInput,
    outputSchema: z.toJSONSchema(describeIndexOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_index: {
    description: 'Create a Pinecone serverless index.',
    effect: 'write',
    inputSchema: createIndexInput,
    outputSchema: z.toJSONSchema(createIndexOutput, { io: 'output', unrepresentable: 'any' }),
  },
  configure_index: {
    description: 'Configure an existing Pinecone index.',
    effect: 'write',
    inputSchema: configureIndexInput,
    outputSchema: z.toJSONSchema(configureIndexOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_index: {
    description: 'Delete one Pinecone index by name.',
    effect: 'destructive',
    inputSchema: deleteIndexInput,
    outputSchema: z.toJSONSchema(deleteIndexOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_index_stats: {
    description: 'Get statistics for a Pinecone index.',
    effect: 'read',
    inputSchema: getIndexStatsInput,
    outputSchema: z.toJSONSchema(getIndexStatsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  upsert_vectors: {
    description: 'Upsert dense or sparse vectors into a Pinecone index namespace.',
    effect: 'write',
    inputSchema: upsertVectorsInput,
    outputSchema: z.toJSONSchema(upsertVectorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  query_vectors: {
    description: 'Search a Pinecone index namespace with a query vector.',
    effect: 'write',
    inputSchema: queryVectorsInput,
    outputSchema: z.toJSONSchema(queryVectorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  fetch_vectors: {
    description: 'Fetch Pinecone vectors by ID from one namespace.',
    effect: 'read',
    inputSchema: fetchVectorsInput,
    outputSchema: z.toJSONSchema(fetchVectorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_vector_ids: {
    description: 'List vector IDs in a Pinecone serverless index namespace.',
    effect: 'read',
    inputSchema: listVectorIdsInput,
    outputSchema: z.toJSONSchema(listVectorIdsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_vectors: {
    description: 'Delete vectors from a Pinecone index namespace by IDs, filter, or deleteAll.',
    effect: 'destructive',
    inputSchema: deleteVectorsInput,
    outputSchema: z.toJSONSchema(deleteVectorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_vector: {
    description: 'Update one Pinecone vector or metadata-matched records in a namespace.',
    effect: 'write',
    inputSchema: updateVectorInput,
    outputSchema: z.toJSONSchema(updateVectorOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
