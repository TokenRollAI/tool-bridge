/**
 * Zorus 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const searchCustomersInput = z.strictObject({
  page: z.int().describe('The page of data to return.').optional(),
  pageSize: z.int().describe('The number of items per page.').optional(),
  sortAscending: z.boolean().describe('Whether Zorus should sort the result set in ascending order.').optional(),
  sortProperty: z.enum(['Name']).describe('Customer field to sort by.').optional(),
  nameContains: z.string().min(1).describe('Only include customers whose name contains this value.').optional(),
  isEnabled: z.boolean().describe('Only include customers whose enabled state matches this value.').optional(),
  uuidEquals: z.uuid().describe('Only include the customer with this UUID.').optional(),
  createdAfter: z.iso.datetime({ offset: true }).describe('Only include customers created after this UTC timestamp.').optional(),
  createdBefore: z.iso.datetime({ offset: true }).describe('Only include customers created before this UTC timestamp.').optional(),
}).describe('Search, pagination, and sorting options for Zorus customers.')

export const searchCustomersOutput = z.strictObject({
  items: z.array(z.looseObject({
    uuid: z.uuid().describe('The customer UUID.').optional(),
    name: z.string().describe('The customer name.').nullable().optional(),
    createdDateUtc: z.iso.datetime({ offset: true }).describe('Timestamp when the customer was created.').optional(),
    isEnabled: z.boolean().describe('Whether the customer is enabled.').optional(),
    deploymentInfo: z.looseObject({
      deployedEndpointCount: z.int().describe('Number of endpoints associated with the customer.').optional(),
      filteringEnabledCount: z.int().describe('Number of customer endpoints with filtering enabled.').optional(),
      cyberSightEnabledCount: z.int().describe('Number of customer endpoints with CyberSight enabled.').optional(),
      enabledNetworkCount: z.int().describe('Number of enabled WANs associated with the customer.').optional(),
      networkSeatCount: z.int().describe('Number of seats in WANs associated with the customer.').optional(),
    }).describe('Deployment summary for a Zorus customer.').optional(),
    integrations: z.array(z.looseObject({
      vendorName: z.string().describe('The integration vendor name.').nullable().optional(),
      name: z.string().describe('The integration name.').nullable().optional(),
    }).describe('Integration summary for a Zorus customer.')).describe('Integrations used by the customer.').nullable().optional(),
  }).describe('A Zorus customer returned by the API.')).describe('Items returned by the Zorus search endpoint.').optional(),
}).describe('Zorus customer search results.')

export const searchEndpointsInput = z.strictObject({
  page: z.int().describe('The page of data to return.').optional(),
  pageSize: z.int().describe('The number of items per page.').optional(),
  sortAscending: z.boolean().describe('Whether Zorus should sort the result set in ascending order.').optional(),
  sortProperty: z.enum(['Name']).describe('Endpoint field to sort by.').optional(),
  nameContains: z.string().min(1).describe('Only include endpoints whose name contains this value.').optional(),
  isEnabled: z.boolean().describe('Only include endpoints whose enabled state matches this value.').optional(),
  uuidEquals: z.uuid().describe('Only include the endpoint with this UUID.').optional(),
  uuidIn: z.array(z.uuid().describe('One Zorus UUID.')).describe('Only include endpoints whose UUID is in this list.').optional(),
  licenseIdEquals: z.string().min(1).describe('Only include the endpoint with this license ID.').optional(),
  licenseIdIn: z.array(z.string().min(1).describe('One string filter value.')).describe('Only include endpoints whose license ID is in this list.').optional(),
  customerUuidEquals: z.uuid().describe('Only include endpoints whose customer has this UUID.').optional(),
  customerUuidIn: z.array(z.uuid().describe('One Zorus UUID.')).describe('Only include endpoints whose customer UUID is in this list.').optional(),
  groupUuidEquals: z.uuid().describe('Only include endpoints whose group has this UUID.').optional(),
  groupUuidIn: z.array(z.uuid().describe('One Zorus UUID.')).describe('Only include endpoints whose group UUID is in this list.').optional(),
  isInErrorState: z.boolean().describe('Only include endpoints whose error state matches this value.').optional(),
  agentStateEquals: z.string().min(1).describe('Only include endpoints whose agent state matches this value.').optional(),
  lastSeenBefore: z.iso.datetime({ offset: true }).describe('Only include endpoints last seen before this UTC timestamp.').optional(),
  lastSeenAfter: z.iso.datetime({ offset: true }).describe('Only include endpoints last seen after this UTC timestamp.').optional(),
  isInheritingGroupSettings: z.boolean().describe('Only include endpoints whose group-setting inheritance matches this value.').optional(),
  isFilteringEnabled: z.boolean().describe('Only include endpoints whose filtering state matches this value.').optional(),
  isCyberSightEnabled: z.boolean().describe('Only include endpoints whose CyberSight state matches this value.').optional(),
}).describe('Search, pagination, and sorting options for Zorus endpoints.')

export const searchEndpointsOutput = z.strictObject({
  items: z.array(z.looseObject({
    customerName: z.string().describe('The endpoint customer name.').nullable().optional(),
    customerUuid: z.uuid().describe('The endpoint customer UUID.').optional(),
    groupName: z.string().describe('The endpoint group name.').nullable().optional(),
    groupUuid: z.uuid().describe('The endpoint group UUID.').optional(),
    policyUuid: z.uuid().describe('The endpoint policy UUID.').optional(),
    name: z.string().describe('The endpoint name.').nullable().optional(),
    uuid: z.uuid().describe('The endpoint UUID.').optional(),
    licenseId: z.string().describe('The endpoint license ID.').nullable().optional(),
    createdDateUtc: z.iso.datetime({ offset: true }).describe('Timestamp when the endpoint was created.').optional(),
    isEnabled: z.boolean().describe('Whether the endpoint is enabled.').optional(),
    operatingSystemType: z.string().describe('The endpoint operating system type.').nullable().optional(),
    operatingSystem: z.string().describe('The endpoint operating system.').nullable().optional(),
    localIp: z.string().describe('The endpoint local IP address.').nullable().optional(),
    version: z.string().describe('The endpoint agent version.').nullable().optional(),
    isInErrorState: z.boolean().describe('Whether the endpoint is in an error state.').optional(),
    isInheritingGroupSettings: z.boolean().describe('Whether the endpoint inherits group settings.').optional(),
    isFilteringEnabled: z.boolean().describe('Whether filtering is enabled on the endpoint.').optional(),
    isCyberSightEnabled: z.boolean().describe('Whether CyberSight is enabled on the endpoint.').optional(),
    isCyberSightBrowserExtensionEnabled: z.boolean().describe('Whether the CyberSight browser extension is enabled on the endpoint.').optional(),
    browserExtensionState: z.string().describe('The endpoint browser extension state.').nullable().optional(),
    agentState: z.string().describe('The endpoint agent state.').nullable().optional(),
    lastSeenDateUtc: z.iso.datetime({ offset: true }).describe('Timestamp when the endpoint was last seen.').nullable().optional(),
  }).describe('A Zorus endpoint returned by the API.')).describe('Items returned by the Zorus search endpoint.').optional(),
}).describe('Zorus endpoint search results.')

export const searchGroupsInput = z.strictObject({
  page: z.int().describe('The page of data to return.').optional(),
  pageSize: z.int().describe('The number of items per page.').optional(),
  sortAscending: z.boolean().describe('Whether Zorus should sort the result set in ascending order.').optional(),
  sortProperty: z.enum(['Name', 'CustomerName', 'SyncOptionsToMembers', 'SyncAddonsToMembers']).describe('Group field to sort by.').optional(),
  nameContains: z.string().min(1).describe('Only include groups whose name contains this value.').optional(),
  uuidEquals: z.uuid().describe('Only include the group with this UUID.').optional(),
  policyUuidEquals: z.uuid().describe('Only include groups assigned to this policy UUID.').optional(),
  customerUuidEquals: z.uuid().describe('Only include groups whose customer has this UUID.').optional(),
  customerNameContains: z.string().min(1).describe('Only include groups whose customer name contains this value.').optional(),
  syncOptionsToMembers: z.boolean().describe('Only include groups whose sync-options-to-members setting matches this value.').optional(),
  syncAddonsToMembers: z.boolean().describe('Only include groups whose sync-addons-to-members setting matches this value.').optional(),
}).describe('Search, pagination, and sorting options for Zorus groups.')

export const searchGroupsOutput = z.strictObject({
  items: z.array(z.looseObject({
    name: z.string().describe('The group name.').nullable().optional(),
    uuid: z.uuid().describe('The group UUID.').optional(),
    policyUuid: z.uuid().describe('The policy UUID used by the group.').optional(),
    customerName: z.string().describe('The group customer name.').nullable().optional(),
    customerUuid: z.uuid().describe('The group customer UUID.').optional(),
    syncOptionsToMembers: z.boolean().describe('Whether options are synchronized to group members.').optional(),
    syncAddonsToMembers: z.boolean().describe('Whether addons are synchronized to group members.').optional(),
  }).describe('A Zorus group returned by the API.')).describe('Items returned by the Zorus search endpoint.').optional(),
}).describe('Zorus group search results.')

export const searchPoliciesInput = z.strictObject({
  page: z.int().describe('The page of data to return.').optional(),
  pageSize: z.int().describe('The number of items per page.').optional(),
  sortAscending: z.boolean().describe('Whether Zorus should sort the result set in ascending order.').optional(),
  sortProperty: z.enum(['CustomerName', 'GroupName', 'CreatedDateUtc']).describe('Policy field to sort by.').optional(),
  uuidEquals: z.uuid().describe('Only include the policy with this UUID.').optional(),
  groupUuidEquals: z.uuid().describe('Only include policies whose group has this UUID.').optional(),
  groupNameContains: z.string().min(1).describe('Only include policies whose group name contains this value.').optional(),
  customerNameContains: z.string().min(1).describe('Only include policies whose customer name contains this value.').optional(),
  customerUuidEquals: z.uuid().describe('Only include policies whose customer has this UUID.').optional(),
  createdBefore: z.iso.datetime({ offset: true }).describe('Only include policies created before this UTC timestamp.').optional(),
  createdAfter: z.iso.datetime({ offset: true }).describe('Only include policies created after this UTC timestamp.').optional(),
}).describe('Search, pagination, and sorting options for Zorus policies.')

export const searchPoliciesOutput = z.strictObject({
  items: z.array(z.looseObject({
    uuid: z.uuid().describe('The policy UUID.').optional(),
    groupName: z.string().describe('The policy group name.').nullable().optional(),
    groupUuid: z.uuid().describe('The policy group UUID.').optional(),
    customerName: z.string().describe('The policy customer name.').nullable().optional(),
    customerUuid: z.uuid().describe('The policy customer UUID.').optional(),
    createdDateUtc: z.iso.datetime({ offset: true }).describe('Timestamp when the policy was created.').nullable().optional(),
  }).describe('A Zorus policy returned by the API.')).describe('Items returned by the Zorus search endpoint.').optional(),
}).describe('Zorus policy search results.')

export const searchActiveUnblockRequestsInput = z.strictObject({
  page: z.int().describe('The page of data to return.').optional(),
  pageSize: z.int().describe('The number of items per page.').optional(),
  sortAscending: z.boolean().describe('Whether Zorus should sort the result set in ascending order.').optional(),
  sortProperty: z.enum(['CustomerName', 'LoggedOnUser', 'EndpointName', 'Website']).describe('Active unblock-request field to sort by.').optional(),
  customerUuidIn: z.array(z.uuid().describe('One Zorus UUID.')).describe('Only include unblock requests whose customer UUID is in this list.').optional(),
  policyUuidIn: z.array(z.uuid().describe('One Zorus UUID.')).describe('Only include unblock requests whose policy UUID is in this list.').optional(),
  loggedOnUserContains: z.string().min(1).describe('Only include unblock requests whose logged-on user contains this value.').optional(),
  requestedBefore: z.iso.datetime({ offset: true }).describe('Only include unblock requests submitted before this UTC timestamp.').optional(),
  requestedAfter: z.iso.datetime({ offset: true }).describe('Only include unblock requests submitted after this UTC timestamp.').optional(),
}).describe('Search, pagination, and sorting options for active Zorus unblock requests.')

export const searchActiveUnblockRequestsOutput = z.strictObject({
  items: z.array(z.looseObject({
    uuid: z.uuid().describe('The unblock request UUID.').optional(),
    customerUuid: z.uuid().describe('The unblock request customer UUID.').optional(),
    customerName: z.string().describe('The unblock request customer name.').nullable().optional(),
    policyUuid: z.uuid().describe('The policy UUID responsible for the block.').optional(),
    loggedOnUser: z.string().describe('The remote username of the submitter.').nullable().optional(),
    endpointName: z.string().describe('The endpoint hostname that submitted the request.').nullable().optional(),
    website: z.string().describe('The blocked URL.').nullable().optional(),
    blockReason: z.string().describe('The Zorus-provided block reason.').nullable().optional(),
    categoryNames: z.array(z.string().describe('Category name.')).describe('Categories assigned to the blocked website or URL.').nullable().optional(),
    requestReason: z.string().describe('The user-supplied reason for the unblock request.').nullable().optional(),
    requestDateUtc: z.iso.datetime({ offset: true }).describe('Timestamp when the unblock request was submitted.').optional(),
  }).describe('An active Zorus unblock request returned by the API.')).describe('Items returned by the Zorus search endpoint.').optional(),
}).describe('Active Zorus unblock-request search results.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const zorusActions = {
  search_customers: {
    description: 'Search Zorus customers with documented filtering, pagination, and sorting.',
    effect: 'read',
    inputSchema: searchCustomersInput,
    outputSchema: z.toJSONSchema(searchCustomersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_endpoints: {
    description: 'Search Zorus endpoints with documented filtering, pagination, and sorting.',
    effect: 'read',
    inputSchema: searchEndpointsInput,
    outputSchema: z.toJSONSchema(searchEndpointsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_groups: {
    description: 'Search Zorus groups with documented filtering, pagination, and sorting.',
    effect: 'read',
    inputSchema: searchGroupsInput,
    outputSchema: z.toJSONSchema(searchGroupsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_policies: {
    description: 'Search Zorus policies with documented filtering, pagination, and sorting.',
    effect: 'read',
    inputSchema: searchPoliciesInput,
    outputSchema: z.toJSONSchema(searchPoliciesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_active_unblock_requests: {
    description: 'Search active Zorus unblock requests with documented filtering, pagination, and sorting.',
    effect: 'read',
    inputSchema: searchActiveUnblockRequestsInput,
    outputSchema: z.toJSONSchema(searchActiveUnblockRequestsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
