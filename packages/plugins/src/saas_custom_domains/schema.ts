/**
 * SaaS Custom Domains 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listAccountsInput = z.strictObject({}).describe('Input parameters for listing SaaS Custom Domains accounts.')

export const listAccountsOutput = z.strictObject({
  accounts: z.array(z.looseObject({
    uuid: z.string().min(1).describe('Unique identifier for the account.'),
    name: z.string().describe('Name of the account.'),
    personal: z.boolean().describe('Whether the account is personal.'),
    owner_uuid: z.string().describe('Unique identifier for the account owner.'),
    created_at: z.string().describe('Timestamp when the account was created.'),
    updated_at: z.string().describe('Timestamp when the account was last updated.'),
  }).describe('One SaaS Custom Domains account.')).describe('Accounts returned by SaaS Custom Domains.').optional(),
}).describe('Output payload for SaaS Custom Domains account listing.')

export const listUpstreamsInput = z.strictObject({
  account_uuid: z.string().min(1).describe('SaaS Custom Domains account UUID.'),
  host: z.string().min(1).describe('Host name accepted by SaaS Custom Domains.').optional(),
  page: z.int().min(1).describe('Page number to retrieve. Pages start at 1.').optional(),
  per_page: z.int().min(1).describe('Number of items to retrieve per page.').optional(),
}).describe('Input parameters for listing SaaS Custom Domains upstreams.')

export const listUpstreamsOutput = z.strictObject({
  upstreams: z.array(z.looseObject({
    uuid: z.string().min(1).describe('Unique identifier for the upstream.'),
    host: z.string().describe('Host of the upstream web application.'),
    port: z.int().describe('Port on which the upstream application listens.'),
    tls: z.boolean().describe('Whether the upstream expects TLS traffic.'),
    auth_token: z.string().describe('Auth token used when forwarding requests to the upstream.'),
    bubble_io: z.boolean().describe('Whether the upstream is a Bubble.io app.'),
    compression_enabled: z.boolean().describe('Whether automatic response compression is enabled.'),
    geocoding_enabled: z.boolean().describe('Whether geocoding headers are enabled.'),
    created_at: z.string().describe('Timestamp when the upstream was created.'),
    updated_at: z.string().describe('Timestamp when the upstream was last updated.'),
  }).describe('One SaaS Custom Domains upstream.')).describe('Upstreams returned by SaaS Custom Domains.').optional(),
  pagination: z.looseObject({
    page: z.int().describe('Returned page number.').optional(),
    count: z.int().describe('Total number of items in the collection.').optional(),
  }).describe('Pagination metadata returned by SaaS Custom Domains.').optional(),
}).describe('Output payload for SaaS Custom Domains upstream listing.')

export const createUpstreamInput = z.strictObject({
  account_uuid: z.string().min(1).describe('SaaS Custom Domains account UUID.'),
  host: z.string().min(1).describe('Host name accepted by SaaS Custom Domains.'),
  tls: z.boolean().describe('Whether the upstream uses TLS.').optional(),
  port: z.int().min(1).describe('Port on which the upstream application listens.').optional(),
  bubble_io: z.boolean().describe('Whether the upstream is a Bubble.io app.').optional(),
  compression_enabled: z.boolean().describe('Whether automatic response compression is enabled.').optional(),
  geocoding_enabled: z.boolean().describe('Whether geocoding headers are enabled.').optional(),
  auth_token: z.string().min(1).describe('Auth token to use when forwarding requests to the upstream.').optional(),
}).describe('Input parameters for creating a SaaS Custom Domains upstream.')

export const createUpstreamOutput = z.strictObject({
  upstream: z.looseObject({
    uuid: z.string().min(1).describe('Unique identifier for the upstream.'),
    host: z.string().describe('Host of the upstream web application.'),
    port: z.int().describe('Port on which the upstream application listens.'),
    tls: z.boolean().describe('Whether the upstream expects TLS traffic.'),
    auth_token: z.string().describe('Auth token used when forwarding requests to the upstream.'),
    bubble_io: z.boolean().describe('Whether the upstream is a Bubble.io app.'),
    compression_enabled: z.boolean().describe('Whether automatic response compression is enabled.'),
    geocoding_enabled: z.boolean().describe('Whether geocoding headers are enabled.'),
    created_at: z.string().describe('Timestamp when the upstream was created.'),
    updated_at: z.string().describe('Timestamp when the upstream was last updated.'),
  }).describe('One SaaS Custom Domains upstream.').optional(),
}).describe('Output payload for a created SaaS Custom Domains upstream.')

export const getUpstreamInput = z.strictObject({
  account_uuid: z.string().min(1).describe('SaaS Custom Domains account UUID.').optional(),
  upstream_uuid: z.string().min(1).describe('SaaS Custom Domains upstream UUID.').optional(),
}).describe('Input parameters for retrieving a SaaS Custom Domains upstream.')

export const getUpstreamOutput = z.strictObject({
  upstream: z.looseObject({
    uuid: z.string().min(1).describe('Unique identifier for the upstream.'),
    host: z.string().describe('Host of the upstream web application.'),
    port: z.int().describe('Port on which the upstream application listens.'),
    tls: z.boolean().describe('Whether the upstream expects TLS traffic.'),
    auth_token: z.string().describe('Auth token used when forwarding requests to the upstream.'),
    bubble_io: z.boolean().describe('Whether the upstream is a Bubble.io app.'),
    compression_enabled: z.boolean().describe('Whether automatic response compression is enabled.'),
    geocoding_enabled: z.boolean().describe('Whether geocoding headers are enabled.'),
    created_at: z.string().describe('Timestamp when the upstream was created.'),
    updated_at: z.string().describe('Timestamp when the upstream was last updated.'),
  }).describe('One SaaS Custom Domains upstream.').optional(),
}).describe('Output payload for one SaaS Custom Domains upstream.')

export const deleteUpstreamInput = z.strictObject({
  account_uuid: z.string().min(1).describe('SaaS Custom Domains account UUID.').optional(),
  upstream_uuid: z.string().min(1).describe('SaaS Custom Domains upstream UUID.').optional(),
}).describe('Input parameters for deleting a SaaS Custom Domains upstream.')

export const deleteUpstreamOutput = z.strictObject({
  message: z.string().describe('Deletion message returned by SaaS Custom Domains.').optional(),
}).describe('Output payload for a deleted SaaS Custom Domains upstream.')

export const listCustomDomainsInput = z.strictObject({
  account_uuid: z.string().min(1).describe('SaaS Custom Domains account UUID.'),
  upstream_uuid: z.string().min(1).describe('SaaS Custom Domains upstream UUID.'),
  host: z.string().min(1).describe('Host name accepted by SaaS Custom Domains.').optional(),
  page: z.int().min(1).describe('Page number to retrieve. Pages start at 1.').optional(),
  per_page: z.int().min(1).describe('Number of items to retrieve per page.').optional(),
}).describe('Input parameters for listing SaaS Custom Domains custom domains.')

export const listCustomDomainsOutput = z.strictObject({
  custom_domains: z.array(z.looseObject({
    uuid: z.string().min(1).describe('Unique identifier for the custom domain.'),
    host: z.string().describe('Host of the custom domain.'),
    prepend_path: z.string().describe('Path prefix forwarded to the upstream.').nullable(),
    bubble_target_path: z.string().describe('Bubble.io target path for the custom domain.').nullable(),
    meta_title: z.string().describe('Browser and search preview title for the custom domain.').nullable(),
    meta_description: z.string().describe('Search result and social preview description for the custom domain.').nullable(),
    meta_favicon_url: z.string().describe('Favicon URL configured for the custom domain.').nullable(),
    meta_image_url: z.string().describe('Open Graph image URL configured for the custom domain.').nullable(),
    created_at: z.string().describe('Timestamp when the custom domain was created.'),
    updated_at: z.string().describe('Timestamp when the custom domain was last updated.'),
    last_dns_check_at: z.string().describe('Timestamp when DNS records were last checked.').nullable(),
    status: z.string().describe('DNS record status for the custom domain.'),
    tls_certificate_issued: z.boolean().describe('Whether a TLS certificate has been issued.'),
    acme_challenge_dns_record_status: z.string().describe('Status of the ACME challenge DNS record.').nullable(),
    challenge_type: z.string().describe('Certificate challenge type for the custom domain.'),
    redirect_to_www: z.boolean().describe('Whether the custom domain redirects to the www subdomain.'),
    instructions_recipient: z.string().describe('Email address where DNS instructions were sent.').nullable(),
    instructions_email_sent_at: z.string().describe('Timestamp when DNS instructions were sent.').nullable(),
    upstream_uuid: z.string().describe('UUID of the upstream that owns the custom domain.'),
    delegated_domain_control_validation_record_hostname: z.string().describe('Hostname of the ACME challenge DNS record.').nullable(),
    delegated_domain_control_validation_record_value: z.string().describe('Value of the ACME challenge DNS record.').nullable(),
  }).describe('One SaaS Custom Domains custom domain.')).describe('Custom domains returned by SaaS Custom Domains.').optional(),
  pagination: z.looseObject({
    page: z.int().describe('Returned page number.').optional(),
    count: z.int().describe('Total number of items in the collection.').optional(),
  }).describe('Pagination metadata returned by SaaS Custom Domains.').optional(),
}).describe('Output payload for SaaS Custom Domains custom domain listing.')

export const createCustomDomainInput = z.strictObject({
  account_uuid: z.string().min(1).describe('SaaS Custom Domains account UUID.'),
  upstream_uuid: z.string().min(1).describe('SaaS Custom Domains upstream UUID.'),
  host: z.string().min(1).describe('Host name accepted by SaaS Custom Domains.'),
  instructions_recipient: z.email().describe('Email address where DNS instructions should be sent.').optional(),
  prepend_path: z.string().min(1).describe('Path prefix forwarded to the upstream.').optional(),
  challenge_type: z.enum(['http01', 'dns01']).describe('Certificate challenge type.').optional(),
  redirect_to_www: z.boolean().describe('Whether to redirect traffic to the www subdomain.').optional(),
}).describe('Input parameters for creating a SaaS Custom Domains custom domain.')

export const createCustomDomainOutput = z.strictObject({
  custom_domain: z.looseObject({
    uuid: z.string().min(1).describe('Unique identifier for the custom domain.'),
    host: z.string().describe('Host of the custom domain.'),
    prepend_path: z.string().describe('Path prefix forwarded to the upstream.').nullable(),
    bubble_target_path: z.string().describe('Bubble.io target path for the custom domain.').nullable(),
    meta_title: z.string().describe('Browser and search preview title for the custom domain.').nullable(),
    meta_description: z.string().describe('Search result and social preview description for the custom domain.').nullable(),
    meta_favicon_url: z.string().describe('Favicon URL configured for the custom domain.').nullable(),
    meta_image_url: z.string().describe('Open Graph image URL configured for the custom domain.').nullable(),
    created_at: z.string().describe('Timestamp when the custom domain was created.'),
    updated_at: z.string().describe('Timestamp when the custom domain was last updated.'),
    last_dns_check_at: z.string().describe('Timestamp when DNS records were last checked.').nullable(),
    status: z.string().describe('DNS record status for the custom domain.'),
    tls_certificate_issued: z.boolean().describe('Whether a TLS certificate has been issued.'),
    acme_challenge_dns_record_status: z.string().describe('Status of the ACME challenge DNS record.').nullable(),
    challenge_type: z.string().describe('Certificate challenge type for the custom domain.'),
    redirect_to_www: z.boolean().describe('Whether the custom domain redirects to the www subdomain.'),
    instructions_recipient: z.string().describe('Email address where DNS instructions were sent.').nullable(),
    instructions_email_sent_at: z.string().describe('Timestamp when DNS instructions were sent.').nullable(),
    upstream_uuid: z.string().describe('UUID of the upstream that owns the custom domain.'),
    delegated_domain_control_validation_record_hostname: z.string().describe('Hostname of the ACME challenge DNS record.').nullable(),
    delegated_domain_control_validation_record_value: z.string().describe('Value of the ACME challenge DNS record.').nullable(),
  }).describe('One SaaS Custom Domains custom domain.').optional(),
}).describe('Output payload for a created SaaS Custom Domains custom domain.')

export const getCustomDomainInput = z.strictObject({
  account_uuid: z.string().min(1).describe('SaaS Custom Domains account UUID.').optional(),
  upstream_uuid: z.string().min(1).describe('SaaS Custom Domains upstream UUID.').optional(),
  domain_uuid: z.string().min(1).describe('SaaS Custom Domains custom domain UUID.').optional(),
}).describe('Input parameters for a custom-domain-scoped request.')

export const getCustomDomainOutput = z.strictObject({
  custom_domain: z.looseObject({
    uuid: z.string().min(1).describe('Unique identifier for the custom domain.'),
    host: z.string().describe('Host of the custom domain.'),
    prepend_path: z.string().describe('Path prefix forwarded to the upstream.').nullable(),
    bubble_target_path: z.string().describe('Bubble.io target path for the custom domain.').nullable(),
    meta_title: z.string().describe('Browser and search preview title for the custom domain.').nullable(),
    meta_description: z.string().describe('Search result and social preview description for the custom domain.').nullable(),
    meta_favicon_url: z.string().describe('Favicon URL configured for the custom domain.').nullable(),
    meta_image_url: z.string().describe('Open Graph image URL configured for the custom domain.').nullable(),
    created_at: z.string().describe('Timestamp when the custom domain was created.'),
    updated_at: z.string().describe('Timestamp when the custom domain was last updated.'),
    last_dns_check_at: z.string().describe('Timestamp when DNS records were last checked.').nullable(),
    status: z.string().describe('DNS record status for the custom domain.'),
    tls_certificate_issued: z.boolean().describe('Whether a TLS certificate has been issued.'),
    acme_challenge_dns_record_status: z.string().describe('Status of the ACME challenge DNS record.').nullable(),
    challenge_type: z.string().describe('Certificate challenge type for the custom domain.'),
    redirect_to_www: z.boolean().describe('Whether the custom domain redirects to the www subdomain.'),
    instructions_recipient: z.string().describe('Email address where DNS instructions were sent.').nullable(),
    instructions_email_sent_at: z.string().describe('Timestamp when DNS instructions were sent.').nullable(),
    upstream_uuid: z.string().describe('UUID of the upstream that owns the custom domain.'),
    delegated_domain_control_validation_record_hostname: z.string().describe('Hostname of the ACME challenge DNS record.').nullable(),
    delegated_domain_control_validation_record_value: z.string().describe('Value of the ACME challenge DNS record.').nullable(),
  }).describe('One SaaS Custom Domains custom domain.').optional(),
}).describe('Output payload for one SaaS Custom Domains custom domain.')

export const deleteCustomDomainInput = z.strictObject({
  account_uuid: z.string().min(1).describe('SaaS Custom Domains account UUID.').optional(),
  upstream_uuid: z.string().min(1).describe('SaaS Custom Domains upstream UUID.').optional(),
  domain_uuid: z.string().min(1).describe('SaaS Custom Domains custom domain UUID.').optional(),
}).describe('Input parameters for a custom-domain-scoped request.')

export const deleteCustomDomainOutput = z.strictObject({
  message: z.string().describe('Deletion message returned by SaaS Custom Domains.').optional(),
}).describe('Output payload for a deleted SaaS Custom Domains custom domain.')

export const verifyCustomDomainDnsRecordsInput = z.strictObject({
  account_uuid: z.string().min(1).describe('SaaS Custom Domains account UUID.').optional(),
  upstream_uuid: z.string().min(1).describe('SaaS Custom Domains upstream UUID.').optional(),
  domain_uuid: z.string().min(1).describe('SaaS Custom Domains custom domain UUID.').optional(),
}).describe('Input parameters for a custom-domain-scoped request.')

export const verifyCustomDomainDnsRecordsOutput = z.strictObject({
  message: z.string().describe('Verification message returned by SaaS Custom Domains.').optional(),
  dns_status: z.string().describe('DNS verification status returned by SaaS Custom Domains.').optional(),
  host: z.string().describe('Custom domain host that was verified.').optional(),
}).describe('Output payload for SaaS Custom Domains DNS record verification.')

export const purgeCustomDomainHttpCacheInput = z.strictObject({
  account_uuid: z.string().min(1).describe('SaaS Custom Domains account UUID.').optional(),
  upstream_uuid: z.string().min(1).describe('SaaS Custom Domains upstream UUID.').optional(),
  domain_uuid: z.string().min(1).describe('SaaS Custom Domains custom domain UUID.').optional(),
}).describe('Input parameters for a custom-domain-scoped request.')

export const purgeCustomDomainHttpCacheOutput = z.strictObject({
  message: z.string().describe('Cache purge message returned by SaaS Custom Domains.').optional(),
}).describe('Output payload for a SaaS Custom Domains HTTP cache purge.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const saasCustomDomainsActions = {
  list_accounts: {
    description: 'List SaaS Custom Domains accounts available to the API token.',
    effect: 'read',
    inputSchema: listAccountsInput,
    outputSchema: z.toJSONSchema(listAccountsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_upstreams: {
    description: 'List upstreams for a SaaS Custom Domains account.',
    effect: 'read',
    inputSchema: listUpstreamsInput,
    outputSchema: z.toJSONSchema(listUpstreamsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_upstream: {
    description: 'Create an upstream for a SaaS Custom Domains account.',
    effect: 'write',
    inputSchema: createUpstreamInput,
    outputSchema: z.toJSONSchema(createUpstreamOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_upstream: {
    description: 'Retrieve one SaaS Custom Domains upstream by UUID.',
    effect: 'read',
    inputSchema: getUpstreamInput,
    outputSchema: z.toJSONSchema(getUpstreamOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_upstream: {
    description: 'Delete one SaaS Custom Domains upstream and its custom domains.',
    effect: 'destructive',
    inputSchema: deleteUpstreamInput,
    outputSchema: z.toJSONSchema(deleteUpstreamOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_custom_domains: {
    description: 'List custom domains for a SaaS Custom Domains upstream.',
    effect: 'read',
    inputSchema: listCustomDomainsInput,
    outputSchema: z.toJSONSchema(listCustomDomainsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_custom_domain: {
    description: 'Create a custom domain for a SaaS Custom Domains upstream.',
    effect: 'write',
    inputSchema: createCustomDomainInput,
    outputSchema: z.toJSONSchema(createCustomDomainOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_custom_domain: {
    description: 'Retrieve one SaaS Custom Domains custom domain by UUID.',
    effect: 'read',
    inputSchema: getCustomDomainInput,
    outputSchema: z.toJSONSchema(getCustomDomainOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_custom_domain: {
    description: 'Delete one SaaS Custom Domains custom domain.',
    effect: 'destructive',
    inputSchema: deleteCustomDomainInput,
    outputSchema: z.toJSONSchema(deleteCustomDomainOutput, { io: 'output', unrepresentable: 'any' }),
  },
  verify_custom_domain_dns_records: {
    description: 'Trigger DNS record verification for one SaaS Custom Domains custom domain.',
    effect: 'write',
    inputSchema: verifyCustomDomainDnsRecordsInput,
    outputSchema: z.toJSONSchema(verifyCustomDomainDnsRecordsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  purge_custom_domain_http_cache: {
    description: 'Initiate an HTTP cache purge for one SaaS Custom Domains custom domain.',
    effect: 'destructive',
    inputSchema: purgeCustomDomainHttpCacheInput,
    outputSchema: z.toJSONSchema(purgeCustomDomainHttpCacheOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
