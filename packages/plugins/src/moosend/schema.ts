/**
 * Moosend 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listMailingListsInput = z.strictObject({
  Format: z.literal('json').describe('Moosend response format. Connector actions always request JSON.').optional(),
  WithStatistics: z.boolean().describe('Whether Moosend should include subscriber statistics.').optional(),
  SortBy: z.enum(['Name', 'Subject', 'Status', 'DeliveredOn', 'CreatedOn']).describe('Moosend mailing list property used to sort results.').optional(),
  SortMethod: z.enum(['ASC', 'DESC']).describe('Moosend sorting direction.').optional(),
}).describe('Query parameters for retrieving Moosend active mailing lists.')

export const listMailingListsOutput = z.strictObject({
  Code: z.int().describe('The Moosend response code. A value of 0 indicates success.'),
  Error: z.string().describe('The Moosend error message, or null when successful.').nullable(),
  Context: z.looseObject({
    Paging: z.looseObject({
      PageSize: z.int().describe('The page size of the results.').optional(),
      CurrentPage: z.int().describe('The current page number.').optional(),
      TotalResults: z.int().describe('The total number of matching results.').optional(),
      TotalPageCount: z.int().describe('The total number of available pages.').optional(),
      SortExpression: z.string().describe('The sort expression used by Moosend.').nullable().optional(),
      SortIsAscending: z.boolean().describe('Whether Moosend sorted the results in ascending order.').optional(),
    }).describe('Moosend paging metadata.'),
    MailingLists: z.array(z.looseObject({
      ID: z.string().describe('The Moosend mailing list identifier.').optional(),
      Name: z.string().describe('The mailing list name.').optional(),
      ActiveMemberCount: z.int().describe('The number of active members in the mailing list.').optional(),
      BouncedMemberCount: z.int().describe('The number of bounced members in the mailing list.').optional(),
      RemovedMemberCount: z.int().describe('The number of removed members in the mailing list.').optional(),
      UnsubscribedMemberCount: z.int().describe('The number of unsubscribed members in the mailing list.').optional(),
      Status: z.int().describe('The Moosend numeric mailing list status.').optional(),
      CustomFieldsDefinition: z.array(z.looseObject({}).describe('A Moosend custom field definition.')).describe('The custom field definitions configured for the mailing list.').optional(),
      CreatedOn: z.string().describe('The Moosend date string when the mailing list was created.').optional(),
      UpdatedOn: z.string().describe('The Moosend date string when the mailing list was updated.').optional(),
    }).describe('A Moosend mailing list object.')).describe('The active mailing lists returned by Moosend.'),
  }).describe('The Moosend mailing list response context.'),
}).describe('Moosend active mailing lists response.')

export const listSubscribersInput = z.strictObject({
  MailingListID: z.string().min(1).describe('The ID of the email list containing the subscribers.'),
  Status: z.enum(['Subscribed', 'Unsubscribed', 'Bounced', 'Removed']).describe('Moosend subscriber status filter.'),
  Format: z.literal('json').describe('Moosend response format. Connector actions always request JSON.').optional(),
  Page: z.int().min(1).describe('The page of subscriber results to return.').optional(),
  PageSize: z.int().min(1).describe('The number of subscriber results to return per page.').optional(),
}).describe('Path and query parameters for retrieving subscribers in a Moosend mailing list.')

export const listSubscribersOutput = z.strictObject({
  Code: z.int().describe('The Moosend response code. A value of 0 indicates success.'),
  Error: z.string().describe('The Moosend error message, or null when successful.').nullable(),
  Context: z.looseObject({
    Paging: z.looseObject({
      PageSize: z.int().describe('The page size of the results.').optional(),
      CurrentPage: z.int().describe('The current page number.').optional(),
      TotalResults: z.int().describe('The total number of matching results.').optional(),
      TotalPageCount: z.int().describe('The total number of available pages.').optional(),
      SortExpression: z.string().describe('The sort expression used by Moosend.').nullable().optional(),
      SortIsAscending: z.boolean().describe('Whether Moosend sorted the results in ascending order.').optional(),
    }).describe('Moosend paging metadata.'),
    Subscribers: z.array(z.looseObject({
      ID: z.string().describe('The Moosend subscriber identifier.').optional(),
      Name: z.string().describe('The subscriber name.').nullable().optional(),
      Email: z.email().describe('The subscriber email address.').optional(),
      CreatedOn: z.string().describe('The Moosend date string when the subscriber was created.').optional(),
      UpdatedOn: z.string().describe('The Moosend date string when the subscriber was updated.').optional(),
      UnsubscribedOn: z.string().describe('The Moosend date string when the subscriber unsubscribed from the list.').nullable().optional(),
      UnsubscribedFromID: z.string().describe('The identifier that the subscriber unsubscribed from.').nullable().optional(),
      SubscribeType: z.int().describe('The Moosend numeric subscriber status.').optional(),
      SubscribeMethod: z.int().describe('The Moosend numeric subscription method.').optional(),
      CustomFields: z.array(z.looseObject({
        CustomFieldID: z.string().describe('The Moosend custom field identifier.').optional(),
        Name: z.string().describe('The Moosend custom field name.').optional(),
        Value: z.string().describe('The Moosend custom field value.').nullable().optional(),
      }).describe('A Moosend custom field returned for a subscriber.')).describe('The custom fields associated with the subscriber.').optional(),
      RemovedOn: z.string().describe('The Moosend date string when the subscriber was removed.').nullable().optional(),
      Tags: z.array(z.string().describe('One subscriber tag.')).describe('The tags associated with the subscriber.').optional(),
      Preferences: z.array(z.string().describe('One preference value.')).describe('The preference values associated with the subscriber.').optional(),
    }).describe('A Moosend subscriber object.')).describe('The subscribers returned by Moosend.'),
  }).describe('The Moosend subscribers response context.'),
}).describe('Moosend subscriber list response.')

export const getSubscriberByEmailInput = z.strictObject({
  MailingListID: z.string().min(1).describe('The ID of the email list that contains the subscriber.'),
  Email: z.email().describe('The email address of the subscriber to retrieve.'),
  Format: z.literal('json').describe('Moosend response format. Connector actions always request JSON.').optional(),
}).describe('Path and query parameters for retrieving one Moosend subscriber by email address.')

export const getSubscriberByEmailOutput = z.strictObject({
  Code: z.int().describe('The Moosend response code. A value of 0 indicates success.'),
  Error: z.string().describe('The Moosend error message, or null when successful.').nullable(),
  Context: z.looseObject({
    ID: z.string().describe('The Moosend subscriber identifier.').optional(),
    Name: z.string().describe('The subscriber name.').nullable().optional(),
    Email: z.email().describe('The subscriber email address.').optional(),
    CreatedOn: z.string().describe('The Moosend date string when the subscriber was created.').optional(),
    UpdatedOn: z.string().describe('The Moosend date string when the subscriber was updated.').optional(),
    UnsubscribedOn: z.string().describe('The Moosend date string when the subscriber unsubscribed from the list.').nullable().optional(),
    UnsubscribedFromID: z.string().describe('The identifier that the subscriber unsubscribed from.').nullable().optional(),
    SubscribeType: z.int().describe('The Moosend numeric subscriber status.').optional(),
    SubscribeMethod: z.int().describe('The Moosend numeric subscription method.').optional(),
    CustomFields: z.array(z.looseObject({
      CustomFieldID: z.string().describe('The Moosend custom field identifier.').optional(),
      Name: z.string().describe('The Moosend custom field name.').optional(),
      Value: z.string().describe('The Moosend custom field value.').nullable().optional(),
    }).describe('A Moosend custom field returned for a subscriber.')).describe('The custom fields associated with the subscriber.').optional(),
    RemovedOn: z.string().describe('The Moosend date string when the subscriber was removed.').nullable().optional(),
    Tags: z.array(z.string().describe('One subscriber tag.')).describe('The tags associated with the subscriber.').optional(),
    Preferences: z.array(z.string().describe('One preference value.')).describe('The preference values associated with the subscriber.').optional(),
  }).describe('A Moosend subscriber object.'),
}).describe('Moosend single subscriber response.')

export const addSubscriberInput = z.strictObject({
  MailingListID: z.string().min(1).describe('The ID of the email list where Moosend should add the subscriber.'),
  Email: z.email().describe('The email address of the subscriber.'),
  Format: z.literal('json').describe('Moosend response format. Connector actions always request JSON.').optional(),
  Name: z.string().min(1).describe('The subscriber name.').optional(),
  HasExternalDoubleOptIn: z.boolean().describe('Whether the subscriber has given subscription consent by other means.').optional(),
  CustomFields: z.array(z.string().min(1).describe('One custom field value in FieldName=Value format.')).describe('Custom field values in Moosend FieldName=Value format.').optional(),
  Tags: z.array(z.string().min(1).describe('One subscriber tag.')).describe('Tags to assign to the subscriber.').optional(),
  Preferences: z.array(z.string().min(1).describe('One preference value.')).describe('Preference values to assign to the subscriber.').optional(),
}).describe('Path, query, and JSON body parameters for adding or updating a Moosend subscriber.')

export const addSubscriberOutput = z.strictObject({
  Code: z.int().describe('The Moosend response code. A value of 0 indicates success.'),
  Error: z.string().describe('The Moosend error message, or null when successful.').nullable(),
  Context: z.looseObject({
    ID: z.string().describe('The Moosend subscriber identifier.').optional(),
    Name: z.string().describe('The subscriber name.').nullable().optional(),
    Email: z.email().describe('The subscriber email address.').optional(),
    CreatedOn: z.string().describe('The Moosend date string when the subscriber was created.').optional(),
    UpdatedOn: z.string().describe('The Moosend date string when the subscriber was updated.').optional(),
    UnsubscribedOn: z.string().describe('The Moosend date string when the subscriber unsubscribed from the list.').nullable().optional(),
    UnsubscribedFromID: z.string().describe('The identifier that the subscriber unsubscribed from.').nullable().optional(),
    SubscribeType: z.int().describe('The Moosend numeric subscriber status.').optional(),
    SubscribeMethod: z.int().describe('The Moosend numeric subscription method.').optional(),
    CustomFields: z.array(z.looseObject({
      CustomFieldID: z.string().describe('The Moosend custom field identifier.').optional(),
      Name: z.string().describe('The Moosend custom field name.').optional(),
      Value: z.string().describe('The Moosend custom field value.').nullable().optional(),
    }).describe('A Moosend custom field returned for a subscriber.')).describe('The custom fields associated with the subscriber.').optional(),
    RemovedOn: z.string().describe('The Moosend date string when the subscriber was removed.').nullable().optional(),
    Tags: z.array(z.string().describe('One subscriber tag.')).describe('The tags associated with the subscriber.').optional(),
    Preferences: z.array(z.string().describe('One preference value.')).describe('The preference values associated with the subscriber.').optional(),
  }).describe('A Moosend subscriber object.'),
}).describe('Moosend single subscriber response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const moosendActions = {
  list_mailing_lists: {
    description: 'List active mailing lists in the current Moosend account.',
    effect: 'read',
    inputSchema: listMailingListsInput,
    outputSchema: z.toJSONSchema(listMailingListsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_subscribers: {
    description: 'List subscribers in a Moosend mailing list filtered by subscriber status.',
    effect: 'read',
    inputSchema: listSubscribersInput,
    outputSchema: z.toJSONSchema(listSubscribersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_subscriber_by_email: {
    description: 'Fetch one Moosend subscriber from a mailing list by email address.',
    effect: 'read',
    inputSchema: getSubscriberByEmailInput,
    outputSchema: z.toJSONSchema(getSubscriberByEmailOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_subscriber: {
    description: 'Add or update one subscriber in a Moosend mailing list.',
    effect: 'write',
    inputSchema: addSubscriberInput,
    outputSchema: z.toJSONSchema(addSubscriberOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
