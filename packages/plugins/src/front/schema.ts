/**
 * Front 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listContactsInput = z.strictObject({
  query: z.string().min(1).describe('Optional Front contact query object string for updated_after and updated_before filters.').optional(),
  limit: z.int().min(1).max(100).describe('Maximum number of contacts per page.').optional(),
  pageToken: z.string().min(1).describe('Front page token returned by a previous list_contacts call.').optional(),
  sortBy: z.enum(['created_at', 'updated_at']).describe('Field used to sort contacts.').optional(),
  sortOrder: z.enum(['asc', 'desc']).describe('Order by which contacts should be sorted.').optional(),
}).describe('Input for listing Front contacts.')

export const listContactsOutput = z.strictObject({
  contacts: z.array(z.strictObject({
    id: z.string().describe('Unique identifier of the contact.'),
    name: z.string().describe('Contact name.').nullable(),
    description: z.string().describe('Contact description.').nullable(),
    avatarUrl: z.string().describe('URL of the contact avatar when Front returns one.').nullable(),
    links: z.array(z.string().describe('A contact link URL.')).describe('Links associated with the contact.'),
    lists: z.array(z.strictObject({
      id: z.string().describe('Unique identifier of the contact list.'),
      name: z.string().describe('Name of the contact list.'),
      isPrivate: z.boolean().describe('Whether the contact list is private.'),
    }).describe('A Front contact list summary.')).describe('Contact lists that contain the contact.'),
    handles: z.array(z.strictObject({
      handle: z.string().min(1).describe('The handle value, such as an email address or phone number.'),
      source: z.enum(['twitter', 'email', 'phone', 'facebook', 'intercom', 'front_chat', 'custom']).describe('The Front contact handle source.'),
    }).describe('A handle with which a Front contact can be reached.')).describe('Handles with which the contact is reachable.'),
    customFields: z.looseObject({}).describe('Custom fields keyed by the custom field name configured in Front.').optional(),
    isPrivate: z.boolean().describe('Whether the contact is private.'),
  }).describe('A normalized Front contact.')).describe('Contacts returned by Front.'),
  pagination: z.strictObject({
    next: z.string().describe('Link to the next page of results when Front returns one.').nullable(),
    nextPageToken: z.string().describe('Token extracted from the next page link for the next connector call.').nullable(),
  }).describe('Front cursor pagination metadata.'),
}).describe('The Front contacts page.')

export const getContactInput = z.strictObject({
  contactId: z.string().min(1).describe('The Front contact ID, or a documented resource alias such as source:handle.'),
}).describe('Input for fetching one Front contact.')

export const getContactOutput = z.strictObject({
  contact: z.strictObject({
    id: z.string().describe('Unique identifier of the contact.'),
    name: z.string().describe('Contact name.').nullable(),
    description: z.string().describe('Contact description.').nullable(),
    avatarUrl: z.string().describe('URL of the contact avatar when Front returns one.').nullable(),
    links: z.array(z.string().describe('A contact link URL.')).describe('Links associated with the contact.'),
    lists: z.array(z.strictObject({
      id: z.string().describe('Unique identifier of the contact list.'),
      name: z.string().describe('Name of the contact list.'),
      isPrivate: z.boolean().describe('Whether the contact list is private.'),
    }).describe('A Front contact list summary.')).describe('Contact lists that contain the contact.'),
    handles: z.array(z.strictObject({
      handle: z.string().min(1).describe('The handle value, such as an email address or phone number.'),
      source: z.enum(['twitter', 'email', 'phone', 'facebook', 'intercom', 'front_chat', 'custom']).describe('The Front contact handle source.'),
    }).describe('A handle with which a Front contact can be reached.')).describe('Handles with which the contact is reachable.'),
    customFields: z.looseObject({}).describe('Custom fields keyed by the custom field name configured in Front.').optional(),
    isPrivate: z.boolean().describe('Whether the contact is private.'),
  }).describe('A normalized Front contact.'),
}).describe('The Front contact response.')

export const createContactInput = z.strictObject({
  handles: z.array(z.strictObject({
    handle: z.string().min(1).describe('The handle value, such as an email address or phone number.'),
    source: z.enum(['twitter', 'email', 'phone', 'facebook', 'intercom', 'front_chat', 'custom']).describe('The Front contact handle source.'),
  }).describe('A handle with which a Front contact can be reached.')).min(1).describe('Handles with which the contact is reachable.'),
  contact: z.strictObject({
    name: z.string().min(1).describe('Contact name.').optional(),
    description: z.string().min(1).describe('Contact description.').optional(),
    links: z.array(z.string().min(1).describe('A contact link URL.')).describe('Links associated with the contact.').optional(),
    listNames: z.array(z.string().min(1).describe('A contact list name.')).describe('Contact list names the contact belongs to. Front creates missing lists automatically.').optional(),
    customFields: z.looseObject({}).describe('Custom fields keyed by the custom field name configured in Front.').optional(),
  }).describe('JSON fields accepted by Front for contact create and update requests.'),
}).describe('Input for creating a Front company contact.')

export const createContactOutput = z.strictObject({
  contact: z.strictObject({
    id: z.string().describe('Unique identifier of the contact.'),
    name: z.string().describe('Contact name.').nullable(),
    description: z.string().describe('Contact description.').nullable(),
    avatarUrl: z.string().describe('URL of the contact avatar when Front returns one.').nullable(),
    links: z.array(z.string().describe('A contact link URL.')).describe('Links associated with the contact.'),
    lists: z.array(z.strictObject({
      id: z.string().describe('Unique identifier of the contact list.'),
      name: z.string().describe('Name of the contact list.'),
      isPrivate: z.boolean().describe('Whether the contact list is private.'),
    }).describe('A Front contact list summary.')).describe('Contact lists that contain the contact.'),
    handles: z.array(z.strictObject({
      handle: z.string().min(1).describe('The handle value, such as an email address or phone number.'),
      source: z.enum(['twitter', 'email', 'phone', 'facebook', 'intercom', 'front_chat', 'custom']).describe('The Front contact handle source.'),
    }).describe('A handle with which a Front contact can be reached.')).describe('Handles with which the contact is reachable.'),
    customFields: z.looseObject({}).describe('Custom fields keyed by the custom field name configured in Front.').optional(),
    isPrivate: z.boolean().describe('Whether the contact is private.'),
  }).describe('A normalized Front contact.'),
}).describe('The Front contact created by the API.')

export const updateContactInput = z.strictObject({
  contactId: z.string().min(1).describe('The Front contact ID, or a documented resource alias such as source:handle.'),
  contact: z.strictObject({
    name: z.string().min(1).describe('Contact name.').optional(),
    description: z.string().min(1).describe('Contact description.').optional(),
    links: z.array(z.string().min(1).describe('A contact link URL.')).describe('Links associated with the contact.').optional(),
    listNames: z.array(z.string().min(1).describe('A contact list name.')).describe('Contact list names the contact belongs to. Front creates missing lists automatically.').optional(),
    customFields: z.looseObject({}).describe('Custom fields keyed by the custom field name configured in Front.').optional(),
  }).describe('JSON fields accepted by Front for contact create and update requests.'),
}).describe('Input for updating a Front contact.')

export const updateContactOutput = z.strictObject({
  success: z.boolean().describe('Whether Front accepted the update request.'),
}).describe('The result of updating a Front contact.')

export const listTeammatesInput = z.strictObject({}).describe('Input for listing Front teammates.')

export const listTeammatesOutput = z.strictObject({
  teammates: z.array(z.strictObject({
    id: z.string().describe('Unique identifier of the teammate.'),
    email: z.string().describe('Email address of the teammate.'),
    username: z.string().describe('Username of the teammate.'),
    firstName: z.string().describe('First name of the teammate.'),
    lastName: z.string().describe('Last name of the teammate.'),
    isAdmin: z.boolean().describe('Whether the teammate is a company admin.'),
    isAvailable: z.boolean().describe('Whether the teammate is available.'),
    isBlocked: z.boolean().describe('Whether the teammate account has been blocked.'),
    type: z.string().describe('Type of teammate returned by Front.'),
    customFields: z.looseObject({}).describe('Custom fields keyed by the custom field name configured in Front.').optional(),
  }).describe('A normalized Front teammate.')).describe('Teammates returned by Front.'),
}).describe('The Front teammates response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const frontActions = {
  list_contacts: {
    description: 'List Front company contacts with optional cursor pagination and sorting.',
    effect: 'read',
    inputSchema: listContactsInput,
    outputSchema: z.toJSONSchema(listContactsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_contact: {
    description: 'Fetch one Front contact by contact ID or documented resource alias.',
    effect: 'read',
    inputSchema: getContactInput,
    outputSchema: z.toJSONSchema(getContactOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_contact: {
    description: 'Create a Front company contact with JSON fields and one or more reachable handles.',
    effect: 'write',
    inputSchema: createContactInput,
    outputSchema: z.toJSONSchema(createContactOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_contact: {
    description: 'Update JSON fields on a Front contact. Avatar uploads are intentionally not exposed.',
    effect: 'write',
    inputSchema: updateContactInput,
    outputSchema: z.toJSONSchema(updateContactOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_teammates: {
    description: 'List Front teammates in the company.',
    effect: 'read',
    inputSchema: listTeammatesInput,
    outputSchema: z.toJSONSchema(listTeammatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
