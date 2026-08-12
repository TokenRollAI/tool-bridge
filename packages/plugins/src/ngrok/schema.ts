/**
 * ngrok 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listEndpointsInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('Maximum number of results to return. ngrok accepts values from 1 to 100.').optional(),
  before_id: z.string().min(1).describe('Pagination cursor that requests results created before this resource ID.').optional(),
  filter: z.string().min(1).describe('CEL filter expression used by ngrok to filter the returned resources.').optional(),
}).describe('Input payload for listing ngrok endpoints.')

export const listEndpointsOutput = z.looseObject({
  uri: z.string().describe('Canonical ngrok API URI for the endpoints collection.').optional(),
  endpoints: z.array(z.looseObject({
    id: z.string().describe('Unique endpoint resource identifier.').optional(),
    created_at: z.string().describe('Timestamp in RFC 3339 format.').optional(),
    updated_at: z.string().describe('Timestamp in RFC 3339 format.').optional(),
    type: z.string().describe('Endpoint type returned by ngrok, such as edge or cloud.').optional(),
    proto: z.string().describe('Protocol served by this endpoint.').optional(),
    public_url: z.string().describe('Public URL currently serving this endpoint.').optional(),
    url: z.string().describe('API URL or frontend URL returned by ngrok for this endpoint.').optional(),
    description: z.string().describe('Human-readable description configured on this endpoint.').optional(),
    metadata: z.string().describe('User-defined metadata attached to this endpoint.').optional(),
    host: z.string().describe('Host portion returned by ngrok for this endpoint.').optional(),
    name: z.string().describe('User-defined endpoint name returned by ngrok.').optional(),
    port: z.int().describe('Port returned by ngrok for this endpoint.').optional(),
    region: z.string().describe('Region identifier returned by ngrok for this endpoint.').optional(),
    scheme: z.string().describe('Scheme returned by ngrok for this endpoint.').optional(),
    bindings: z.array(z.string().describe('Binding value returned by ngrok.')).describe('Bindings configured on this endpoint.').optional(),
    hostport: z.string().describe('Hostport returned by ngrok for this endpoint.').optional(),
    tcp_addr: z.looseObject({
      id: z.string().describe('ngrok resource identifier.').optional(),
      uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
    }).describe('Reference to another ngrok API resource.').optional(),
    principal: z.looseObject({
      id: z.string().describe('ngrok resource identifier.').optional(),
      uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
    }).describe('Reference to another ngrok API resource.').optional(),
    edge: z.looseObject({
      id: z.string().describe('ngrok resource identifier.').optional(),
      uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
    }).describe('Reference to another ngrok API resource.').optional(),
    domain: z.looseObject({
      id: z.string().describe('ngrok resource identifier.').optional(),
      uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
    }).describe('Reference to another ngrok API resource.').optional(),
    tunnel: z.looseObject({
      id: z.string().describe('ngrok resource identifier.').optional(),
      uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
    }).describe('Reference to another ngrok API resource.').optional(),
    tunnel_session: z.looseObject({
      id: z.string().describe('ngrok resource identifier.').optional(),
      uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
    }).describe('Reference to another ngrok API resource.').optional(),
    upstream_url: z.string().describe('Upstream URL forwarded to by this endpoint, when returned.').optional(),
    upstream_protocol: z.string().describe('Upstream protocol used by the ngrok agent, when returned.').optional(),
    traffic_policy: z.string().describe('Traffic policy attached to this endpoint, when returned.').optional(),
    pooling_enabled: z.boolean().describe('Whether pooling is enabled for this endpoint.').optional(),
  }).describe('ngrok endpoint object.')).describe('Resources returned by ngrok for this page.').optional(),
  next_page_uri: z.string().describe('URI of the next page, or null when there is no next page.').nullable().optional(),
}).describe('Paginated ngrok endpoints response.')

export const getEndpointInput = z.strictObject({
  endpoint_id: z.string().min(1).describe('Unique identifier of the ngrok endpoint.'),
}).describe('Input payload for fetching one ngrok endpoint by ID.')

export const getEndpointOutput = z.looseObject({
  id: z.string().describe('Unique endpoint resource identifier.').optional(),
  created_at: z.string().describe('Timestamp in RFC 3339 format.').optional(),
  updated_at: z.string().describe('Timestamp in RFC 3339 format.').optional(),
  type: z.string().describe('Endpoint type returned by ngrok, such as edge or cloud.').optional(),
  proto: z.string().describe('Protocol served by this endpoint.').optional(),
  public_url: z.string().describe('Public URL currently serving this endpoint.').optional(),
  url: z.string().describe('API URL or frontend URL returned by ngrok for this endpoint.').optional(),
  description: z.string().describe('Human-readable description configured on this endpoint.').optional(),
  metadata: z.string().describe('User-defined metadata attached to this endpoint.').optional(),
  host: z.string().describe('Host portion returned by ngrok for this endpoint.').optional(),
  name: z.string().describe('User-defined endpoint name returned by ngrok.').optional(),
  port: z.int().describe('Port returned by ngrok for this endpoint.').optional(),
  region: z.string().describe('Region identifier returned by ngrok for this endpoint.').optional(),
  scheme: z.string().describe('Scheme returned by ngrok for this endpoint.').optional(),
  bindings: z.array(z.string().describe('Binding value returned by ngrok.')).describe('Bindings configured on this endpoint.').optional(),
  hostport: z.string().describe('Hostport returned by ngrok for this endpoint.').optional(),
  tcp_addr: z.looseObject({
    id: z.string().describe('ngrok resource identifier.').optional(),
    uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
  }).describe('Reference to another ngrok API resource.').optional(),
  principal: z.looseObject({
    id: z.string().describe('ngrok resource identifier.').optional(),
    uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
  }).describe('Reference to another ngrok API resource.').optional(),
  edge: z.looseObject({
    id: z.string().describe('ngrok resource identifier.').optional(),
    uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
  }).describe('Reference to another ngrok API resource.').optional(),
  domain: z.looseObject({
    id: z.string().describe('ngrok resource identifier.').optional(),
    uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
  }).describe('Reference to another ngrok API resource.').optional(),
  tunnel: z.looseObject({
    id: z.string().describe('ngrok resource identifier.').optional(),
    uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
  }).describe('Reference to another ngrok API resource.').optional(),
  tunnel_session: z.looseObject({
    id: z.string().describe('ngrok resource identifier.').optional(),
    uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
  }).describe('Reference to another ngrok API resource.').optional(),
  upstream_url: z.string().describe('Upstream URL forwarded to by this endpoint, when returned.').optional(),
  upstream_protocol: z.string().describe('Upstream protocol used by the ngrok agent, when returned.').optional(),
  traffic_policy: z.string().describe('Traffic policy attached to this endpoint, when returned.').optional(),
  pooling_enabled: z.boolean().describe('Whether pooling is enabled for this endpoint.').optional(),
}).describe('ngrok endpoint object.')

export const listTunnelsInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('Maximum number of results to return. ngrok accepts values from 1 to 100.').optional(),
  before_id: z.string().min(1).describe('Pagination cursor that requests results created before this resource ID.').optional(),
}).describe('Input payload for listing ngrok tunnels.')

export const listTunnelsOutput = z.looseObject({
  uri: z.string().describe('Canonical ngrok API URI for the tunnels collection.').optional(),
  tunnels: z.array(z.looseObject({
    id: z.string().describe('Unique tunnel resource identifier.').optional(),
    started_at: z.string().describe('Timestamp in RFC 3339 format.').optional(),
    region: z.string().describe('Region where this tunnel is running.').optional(),
    forwards_to: z.string().describe('Upstream address that this tunnel forwards traffic to.').optional(),
    proto: z.string().describe('Tunnel protocol returned by ngrok.').optional(),
    public_url: z.string().describe('Public URL currently serving this tunnel.').optional(),
    metadata: z.string().describe('User-defined metadata attached to this tunnel.').optional(),
    endpoint: z.looseObject({
      id: z.string().describe('ngrok resource identifier.').optional(),
      uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
    }).describe('Reference to another ngrok API resource.').optional(),
    tunnel_session: z.looseObject({
      id: z.string().describe('ngrok resource identifier.').optional(),
      uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
    }).describe('Reference to another ngrok API resource.').optional(),
    backends: z.array(z.looseObject({
      id: z.string().describe('ngrok resource identifier.').optional(),
      uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
    }).describe('Reference to another ngrok API resource.')).describe('Backends attached to this tunnel group, when returned.').optional(),
    labels: z.record(z.string(), z.string().describe('Label value returned by ngrok.')).describe('Label map returned by ngrok for this tunnel.').optional(),
  }).describe('ngrok tunnel object.')).describe('Resources returned by ngrok for this page.').optional(),
  next_page_uri: z.string().describe('URI of the next page, or null when there is no next page.').nullable().optional(),
}).describe('Paginated ngrok tunnels response.')

export const listTunnelSessionsInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('Maximum number of results to return. ngrok accepts values from 1 to 100.').optional(),
  before_id: z.string().min(1).describe('Pagination cursor that requests results created before this resource ID.').optional(),
  filter: z.string().min(1).describe('CEL filter expression used by ngrok to filter the returned resources.').optional(),
}).describe('Input payload for listing ngrok tunnel sessions.')

export const listTunnelSessionsOutput = z.looseObject({
  uri: z.string().describe('Canonical ngrok API URI for the tunnel_sessions collection.').optional(),
  tunnel_sessions: z.array(z.looseObject({
    id: z.string().describe('Unique tunnel session resource identifier.').optional(),
    uri: z.string().describe('Canonical ngrok API URI for this tunnel session.').optional(),
    agent_version: z.string().describe('ngrok agent version serving this session.').optional(),
    credential: z.looseObject({
      id: z.string().describe('ngrok resource identifier.').optional(),
      uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
    }).describe('Reference to another ngrok API resource.').optional(),
    ip: z.string().describe('Source IP address of the tunnel session.').optional(),
    os: z.string().describe('Operating system reported by the ngrok agent.').optional(),
    region: z.string().describe('ngrok region where this session is connected.').optional(),
    started_at: z.string().describe('Timestamp in RFC 3339 format.').optional(),
    transport: z.string().describe('Transport protocol used by this tunnel session.').optional(),
    metadata: z.string().describe('User-defined metadata attached to this session.').optional(),
  }).describe('ngrok tunnel session object.')).describe('Resources returned by ngrok for this page.').optional(),
  next_page_uri: z.string().describe('URI of the next page, or null when there is no next page.').nullable().optional(),
}).describe('Paginated ngrok tunnel sessions response.')

export const listReservedDomainsInput = z.strictObject({
  limit: z.int().min(1).max(100).describe('Maximum number of results to return. ngrok accepts values from 1 to 100.').optional(),
  before_id: z.string().min(1).describe('Pagination cursor that requests results created before this resource ID.').optional(),
  filter: z.string().min(1).describe('CEL filter expression used by ngrok to filter the returned resources.').optional(),
}).describe('Input payload for listing ngrok reserved domains.')

export const listReservedDomainsOutput = z.looseObject({
  uri: z.string().describe('Canonical ngrok API URI for the reserved_domains collection.').optional(),
  reserved_domains: z.array(z.looseObject({
    id: z.string().describe('Unique reserved domain resource identifier.').optional(),
    uri: z.string().describe('Canonical ngrok API URI for this reserved domain.').optional(),
    created_at: z.string().describe('Timestamp in RFC 3339 format.').optional(),
    domain: z.string().describe('Hostname reserved on the ngrok account.').optional(),
    region: z.string().describe('Deprecated region field returned by ngrok, when present.').optional(),
    metadata: z.string().describe('User-defined metadata attached to this reserved domain.').optional(),
    description: z.string().describe('Human-readable description configured on this reserved domain.').optional(),
    certificate: z.looseObject({
      id: z.string().describe('ngrok resource identifier.').optional(),
      uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
    }).describe('Reference to another ngrok API resource.').optional(),
    cname_target: z.string().describe('DNS CNAME target for this reserved domain.').optional(),
    acme_challenge_cname_target: z.string().describe('DNS CNAME target used for ACME validation, when returned.').optional(),
    resolves_to: z.array(z.looseObject({
      value: z.string().describe('Resolver target value returned by ngrok.').optional(),
    }).describe('ngrok reserved domain resolve target.')).describe('Resolver targets configured on this reserved domain, when returned.').optional(),
    certificate_management_policy: z.looseObject({
      authority: z.string().describe('Certificate authority used by automatic management.').optional(),
      private_key_type: z.string().describe('Private key type used by automatic management.').optional(),
    }).describe('ngrok reserved domain certificate management policy.').optional(),
    certificate_management_status: z.looseObject({
      renews_at: z.string().describe('Timestamp when the managed certificate renews, when returned.').optional(),
      provisioning_job: z.looseObject({
        msg: z.string().describe('Status or error message returned for the certificate job.').optional(),
        error_code: z.string().describe('Certificate job error code returned by ngrok, when present.').optional(),
        retries_at: z.string().describe('Timestamp when ngrok will retry the certificate job, when present.').optional(),
        started_at: z.string().describe('Timestamp in RFC 3339 format.').optional(),
      }).describe('ngrok reserved domain certificate provisioning job.').optional(),
    }).describe('ngrok reserved domain certificate management status.').optional(),
  }).describe('ngrok reserved domain object.')).describe('Resources returned by ngrok for this page.').optional(),
  next_page_uri: z.string().describe('URI of the next page, or null when there is no next page.').nullable().optional(),
}).describe('Paginated ngrok reserved domains response.')

export const getReservedDomainInput = z.strictObject({
  reserved_domain_id: z.string().min(1).describe('Unique identifier of the ngrok reserved domain.'),
}).describe('Input payload for fetching one ngrok reserved domain by ID.')

export const getReservedDomainOutput = z.looseObject({
  id: z.string().describe('Unique reserved domain resource identifier.').optional(),
  uri: z.string().describe('Canonical ngrok API URI for this reserved domain.').optional(),
  created_at: z.string().describe('Timestamp in RFC 3339 format.').optional(),
  domain: z.string().describe('Hostname reserved on the ngrok account.').optional(),
  region: z.string().describe('Deprecated region field returned by ngrok, when present.').optional(),
  metadata: z.string().describe('User-defined metadata attached to this reserved domain.').optional(),
  description: z.string().describe('Human-readable description configured on this reserved domain.').optional(),
  certificate: z.looseObject({
    id: z.string().describe('ngrok resource identifier.').optional(),
    uri: z.string().describe('Canonical ngrok API URI for this resource.').optional(),
  }).describe('Reference to another ngrok API resource.').optional(),
  cname_target: z.string().describe('DNS CNAME target for this reserved domain.').optional(),
  acme_challenge_cname_target: z.string().describe('DNS CNAME target used for ACME validation, when returned.').optional(),
  resolves_to: z.array(z.looseObject({
    value: z.string().describe('Resolver target value returned by ngrok.').optional(),
  }).describe('ngrok reserved domain resolve target.')).describe('Resolver targets configured on this reserved domain, when returned.').optional(),
  certificate_management_policy: z.looseObject({
    authority: z.string().describe('Certificate authority used by automatic management.').optional(),
    private_key_type: z.string().describe('Private key type used by automatic management.').optional(),
  }).describe('ngrok reserved domain certificate management policy.').optional(),
  certificate_management_status: z.looseObject({
    renews_at: z.string().describe('Timestamp when the managed certificate renews, when returned.').optional(),
    provisioning_job: z.looseObject({
      msg: z.string().describe('Status or error message returned for the certificate job.').optional(),
      error_code: z.string().describe('Certificate job error code returned by ngrok, when present.').optional(),
      retries_at: z.string().describe('Timestamp when ngrok will retry the certificate job, when present.').optional(),
      started_at: z.string().describe('Timestamp in RFC 3339 format.').optional(),
    }).describe('ngrok reserved domain certificate provisioning job.').optional(),
  }).describe('ngrok reserved domain certificate management status.').optional(),
}).describe('ngrok reserved domain object.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const ngrokActions = {
  list_endpoints: {
    description: 'List active ngrok endpoints for the current account, with optional pagination and CEL filtering.',
    effect: 'read',
    inputSchema: listEndpointsInput,
    outputSchema: z.toJSONSchema(listEndpointsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_endpoint: {
    description: 'Fetch one ngrok endpoint by ID and return the upstream endpoint object.',
    effect: 'read',
    inputSchema: getEndpointInput,
    outputSchema: z.toJSONSchema(getEndpointOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_tunnels: {
    description: 'List online ngrok tunnels for the current account with pagination support.',
    effect: 'read',
    inputSchema: listTunnelsInput,
    outputSchema: z.toJSONSchema(listTunnelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_tunnel_sessions: {
    description: 'List online ngrok tunnel sessions for the current account with pagination and CEL filtering.',
    effect: 'read',
    inputSchema: listTunnelSessionsInput,
    outputSchema: z.toJSONSchema(listTunnelSessionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_reserved_domains: {
    description: 'List reserved ngrok domains for the current account with pagination and CEL filtering.',
    effect: 'read',
    inputSchema: listReservedDomainsInput,
    outputSchema: z.toJSONSchema(listReservedDomainsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_reserved_domain: {
    description: 'Fetch one ngrok reserved domain by ID and return the upstream domain object.',
    effect: 'read',
    inputSchema: getReservedDomainInput,
    outputSchema: z.toJSONSchema(getReservedDomainOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
