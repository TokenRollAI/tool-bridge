/**
 * Accredible Certificates 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listGroupsInput = z.strictObject({}).describe('The input payload for listing Accredible groups.')

export const listGroupsOutput = z.strictObject({
  groups: z.array(z.strictObject({
    id: z.number().describe('The Accredible group ID.').optional(),
    name: z.string().describe('The group name.').nullable().optional(),
    courseName: z.string().describe('The group course name.').nullable().optional(),
    courseDescription: z.string().describe('The group course description.').nullable().optional(),
    language: z.string().describe('The group language code.').nullable().optional(),
    designName: z.string().describe('The associated design name.').nullable().optional(),
    departmentId: z.number().describe('The Accredible department ID when returned.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw group object returned by Accredible.').optional(),
  }).describe('Normalized Accredible group details.')).describe('The groups returned by Accredible.').optional(),
  meta: z.strictObject({
    currentPage: z.number().describe('The current page reported by Accredible.').nullable().optional(),
    nextPage: z.number().describe('The next page reported by Accredible.').nullable().optional(),
    prevPage: z.number().describe('The previous page reported by Accredible.').nullable().optional(),
    totalPages: z.number().describe('The total page count reported by Accredible.').nullable().optional(),
    totalCount: z.number().describe('The total item count reported by Accredible.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw pagination object returned by Accredible.').optional(),
  }).describe('Normalized Accredible pagination metadata.').optional(),
}).describe('The response returned when listing Accredible groups.')

export const getGroupInput = z.strictObject({
  group_id: z.int().min(1).describe('The Accredible group ID.').optional(),
}).describe('The input payload for reading one Accredible group.')

export const getGroupOutput = z.strictObject({
  group: z.strictObject({
    id: z.number().describe('The Accredible group ID.').optional(),
    name: z.string().describe('The group name.').nullable().optional(),
    courseName: z.string().describe('The group course name.').nullable().optional(),
    courseDescription: z.string().describe('The group course description.').nullable().optional(),
    language: z.string().describe('The group language code.').nullable().optional(),
    designName: z.string().describe('The associated design name.').nullable().optional(),
    departmentId: z.number().describe('The Accredible department ID when returned.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw group object returned by Accredible.').optional(),
  }).describe('Normalized Accredible group details.').optional(),
}).describe('The response returned when reading one Accredible group.')

export const searchGroupsInput = z.strictObject({
  ids: z.array(z.int().min(1).describe('The Accredible group ID.')).min(1).describe('The Accredible group IDs to include.').optional(),
  name: z.string().min(1).regex(new RegExp('\\S')).describe('A group name substring used for partial matching.').optional(),
  course_name: z.string().min(1).regex(new RegExp('\\S')).describe('A course name substring used for partial matching.').optional(),
  department_id: z.int().min(1).describe('The Accredible department ID to filter by.').optional(),
  meta_data: z.record(z.string(), z.string().describe('A metadata value.')).describe('String metadata key/value pairs passed through to Accredible.').optional(),
  start_updated_date: z.iso.date().describe('A date filter in YYYY-MM-DD format.').optional(),
  end_updated_date: z.iso.date().describe('A date filter in YYYY-MM-DD format.').optional(),
  page_size: z.int().min(1).describe('The number of results to request from Accredible.').optional(),
  page: z.int().min(1).describe('The page number to request from Accredible.').optional(),
}).describe('The input payload for searching Accredible groups.')

export const searchGroupsOutput = z.strictObject({
  groups: z.array(z.strictObject({
    id: z.number().describe('The Accredible group ID.').optional(),
    name: z.string().describe('The group name.').nullable().optional(),
    courseName: z.string().describe('The group course name.').nullable().optional(),
    courseDescription: z.string().describe('The group course description.').nullable().optional(),
    language: z.string().describe('The group language code.').nullable().optional(),
    designName: z.string().describe('The associated design name.').nullable().optional(),
    departmentId: z.number().describe('The Accredible department ID when returned.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw group object returned by Accredible.').optional(),
  }).describe('Normalized Accredible group details.')).describe('The groups returned by Accredible.').optional(),
  meta: z.strictObject({
    currentPage: z.number().describe('The current page reported by Accredible.').nullable().optional(),
    nextPage: z.number().describe('The next page reported by Accredible.').nullable().optional(),
    prevPage: z.number().describe('The previous page reported by Accredible.').nullable().optional(),
    totalPages: z.number().describe('The total page count reported by Accredible.').nullable().optional(),
    totalCount: z.number().describe('The total item count reported by Accredible.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw pagination object returned by Accredible.').optional(),
  }).describe('Normalized Accredible pagination metadata.').optional(),
}).describe('The response returned when searching Accredible groups.')

export const listCredentialsInput = z.strictObject({
  group_id: z.union([z.int().min(1).describe('A numeric Accredible ID.'), z.string().min(1).regex(new RegExp('\\S')).describe('A string Accredible ID.')]).describe('An Accredible ID represented as either a number or string.').optional(),
  email: z.email().describe('The recipient email address to filter credentials by.').optional(),
  recipient_id: z.union([z.int().min(1).describe('A numeric Accredible ID.'), z.string().min(1).regex(new RegExp('\\S')).describe('A string Accredible ID.')]).describe('An Accredible ID represented as either a number or string.').optional(),
  license_id: z.string().min(1).regex(new RegExp('\\S')).describe('The Accredible license ID to filter credentials by.').optional(),
  start_date: z.iso.date().describe('A date filter in YYYY-MM-DD format.').optional(),
  end_date: z.iso.date().describe('A date filter in YYYY-MM-DD format.').optional(),
  start_updated_date: z.iso.date().describe('A date filter in YYYY-MM-DD format.').optional(),
  end_updated_date: z.iso.date().describe('A date filter in YYYY-MM-DD format.').optional(),
  page_size: z.int().min(1).describe('The number of results to request from Accredible.').optional(),
  page: z.int().min(1).describe('The page number to request from Accredible.').optional(),
}).describe('The input payload for listing Accredible credentials.')

export const listCredentialsOutput = z.strictObject({
  credentials: z.array(z.strictObject({
    id: z.string().describe('The credential ID as a string.').optional(),
    name: z.string().describe('The credential name.').nullable().optional(),
    description: z.string().describe('The credential description.').nullable().optional(),
    complete: z.boolean().describe('Whether Accredible marks the credential complete.').nullable().optional(),
    issuedOn: z.string().describe('The credential issue date returned by Accredible.').nullable().optional(),
    expiredOn: z.string().describe('The credential expiry date returned by Accredible.').nullable().optional(),
    groupId: z.number().describe('The Accredible group ID when returned.').nullable().optional(),
    groupName: z.string().describe('The Accredible group name when returned.').nullable().optional(),
    url: z.string().describe('The public credential URL when returned.').nullable().optional(),
    encodedId: z.string().describe('The encoded credential ID when returned.').nullable().optional(),
    private: z.boolean().describe('Whether the credential is private.').nullable().optional(),
    recipient: z.strictObject({
      id: z.string().describe('The Accredible recipient ID when returned.').nullable().optional(),
      name: z.string().describe('The recipient name.').nullable().optional(),
      email: z.string().describe('The recipient email address.').nullable().optional(),
      metaData: z.looseObject({}).describe('The recipient metadata returned by Accredible.').nullable().optional(),
    }).describe('Normalized Accredible recipient details.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw credential object returned by Accredible.').optional(),
  }).describe('Normalized Accredible credential details.')).describe('The credentials returned by Accredible.').optional(),
  meta: z.strictObject({
    currentPage: z.number().describe('The current page reported by Accredible.').nullable().optional(),
    nextPage: z.number().describe('The next page reported by Accredible.').nullable().optional(),
    prevPage: z.number().describe('The previous page reported by Accredible.').nullable().optional(),
    totalPages: z.number().describe('The total page count reported by Accredible.').nullable().optional(),
    totalCount: z.number().describe('The total item count reported by Accredible.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw pagination object returned by Accredible.').optional(),
  }).describe('Normalized Accredible pagination metadata.').optional(),
}).describe('The response returned when listing Accredible credentials.')

export const getCredentialInput = z.strictObject({
  id: z.string().min(1).regex(new RegExp('\\S')).describe('The Accredible credential identifier.').optional(),
}).describe('The input payload for reading one Accredible credential.')

export const getCredentialOutput = z.strictObject({
  credential: z.strictObject({
    id: z.string().describe('The credential ID as a string.').optional(),
    name: z.string().describe('The credential name.').nullable().optional(),
    description: z.string().describe('The credential description.').nullable().optional(),
    complete: z.boolean().describe('Whether Accredible marks the credential complete.').nullable().optional(),
    issuedOn: z.string().describe('The credential issue date returned by Accredible.').nullable().optional(),
    expiredOn: z.string().describe('The credential expiry date returned by Accredible.').nullable().optional(),
    groupId: z.number().describe('The Accredible group ID when returned.').nullable().optional(),
    groupName: z.string().describe('The Accredible group name when returned.').nullable().optional(),
    url: z.string().describe('The public credential URL when returned.').nullable().optional(),
    encodedId: z.string().describe('The encoded credential ID when returned.').nullable().optional(),
    private: z.boolean().describe('Whether the credential is private.').nullable().optional(),
    recipient: z.strictObject({
      id: z.string().describe('The Accredible recipient ID when returned.').nullable().optional(),
      name: z.string().describe('The recipient name.').nullable().optional(),
      email: z.string().describe('The recipient email address.').nullable().optional(),
      metaData: z.looseObject({}).describe('The recipient metadata returned by Accredible.').nullable().optional(),
    }).describe('Normalized Accredible recipient details.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw credential object returned by Accredible.').optional(),
  }).describe('Normalized Accredible credential details.').optional(),
}).describe('The response returned when reading one Accredible credential.')

export const searchCredentialsInput = z.strictObject({
  'group_id': z.union([z.int().min(1).describe('A numeric Accredible ID.'), z.string().min(1).regex(new RegExp('\\S')).describe('A string Accredible ID.')]).describe('An Accredible ID represented as either a number or string.').optional(),
  'recipient.name': z.string().min(1).regex(new RegExp('\\S')).describe('A recipient name substring used for matching.').optional(),
  'recipient.email': z.email().describe('The recipient email address to match.').optional(),
  'recipient.id': z.union([z.int().min(1).describe('A numeric Accredible ID.'), z.string().min(1).regex(new RegExp('\\S')).describe('A string Accredible ID.')]).describe('An Accredible ID represented as either a number or string.').optional(),
  'recipient.meta_data': z.looseObject({}).describe('Provider-defined metadata object passed through to Accredible.').optional(),
  'license_id': z.string().min(1).regex(new RegExp('\\S')).describe('The Accredible license ID to filter credentials by.').optional(),
  'meta_data': z.looseObject({}).describe('Provider-defined metadata object passed through to Accredible.').optional(),
  'start_date': z.iso.date().describe('A date filter in YYYY-MM-DD format.').optional(),
  'end_date': z.iso.date().describe('A date filter in YYYY-MM-DD format.').optional(),
  'start_updated_date': z.iso.date().describe('A date filter in YYYY-MM-DD format.').optional(),
  'end_updated_date': z.iso.date().describe('A date filter in YYYY-MM-DD format.').optional(),
  'page_size': z.int().min(1).describe('The number of results to request from Accredible.').optional(),
  'page': z.int().min(1).describe('The page number to request from Accredible.').optional(),
}).describe('The input payload for searching Accredible credentials.')

export const searchCredentialsOutput = z.strictObject({
  credentials: z.array(z.strictObject({
    id: z.string().describe('The credential ID as a string.').optional(),
    name: z.string().describe('The credential name.').nullable().optional(),
    description: z.string().describe('The credential description.').nullable().optional(),
    complete: z.boolean().describe('Whether Accredible marks the credential complete.').nullable().optional(),
    issuedOn: z.string().describe('The credential issue date returned by Accredible.').nullable().optional(),
    expiredOn: z.string().describe('The credential expiry date returned by Accredible.').nullable().optional(),
    groupId: z.number().describe('The Accredible group ID when returned.').nullable().optional(),
    groupName: z.string().describe('The Accredible group name when returned.').nullable().optional(),
    url: z.string().describe('The public credential URL when returned.').nullable().optional(),
    encodedId: z.string().describe('The encoded credential ID when returned.').nullable().optional(),
    private: z.boolean().describe('Whether the credential is private.').nullable().optional(),
    recipient: z.strictObject({
      id: z.string().describe('The Accredible recipient ID when returned.').nullable().optional(),
      name: z.string().describe('The recipient name.').nullable().optional(),
      email: z.string().describe('The recipient email address.').nullable().optional(),
      metaData: z.looseObject({}).describe('The recipient metadata returned by Accredible.').nullable().optional(),
    }).describe('Normalized Accredible recipient details.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw credential object returned by Accredible.').optional(),
  }).describe('Normalized Accredible credential details.')).describe('The credentials returned by Accredible.').optional(),
  meta: z.strictObject({
    currentPage: z.number().describe('The current page reported by Accredible.').nullable().optional(),
    nextPage: z.number().describe('The next page reported by Accredible.').nullable().optional(),
    prevPage: z.number().describe('The previous page reported by Accredible.').nullable().optional(),
    totalPages: z.number().describe('The total page count reported by Accredible.').nullable().optional(),
    totalCount: z.number().describe('The total item count reported by Accredible.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw pagination object returned by Accredible.').optional(),
  }).describe('Normalized Accredible pagination metadata.').optional(),
}).describe('The response returned when searching Accredible credentials.')

export const createCredentialInput = z.strictObject({
  'id': z.string().min(1).regex(new RegExp('\\S')).describe('The issuer-defined credential ID.').optional(),
  'group_id': z.int().min(1).describe('The Accredible group ID.'),
  'recipient.name': z.string().min(1).regex(new RegExp('\\S')).describe('The recipient name.'),
  'recipient.email': z.email().describe('The recipient email address.'),
  'recipient.phone_number': z.string().min(1).regex(new RegExp('\\S')).describe('The recipient phone number.').optional(),
  'recipient.id': z.union([z.int().min(1).describe('A numeric Accredible ID.'), z.string().min(1).regex(new RegExp('\\S')).describe('A string Accredible ID.')]).describe('An Accredible ID represented as either a number or string.').optional(),
  'recipient.meta_data': z.looseObject({}).describe('Provider-defined metadata object passed through to Accredible.').optional(),
  'name': z.string().min(1).regex(new RegExp('\\S')).describe('The credential name.').optional(),
  'description': z.string().min(1).regex(new RegExp('\\S')).describe('The credential description.').optional(),
  'custom_attributes': z.looseObject({}).describe('Provider-defined metadata object passed through to Accredible.').optional(),
  'issued_on': z.iso.date().describe('A date filter in YYYY-MM-DD format.').optional(),
  'expired_on': z.iso.date().describe('A date filter in YYYY-MM-DD format.').optional(),
  'complete': z.boolean().describe('Whether the credential should be marked complete.').optional(),
  'private': z.boolean().describe('Whether Accredible should create the credential as private.').optional(),
  'approve': z.boolean().describe('Whether Accredible should approve the credential.').optional(),
  'allow_supplemental_evidence': z.boolean().describe('Whether supplemental evidence is allowed for the credential.').optional(),
  'allow_supplemental_references': z.boolean().describe('Whether supplemental references are allowed for the credential.').optional(),
  'meta_data': z.looseObject({}).describe('Provider-defined metadata object passed through to Accredible.').optional(),
}).describe('The input payload for creating one Accredible credential.')

export const createCredentialOutput = z.strictObject({
  credential: z.strictObject({
    id: z.string().describe('The credential ID as a string.').optional(),
    name: z.string().describe('The credential name.').nullable().optional(),
    description: z.string().describe('The credential description.').nullable().optional(),
    complete: z.boolean().describe('Whether Accredible marks the credential complete.').nullable().optional(),
    issuedOn: z.string().describe('The credential issue date returned by Accredible.').nullable().optional(),
    expiredOn: z.string().describe('The credential expiry date returned by Accredible.').nullable().optional(),
    groupId: z.number().describe('The Accredible group ID when returned.').nullable().optional(),
    groupName: z.string().describe('The Accredible group name when returned.').nullable().optional(),
    url: z.string().describe('The public credential URL when returned.').nullable().optional(),
    encodedId: z.string().describe('The encoded credential ID when returned.').nullable().optional(),
    private: z.boolean().describe('Whether the credential is private.').nullable().optional(),
    recipient: z.strictObject({
      id: z.string().describe('The Accredible recipient ID when returned.').nullable().optional(),
      name: z.string().describe('The recipient name.').nullable().optional(),
      email: z.string().describe('The recipient email address.').nullable().optional(),
      metaData: z.looseObject({}).describe('The recipient metadata returned by Accredible.').nullable().optional(),
    }).describe('Normalized Accredible recipient details.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw credential object returned by Accredible.').optional(),
  }).describe('Normalized Accredible credential details.').optional(),
}).describe('The response returned when creating one Accredible credential.')

export const deleteCredentialInput = z.strictObject({
  id: z.string().min(1).regex(new RegExp('\\S')).describe('The Accredible credential identifier.').optional(),
}).describe('The input payload for deleting one Accredible credential.')

export const deleteCredentialOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the delete request completed successfully.').optional(),
  credential: z.strictObject({
    id: z.string().describe('The credential ID as a string.').optional(),
    name: z.string().describe('The credential name.').nullable().optional(),
    description: z.string().describe('The credential description.').nullable().optional(),
    complete: z.boolean().describe('Whether Accredible marks the credential complete.').nullable().optional(),
    issuedOn: z.string().describe('The credential issue date returned by Accredible.').nullable().optional(),
    expiredOn: z.string().describe('The credential expiry date returned by Accredible.').nullable().optional(),
    groupId: z.number().describe('The Accredible group ID when returned.').nullable().optional(),
    groupName: z.string().describe('The Accredible group name when returned.').nullable().optional(),
    url: z.string().describe('The public credential URL when returned.').nullable().optional(),
    encodedId: z.string().describe('The encoded credential ID when returned.').nullable().optional(),
    private: z.boolean().describe('Whether the credential is private.').nullable().optional(),
    recipient: z.strictObject({
      id: z.string().describe('The Accredible recipient ID when returned.').nullable().optional(),
      name: z.string().describe('The recipient name.').nullable().optional(),
      email: z.string().describe('The recipient email address.').nullable().optional(),
      metaData: z.looseObject({}).describe('The recipient metadata returned by Accredible.').nullable().optional(),
    }).describe('Normalized Accredible recipient details.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw credential object returned by Accredible.').optional(),
  }).describe('Normalized Accredible credential details.').nullable().optional(),
}).describe('The response returned when deleting one Accredible credential.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const accredibleCertificatesActions = {
  list_groups: {
    description: 'List Accredible credential groups available to the API key.',
    effect: 'read',
    inputSchema: listGroupsInput,
    outputSchema: z.toJSONSchema(listGroupsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_group: {
    description: 'Get one Accredible credential group by group ID.',
    effect: 'read',
    inputSchema: getGroupInput,
    outputSchema: z.toJSONSchema(getGroupOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_groups: {
    description: 'Search Accredible credential groups with documented filters.',
    effect: 'read',
    inputSchema: searchGroupsInput,
    outputSchema: z.toJSONSchema(searchGroupsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_credentials: {
    description: 'List Accredible credentials with documented query filters.',
    effect: 'read',
    inputSchema: listCredentialsInput,
    outputSchema: z.toJSONSchema(listCredentialsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_credential: {
    description: 'Get one Accredible credential by credential ID.',
    effect: 'read',
    inputSchema: getCredentialInput,
    outputSchema: z.toJSONSchema(getCredentialOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_credentials: {
    description: 'Search Accredible credentials with documented filters.',
    effect: 'read',
    inputSchema: searchCredentialsInput,
    outputSchema: z.toJSONSchema(searchCredentialsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_credential: {
    description: 'Create one Accredible credential using JSON recipient and group fields.',
    effect: 'write',
    inputSchema: createCredentialInput,
    outputSchema: z.toJSONSchema(createCredentialOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_credential: {
    description: 'Delete one Accredible credential by credential ID.',
    effect: 'destructive',
    inputSchema: deleteCredentialInput,
    outputSchema: z.toJSONSchema(deleteCredentialOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
