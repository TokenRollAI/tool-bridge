/**
 * E2B 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const createSandboxInput = z.strictObject({
  templateID: z.string().min(1).regex(new RegExp('\\S')).describe('The E2B template identifier used to create the sandbox.'),
  timeout: z.int().min(0).describe('Time to live for the sandbox in seconds.').optional(),
  autoPause: z.boolean().describe('Whether E2B should automatically pause the sandbox after timeout.').optional(),
  autoPauseMemory: z.boolean().describe('Whether auto-pause should preserve the sandbox memory snapshot when autoPause is true.').optional(),
  autoResume: z.strictObject({
    enabled: z.boolean().describe('Whether auto-resume is enabled for paused sandboxes.').optional(),
  }).describe('Auto-resume configuration for paused sandboxes.').optional(),
  secure: z.boolean().describe('Whether E2B should secure all system communication with the sandbox.').optional(),
  allow_internet_access: z.boolean().describe('Whether the sandbox can access the internet.').optional(),
  network: z.looseObject({
    allowPublicTraffic: z.boolean().describe('Whether sandbox URLs are publicly accessible.').optional(),
    allowOut: z.array(z.string().describe('One allowed destination such as a CIDR block, IP address, or domain.')).describe('Allowed outbound destinations for sandbox egress traffic.').optional(),
    denyOut: z.array(z.string().describe('One denied CIDR block or IP address.')).describe('Denied outbound CIDR blocks or IP addresses for sandbox egress traffic.').optional(),
    egressProxy: z.looseObject({}).describe('The egress proxy configuration returned or accepted by E2B.').nullable().optional(),
    maskRequestHost: z.string().describe('The host mask used for sandbox requests.').optional(),
    rules: z.looseObject({}).describe('Per-domain outbound request transform rules.').optional(),
  }).describe('The E2B sandbox network configuration object.').optional(),
  metadata: z.record(z.string(), z.string().describe('One sandbox metadata value.')).describe('String metadata attached to the sandbox.').optional(),
  envVars: z.record(z.string(), z.string().describe('One sandbox environment variable value.')).describe('Environment variables passed to the sandbox.').optional(),
  mcp: z.looseObject({}).describe('MCP configuration for the sandbox.').nullable().optional(),
  volumeMounts: z.array(z.strictObject({
    name: z.string().describe('The volume name.').optional(),
    path: z.string().describe('The volume mount path inside the sandbox.').optional(),
  }).describe('An E2B sandbox volume mount.')).describe('Volume mounts to attach to the sandbox.').optional(),
}).describe('The input payload for creating an E2B sandbox.')

export const createSandboxOutput = z.strictObject({
  sandbox: z.looseObject({
    templateID: z.string().describe('Identifier of the template from which the sandbox was created.').optional(),
    sandboxID: z.string().describe('Identifier of the sandbox.').optional(),
    alias: z.string().describe('Alias of the template when returned by E2B.').optional(),
    clientID: z.string().describe('Deprecated E2B client identifier.').optional(),
    envdVersion: z.string().describe('Version of envd running in the sandbox.').optional(),
    envdAccessToken: z.string().describe('Access token for envd requests when the sandbox is secure.').nullable().optional(),
    trafficAccessToken: z.string().describe('Token required for accessing the sandbox through the E2B proxy when returned.').nullable().optional(),
    domain: z.string().describe('Deprecated E2B sandbox domain field.').nullable().optional(),
  }).describe('The E2B sandbox created by the API.').optional(),
}).describe('The response returned when creating an E2B sandbox.')

export const listSandboxesInput = z.strictObject({
  metadata: z.string().min(1).describe('Metadata query used to filter sandboxes, such as "user=abc&app=prod". Keys and values must already be URL encoded.').optional(),
  state: z.array(z.enum(['running', 'paused']).describe('The E2B sandbox lifecycle state.')).min(1).describe('Sandbox states used to filter the list.').optional(),
  nextToken: z.string().min(1).describe('Cursor returned by E2B for the next page.').optional(),
  limit: z.int().min(1).max(100).describe('Maximum number of sandboxes to return per page.').optional(),
}).describe('The input payload for listing E2B sandboxes.')

export const listSandboxesOutput = z.strictObject({
  sandboxes: z.array(z.looseObject({
    templateID: z.string().describe('Identifier of the template from which the sandbox was created.').optional(),
    alias: z.string().describe('Alias of the template when returned by E2B.').optional(),
    sandboxID: z.string().describe('Identifier of the sandbox.').optional(),
    clientID: z.string().describe('Deprecated E2B client identifier.').optional(),
    startedAt: z.iso.datetime({ offset: true }).describe('Time when the sandbox was started.').optional(),
    endAt: z.iso.datetime({ offset: true }).describe('Time when the sandbox will expire.').optional(),
    cpuCount: z.int().describe('CPU cores allocated to the sandbox.').optional(),
    memoryMB: z.int().describe('Memory allocated to the sandbox in MiB.').optional(),
    diskSizeMB: z.int().describe('Disk size allocated to the sandbox in MiB.').optional(),
    metadata: z.record(z.string(), z.string().describe('One sandbox metadata value.')).describe('String metadata attached to the sandbox.').optional(),
    state: z.enum(['running', 'paused']).describe('The E2B sandbox lifecycle state.').optional(),
    envdVersion: z.string().describe('Version of envd running in the sandbox.').optional(),
    volumeMounts: z.array(z.strictObject({
      name: z.string().describe('The volume name.').optional(),
      path: z.string().describe('The volume mount path inside the sandbox.').optional(),
    }).describe('An E2B sandbox volume mount.')).describe('Volume mounts attached to the sandbox.').optional(),
  }).describe('An E2B sandbox returned by the sandbox list endpoint.')).describe('The sandboxes returned by E2B.').optional(),
}).describe('The response returned when listing E2B sandboxes.')

export const getSandboxInput = z.strictObject({
  sandboxID: z.string().min(1).regex(new RegExp('\\S')).describe('The E2B sandbox identifier.').optional(),
}).describe('The input payload for selecting an E2B sandbox.')

export const getSandboxOutput = z.strictObject({
  sandbox: z.looseObject({
    templateID: z.string().describe('Identifier of the template from which the sandbox was created.').optional(),
    alias: z.string().describe('Alias of the template when returned by E2B.').optional(),
    sandboxID: z.string().describe('Identifier of the sandbox.').optional(),
    clientID: z.string().describe('Deprecated E2B client identifier.').optional(),
    startedAt: z.iso.datetime({ offset: true }).describe('Time when the sandbox was started.').optional(),
    endAt: z.iso.datetime({ offset: true }).describe('Time when the sandbox will expire.').optional(),
    envdVersion: z.string().describe('Version of envd running in the sandbox.').optional(),
    envdAccessToken: z.string().describe('Access token for envd requests when the sandbox is secure.').nullable().optional(),
    trafficAccessToken: z.string().describe('Token required for accessing the sandbox through the E2B proxy when returned.').nullable().optional(),
    domain: z.string().describe('Deprecated E2B sandbox domain field.').nullable().optional(),
    allowInternetAccess: z.boolean().describe('Whether internet access was explicitly enabled or disabled for the sandbox.').nullable().optional(),
    cpuCount: z.int().describe('CPU cores allocated to the sandbox.').optional(),
    memoryMB: z.int().describe('Memory allocated to the sandbox in MiB.').optional(),
    diskSizeMB: z.int().describe('Disk size allocated to the sandbox in MiB.').optional(),
    metadata: z.record(z.string(), z.string().describe('One sandbox metadata value.')).describe('String metadata attached to the sandbox.').optional(),
    state: z.enum(['running', 'paused']).describe('The E2B sandbox lifecycle state.').optional(),
    network: z.looseObject({
      allowPublicTraffic: z.boolean().describe('Whether sandbox URLs are publicly accessible.').optional(),
      allowOut: z.array(z.string().describe('One allowed destination such as a CIDR block, IP address, or domain.')).describe('Allowed outbound destinations for sandbox egress traffic.').optional(),
      denyOut: z.array(z.string().describe('One denied CIDR block or IP address.')).describe('Denied outbound CIDR blocks or IP addresses for sandbox egress traffic.').optional(),
      egressProxy: z.looseObject({}).describe('The egress proxy configuration returned or accepted by E2B.').nullable().optional(),
      maskRequestHost: z.string().describe('The host mask used for sandbox requests.').optional(),
      rules: z.looseObject({}).describe('Per-domain outbound request transform rules.').optional(),
    }).describe('The E2B sandbox network configuration object.').optional(),
    lifecycle: z.looseObject({}).describe('Sandbox lifecycle configuration returned by E2B.').optional(),
    volumeMounts: z.array(z.strictObject({
      name: z.string().describe('The volume name.').optional(),
      path: z.string().describe('The volume mount path inside the sandbox.').optional(),
    }).describe('An E2B sandbox volume mount.')).describe('Volume mounts attached to the sandbox.').optional(),
  }).describe('Detailed E2B sandbox information.').optional(),
}).describe('The response returned when retrieving an E2B sandbox.')

export const deleteSandboxInput = z.strictObject({
  sandboxID: z.string().min(1).regex(new RegExp('\\S')).describe('The E2B sandbox identifier.').optional(),
}).describe('The input payload for selecting an E2B sandbox.')

export const deleteSandboxOutput = z.strictObject({
  sandboxID: z.string().min(1).regex(new RegExp('\\S')).describe('The E2B sandbox identifier.').optional(),
  success: z.boolean().describe('Whether the sandbox delete request completed successfully.').optional(),
}).describe('The response returned after deleting an E2B sandbox.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const e2bActions = {
  create_sandbox: {
    description: 'Create an E2B sandbox from a template.',
    effect: 'write',
    inputSchema: createSandboxInput,
    outputSchema: z.toJSONSchema(createSandboxOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_sandboxes: {
    description: 'List E2B sandboxes visible to the current API key.',
    effect: 'read',
    inputSchema: listSandboxesInput,
    outputSchema: z.toJSONSchema(listSandboxesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_sandbox: {
    description: 'Get one E2B sandbox by sandbox identifier.',
    effect: 'read',
    inputSchema: getSandboxInput,
    outputSchema: z.toJSONSchema(getSandboxOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_sandbox: {
    description: 'Kill an E2B sandbox by sandbox identifier.',
    effect: 'destructive',
    inputSchema: deleteSandboxInput,
    outputSchema: z.toJSONSchema(deleteSandboxOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
