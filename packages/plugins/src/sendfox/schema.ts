/**
 * SendFox 各 action 的入参/出参 Zod schema 与语义标注。
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
  query: z.string().min(1).describe('Search query for filtering contacts.').optional(),
  page: z.int().min(1).describe('Page number to request from SendFox.').optional(),
  unsubscribed: z.boolean().describe('Whether to filter for unsubscribed contacts.').optional(),
  email: z.email().describe('Specific contact email address to filter by.').optional(),
}).describe('Query parameters for listing SendFox contacts.')

export const listContactsOutput = z.strictObject({
  contacts: z.array(z.looseObject({
    id: z.int().describe('SendFox contact ID.'),
    email: z.email().describe('Contact email address.'),
    first_name: z.string().describe('Contact first name.').nullable(),
    last_name: z.string().describe('Contact last name.').nullable(),
    ip_address: z.string().describe('IP address associated with the contact.').nullable(),
    unsubscribed_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact unsubscribed.').nullable(),
    created_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact was created.'),
    updated_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact was last updated.'),
  }).describe('Contact object returned by SendFox.')).describe('Contacts returned for the current page.').optional(),
  meta: z.strictObject({
    current_page: z.int().describe('Current result page returned by SendFox.').optional(),
    total: z.int().describe('Total number of records available for the current query.').optional(),
    per_page: z.int().describe('Maximum number of records returned on each page.').optional(),
  }).describe('Pagination metadata returned by SendFox list endpoints.').optional(),
}).describe('Paginated contacts returned by SendFox.')

export const createContactInput = z.strictObject({
  email: z.email().describe('Contact email address.'),
  first_name: z.string().min(1).describe('Contact first name.').optional(),
  last_name: z.string().min(1).describe('Contact last name.').optional(),
  ip_address: z.string().min(1).describe('IP address associated with the contact.').optional(),
  lists: z.array(z.int().min(1).describe('SendFox list ID.')).describe('SendFox list IDs to add the contact to.').optional(),
  contact_fields: z.array(z.strictObject({
    name: z.string().min(1).describe('Machine-readable SendFox contact field name.').optional(),
    value: z.string().describe('Custom field value to store on the contact.').nullable().optional(),
  }).describe('Custom contact field value accepted by SendFox contact write endpoints.')).describe('Custom contact field values to store on the contact.').optional(),
}).describe('Request body for creating a SendFox contact.')

export const createContactOutput = z.looseObject({
  id: z.int().describe('SendFox contact ID.'),
  email: z.email().describe('Contact email address.'),
  first_name: z.string().describe('Contact first name.').nullable(),
  last_name: z.string().describe('Contact last name.').nullable(),
  ip_address: z.string().describe('IP address associated with the contact.').nullable(),
  unsubscribed_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact unsubscribed.').nullable(),
  created_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact was created.'),
  updated_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact was last updated.'),
}).describe('Contact object returned by SendFox.')

export const getContactInput = z.strictObject({
  contact_id: z.int().min(1).describe('SendFox contact ID.').optional(),
}).describe('Path parameters for a SendFox contact endpoint.')

export const getContactOutput = z.looseObject({
  id: z.int().describe('SendFox contact ID.'),
  email: z.email().describe('Contact email address.'),
  first_name: z.string().describe('Contact first name.').nullable(),
  last_name: z.string().describe('Contact last name.').nullable(),
  ip_address: z.string().describe('IP address associated with the contact.').nullable(),
  unsubscribed_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact unsubscribed.').nullable(),
  created_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact was created.'),
  updated_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact was last updated.'),
}).describe('Contact object returned by SendFox.')

export const updateContactInput = z.strictObject({
  contact_id: z.int().min(1).describe('SendFox contact ID.'),
  first_name: z.string().min(1).describe('Updated contact first name.').optional(),
  last_name: z.string().min(1).describe('Updated contact last name.').optional(),
  lists: z.array(z.int().min(1).describe('SendFox list ID.')).describe('SendFox list IDs that replace the contact\'s current memberships.').optional(),
  contact_fields: z.array(z.strictObject({
    name: z.string().min(1).describe('Machine-readable SendFox contact field name.').optional(),
    value: z.string().describe('Custom field value to store on the contact.').nullable().optional(),
  }).describe('Custom contact field value accepted by SendFox contact write endpoints.')).describe('Custom contact field values to update on the contact.').optional(),
}).describe('Path parameters and request body for updating a SendFox contact.')

export const updateContactOutput = z.looseObject({
  id: z.int().describe('SendFox contact ID.'),
  email: z.email().describe('Contact email address.'),
  first_name: z.string().describe('Contact first name.').nullable(),
  last_name: z.string().describe('Contact last name.').nullable(),
  ip_address: z.string().describe('IP address associated with the contact.').nullable(),
  unsubscribed_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact unsubscribed.').nullable(),
  created_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact was created.'),
  updated_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact was last updated.'),
}).describe('Contact object returned by SendFox.')

export const deleteContactInput = z.strictObject({
  contact_id: z.int().min(1).describe('SendFox contact ID.').optional(),
}).describe('Path parameters for a SendFox contact endpoint.')

export const deleteContactOutput = z.strictObject({
  message: z.string().describe('Human-readable SendFox response message.').optional(),
}).describe('Message response returned by SendFox.')

export const unsubscribeContactInput = z.strictObject({
  email: z.email().describe('Contact email address to unsubscribe.').optional(),
}).describe('Request body for unsubscribing a contact.')

export const unsubscribeContactOutput = z.looseObject({
  id: z.int().describe('SendFox contact ID.'),
  email: z.email().describe('Contact email address.'),
  first_name: z.string().describe('Contact first name.').nullable(),
  last_name: z.string().describe('Contact last name.').nullable(),
  ip_address: z.string().describe('IP address associated with the contact.').nullable(),
  unsubscribed_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact unsubscribed.').nullable(),
  created_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact was created.'),
  updated_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact was last updated.'),
}).describe('Contact object returned by SendFox.')

export const listContactListsInput = z.strictObject({
  query: z.string().min(1).describe('Search query for filtering contact lists.').optional(),
  page: z.int().min(1).describe('Page number to request from SendFox.').optional(),
}).describe('Query parameters for listing SendFox contact lists.')

export const listContactListsOutput = z.strictObject({
  lists: z.array(z.looseObject({
    id: z.int().describe('SendFox contact list ID.'),
    name: z.string().describe('Contact list name.'),
    user_id: z.int().describe('SendFox user ID that owns the list.'),
    average_email_open_percent: z.number().describe('Average email open percentage for this list.'),
    average_email_click_percent: z.number().describe('Average email click percentage for this list.'),
    created_at: z.iso.datetime({ offset: true }).describe('Timestamp when the list was created.'),
    updated_at: z.iso.datetime({ offset: true }).describe('Timestamp when the list was last updated.'),
  }).describe('Contact list object returned by SendFox.')).describe('Contact lists returned for the current page.').optional(),
  meta: z.strictObject({
    current_page: z.int().describe('Current result page returned by SendFox.').optional(),
    total: z.int().describe('Total number of records available for the current query.').optional(),
    per_page: z.int().describe('Maximum number of records returned on each page.').optional(),
  }).describe('Pagination metadata returned by SendFox list endpoints.').optional(),
}).describe('Paginated contact lists returned by SendFox.')

export const createContactListInput = z.strictObject({
  name: z.string().min(1).describe('Contact list name.').optional(),
}).describe('Request body for creating a SendFox contact list.')

export const createContactListOutput = z.looseObject({
  id: z.int().describe('SendFox contact list ID.'),
  name: z.string().describe('Contact list name.'),
  user_id: z.int().describe('SendFox user ID that owns the list.'),
  average_email_open_percent: z.number().describe('Average email open percentage for this list.'),
  average_email_click_percent: z.number().describe('Average email click percentage for this list.'),
  created_at: z.iso.datetime({ offset: true }).describe('Timestamp when the list was created.'),
  updated_at: z.iso.datetime({ offset: true }).describe('Timestamp when the list was last updated.'),
}).describe('Contact list object returned by SendFox.')

export const getContactListInput = z.strictObject({
  list_id: z.int().min(1).describe('SendFox list ID.').optional(),
}).describe('Path parameters for a SendFox contact list endpoint.')

export const getContactListOutput = z.looseObject({
  id: z.int().describe('SendFox contact list ID.'),
  name: z.string().describe('Contact list name.'),
  user_id: z.int().describe('SendFox user ID that owns the list.'),
  average_email_open_percent: z.number().describe('Average email open percentage for this list.'),
  average_email_click_percent: z.number().describe('Average email click percentage for this list.'),
  created_at: z.iso.datetime({ offset: true }).describe('Timestamp when the list was created.'),
  updated_at: z.iso.datetime({ offset: true }).describe('Timestamp when the list was last updated.'),
}).describe('Contact list object returned by SendFox.')

export const updateContactListInput = z.strictObject({
  list_id: z.int().min(1).describe('SendFox list ID.').optional(),
  name: z.string().min(1).max(191).describe('Updated contact list name.').optional(),
}).describe('Path parameters and request body for updating a SendFox contact list.')

export const updateContactListOutput = z.looseObject({
  id: z.int().describe('SendFox contact list ID.'),
  name: z.string().describe('Contact list name.'),
  user_id: z.int().describe('SendFox user ID that owns the list.'),
  average_email_open_percent: z.number().describe('Average email open percentage for this list.'),
  average_email_click_percent: z.number().describe('Average email click percentage for this list.'),
  created_at: z.iso.datetime({ offset: true }).describe('Timestamp when the list was created.'),
  updated_at: z.iso.datetime({ offset: true }).describe('Timestamp when the list was last updated.'),
}).describe('Contact list object returned by SendFox.')

export const deleteContactListInput = z.strictObject({
  list_id: z.int().min(1).describe('SendFox list ID.').optional(),
}).describe('Path parameters for a SendFox contact list endpoint.')

export const deleteContactListOutput = z.strictObject({
  message: z.string().describe('Human-readable SendFox response message.').optional(),
}).describe('Message response returned by SendFox.')

export const listContactsInListInput = z.strictObject({
  list_id: z.int().min(1).describe('SendFox list ID.'),
  query: z.string().min(1).describe('Search query for filtering contacts in the list.').optional(),
  page: z.int().min(1).describe('Page number to request from SendFox.').optional(),
}).describe('Path and query parameters for listing contacts in a SendFox list.')

export const listContactsInListOutput = z.strictObject({
  contacts: z.array(z.looseObject({
    id: z.int().describe('SendFox contact ID.'),
    email: z.email().describe('Contact email address.'),
    first_name: z.string().describe('Contact first name.').nullable(),
    last_name: z.string().describe('Contact last name.').nullable(),
    ip_address: z.string().describe('IP address associated with the contact.').nullable(),
    unsubscribed_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact unsubscribed.').nullable(),
    created_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact was created.'),
    updated_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact was last updated.'),
  }).describe('Contact object returned by SendFox.')).describe('Contacts returned for the current page.').optional(),
  meta: z.strictObject({
    current_page: z.int().describe('Current result page returned by SendFox.').optional(),
    total: z.int().describe('Total number of records available for the current query.').optional(),
    per_page: z.int().describe('Maximum number of records returned on each page.').optional(),
  }).describe('Pagination metadata returned by SendFox list endpoints.').optional(),
}).describe('Paginated contacts returned by SendFox.')

export const addContactToListInput = z.strictObject({
  list_id: z.int().min(1).describe('SendFox list ID.').optional(),
  contact_id: z.int().min(1).describe('SendFox contact ID.').optional(),
}).describe('Path parameters and body for adding a contact to a SendFox list.')

export const addContactToListOutput = z.looseObject({
  id: z.int().describe('SendFox contact ID.'),
  email: z.email().describe('Contact email address.'),
  first_name: z.string().describe('Contact first name.').nullable(),
  last_name: z.string().describe('Contact last name.').nullable(),
  ip_address: z.string().describe('IP address associated with the contact.').nullable(),
  unsubscribed_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact unsubscribed.').nullable(),
  created_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact was created.'),
  updated_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact was last updated.'),
}).describe('Contact object returned by SendFox.')

export const removeContactFromListInput = z.strictObject({
  list_id: z.int().min(1).describe('SendFox list ID.').optional(),
  contact_id: z.int().min(1).describe('SendFox contact ID.').optional(),
}).describe('Path parameters and body for adding a contact to a SendFox list.')

export const removeContactFromListOutput = z.looseObject({
  id: z.int().describe('SendFox contact ID.'),
  email: z.email().describe('Contact email address.'),
  first_name: z.string().describe('Contact first name.').nullable(),
  last_name: z.string().describe('Contact last name.').nullable(),
  ip_address: z.string().describe('IP address associated with the contact.').nullable(),
  unsubscribed_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact unsubscribed.').nullable(),
  created_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact was created.'),
  updated_at: z.iso.datetime({ offset: true }).describe('Timestamp when the contact was last updated.'),
}).describe('Contact object returned by SendFox.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const sendfoxActions = {
  list_contacts: {
    description: 'List SendFox contacts with optional search, email, and unsubscribe filters.',
    effect: 'read',
    inputSchema: listContactsInput,
    outputSchema: z.toJSONSchema(listContactsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_contact: {
    description: 'Create a SendFox contact and optionally attach it to lists with custom contact fields.',
    effect: 'write',
    inputSchema: createContactInput,
    outputSchema: z.toJSONSchema(createContactOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_contact: {
    description: 'Get a SendFox contact by ID.',
    effect: 'read',
    inputSchema: getContactInput,
    outputSchema: z.toJSONSchema(getContactOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_contact: {
    description: 'Update a SendFox contact\'s name, list memberships, or custom field values.',
    effect: 'write',
    inputSchema: updateContactInput,
    outputSchema: z.toJSONSchema(updateContactOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_contact: {
    description: 'Soft-delete a SendFox contact and cancel any scheduled deliverables.',
    effect: 'destructive',
    inputSchema: deleteContactInput,
    outputSchema: z.toJSONSchema(deleteContactOutput, { io: 'output', unrepresentable: 'any' }),
  },
  unsubscribe_contact: {
    description: 'Unsubscribe a SendFox contact by email address.',
    effect: 'write',
    inputSchema: unsubscribeContactInput,
    outputSchema: z.toJSONSchema(unsubscribeContactOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_contact_lists: {
    description: 'List SendFox contact lists with optional search filtering.',
    effect: 'read',
    inputSchema: listContactListsInput,
    outputSchema: z.toJSONSchema(listContactListsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_contact_list: {
    description: 'Create a SendFox contact list.',
    effect: 'write',
    inputSchema: createContactListInput,
    outputSchema: z.toJSONSchema(createContactListOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_contact_list: {
    description: 'Get a SendFox contact list by ID.',
    effect: 'read',
    inputSchema: getContactListInput,
    outputSchema: z.toJSONSchema(getContactListOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_contact_list: {
    description: 'Update a SendFox contact list name.',
    effect: 'write',
    inputSchema: updateContactListInput,
    outputSchema: z.toJSONSchema(updateContactListOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_contact_list: {
    description: 'Soft-delete a SendFox contact list when it is not used by dependent resources.',
    effect: 'destructive',
    inputSchema: deleteContactListInput,
    outputSchema: z.toJSONSchema(deleteContactListOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_contacts_in_list: {
    description: 'List contacts in a SendFox contact list with optional search filtering.',
    effect: 'read',
    inputSchema: listContactsInListInput,
    outputSchema: z.toJSONSchema(listContactsInListOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_contact_to_list: {
    description: 'Add an existing SendFox contact to a contact list.',
    effect: 'write',
    inputSchema: addContactToListInput,
    outputSchema: z.toJSONSchema(addContactToListOutput, { io: 'output', unrepresentable: 'any' }),
  },
  remove_contact_from_list: {
    description: 'Remove a SendFox contact from a contact list.',
    effect: 'destructive',
    inputSchema: removeContactFromListInput,
    outputSchema: z.toJSONSchema(removeContactFromListOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
