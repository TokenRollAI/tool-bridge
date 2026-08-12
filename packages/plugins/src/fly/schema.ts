/**
 * Fly.io 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listAppsInput = z.strictObject({
  org_slug: z.string().min(1).describe('The Fly organization slug, or personal, to filter apps.'),
  app_role: z.string().describe('Optional app role filter.').optional(),
}).describe('Input parameters for listing Fly Apps.')

export const listAppsOutput = z.looseObject({
  apps: z.array(z.looseObject({
    id: z.string().describe('The app identifier.').optional(),
    internal_numeric_id: z.int().describe('The internal numeric app identifier.').optional(),
    machine_count: z.int().describe('The number of Machines in the app.').optional(),
    name: z.string().describe('The app name.').optional(),
    network: z.string().describe('The private network name associated with the app.').optional(),
    organization: z.looseObject({
      internal_numeric_id: z.int().describe('The internal numeric organization identifier.').optional(),
      name: z.string().describe('The organization display name.').optional(),
      slug: z.string().describe('The organization slug.').optional(),
    }).describe('Fly organization information for an app.').optional(),
    status: z.string().describe('The app status.').optional(),
    volume_count: z.int().describe('The number of volumes in the app.').optional(),
  }).describe('Fly App details returned by the Machines API.')).describe('Fly Apps matching the request.').optional(),
  total_apps: z.int().describe('The total number of apps returned by Fly.').optional(),
}).describe('Apps returned by the Fly Machines API.')

export const getAppInput = z.strictObject({
  app_name: z.string().min(1).describe('The Fly App name.').optional(),
}).describe('Input parameters for retrieving a Fly App.')

export const getAppOutput = z.looseObject({
  id: z.string().describe('The app identifier.').optional(),
  internal_numeric_id: z.int().describe('The internal numeric app identifier.').optional(),
  machine_count: z.int().describe('The number of Machines in the app.').optional(),
  name: z.string().describe('The app name.').optional(),
  network: z.string().describe('The private network name associated with the app.').optional(),
  organization: z.looseObject({
    internal_numeric_id: z.int().describe('The internal numeric organization identifier.').optional(),
    name: z.string().describe('The organization display name.').optional(),
    slug: z.string().describe('The organization slug.').optional(),
  }).describe('Fly organization information for an app.').optional(),
  status: z.string().describe('The app status.').optional(),
  volume_count: z.int().describe('The number of volumes in the app.').optional(),
}).describe('Fly App details returned by the Machines API.')

export const listMachinesInput = z.strictObject({
  app_name: z.string().min(1).describe('The Fly App name.'),
  include_deleted: z.boolean().describe('Whether to include deleted Machines.').optional(),
  region: z.string().describe('Optional Fly region filter.').optional(),
  state: z.string().describe('Comma-separated Machine states to filter, such as created, started, stopped, or suspended.').optional(),
  summary: z.boolean().describe('Whether to omit large Machine details such as config, checks, and events.').optional(),
}).describe('Input parameters for listing Fly Machines in an app.')

export const listMachinesOutput = z.array(z.looseObject({
  checks: z.array(z.looseObject({
    name: z.string().describe('The check name.').optional(),
    output: z.string().describe('The latest check output.').optional(),
    status: z.string().describe('The latest check status.').optional(),
    updated_at: z.string().describe('When Fly last updated this check status.').optional(),
  }).describe('A Machine check status entry.')).describe('Check statuses for this Machine.').optional(),
  config: z.looseObject({}).describe('The Fly Machine configuration object returned by the Machines API.').optional(),
  created_at: z.string().describe('When this Machine was created.').optional(),
  events: z.array(z.looseObject({
    id: z.string().describe('The event identifier.').optional(),
    request: z.looseObject({}).describe('Request details for this event.').optional(),
    source: z.string().describe('The event source.').optional(),
    status: z.string().describe('The event status.').optional(),
    timestamp: z.int().describe('The event timestamp.').optional(),
    type: z.string().describe('The event type.').optional(),
  }).describe('A Machine event returned by Fly.')).describe('Events for this Machine.').optional(),
  host_status: z.string().describe('The Machine host status.').optional(),
  id: z.string().describe('The Machine ID.').optional(),
  image_ref: z.looseObject({
    digest: z.string().describe('The image digest.').optional(),
    labels: z.record(z.string(), z.string().describe('A label value.')).describe('Image labels keyed by label name.').optional(),
    registry: z.string().describe('The image registry.').optional(),
    repository: z.string().describe('The image repository.').optional(),
    tag: z.string().describe('The image tag.').optional(),
  }).describe('The resolved image reference for a Machine.').optional(),
  incomplete_config: z.looseObject({}).describe('The Fly Machine configuration object returned by the Machines API.').optional(),
  instance_id: z.string().describe('The version-specific Machine instance ID.').optional(),
  name: z.string().describe('The Machine name.').optional(),
  nonce: z.string().describe('The lease nonce when the Machine is currently leased.').optional(),
  private_ip: z.string().describe('The Machine private 6PN IPv6 address.').optional(),
  region: z.string().describe('The Fly region where the Machine resides.').optional(),
  state: z.string().describe('The current Machine state.').optional(),
  updated_at: z.string().describe('When this Machine was last updated.').optional(),
}).describe('A Fly Machine returned by the Machines API.')).describe('Machines returned for the requested Fly App.')

export const createMachineInput = z.strictObject({
  app_name: z.string().min(1).describe('The Fly App name.'),
  config: z.looseObject({
    image: z.string().min(1).describe('The Docker image to run in the Machine.').optional(),
  }).describe('The Fly Machine configuration object. Include the documented image field when creating a Machine, and pass additional Fly Machine config fields as needed.'),
  lease_ttl: z.int().describe('Seconds to acquire a lease on the newly created Machine.').optional(),
  lsvd: z.boolean().describe('Whether to enable Log Structured Virtual Disks for this Machine.').optional(),
  min_secrets_version: z.int().describe('Minimum secrets version required for the Machine.').optional(),
  name: z.string().describe('Unique name for this Machine. Fly generates one when omitted.').optional(),
  region: z.string().describe('Target Fly region. Fly chooses a nearby region when omitted.').optional(),
  skip_launch: z.boolean().describe('Whether to create the Machine without booting it.').optional(),
  skip_secrets: z.boolean().describe('Whether to skip applying app secrets to the Machine.').optional(),
  skip_service_registration: z.boolean().describe('Whether to leave the Machine disconnected from request routing.').optional(),
}).describe('Input parameters for creating a Fly Machine.')

export const createMachineOutput = z.looseObject({
  checks: z.array(z.looseObject({
    name: z.string().describe('The check name.').optional(),
    output: z.string().describe('The latest check output.').optional(),
    status: z.string().describe('The latest check status.').optional(),
    updated_at: z.string().describe('When Fly last updated this check status.').optional(),
  }).describe('A Machine check status entry.')).describe('Check statuses for this Machine.').optional(),
  config: z.looseObject({}).describe('The Fly Machine configuration object returned by the Machines API.').optional(),
  created_at: z.string().describe('When this Machine was created.').optional(),
  events: z.array(z.looseObject({
    id: z.string().describe('The event identifier.').optional(),
    request: z.looseObject({}).describe('Request details for this event.').optional(),
    source: z.string().describe('The event source.').optional(),
    status: z.string().describe('The event status.').optional(),
    timestamp: z.int().describe('The event timestamp.').optional(),
    type: z.string().describe('The event type.').optional(),
  }).describe('A Machine event returned by Fly.')).describe('Events for this Machine.').optional(),
  host_status: z.string().describe('The Machine host status.').optional(),
  id: z.string().describe('The Machine ID.').optional(),
  image_ref: z.looseObject({
    digest: z.string().describe('The image digest.').optional(),
    labels: z.record(z.string(), z.string().describe('A label value.')).describe('Image labels keyed by label name.').optional(),
    registry: z.string().describe('The image registry.').optional(),
    repository: z.string().describe('The image repository.').optional(),
    tag: z.string().describe('The image tag.').optional(),
  }).describe('The resolved image reference for a Machine.').optional(),
  incomplete_config: z.looseObject({}).describe('The Fly Machine configuration object returned by the Machines API.').optional(),
  instance_id: z.string().describe('The version-specific Machine instance ID.').optional(),
  name: z.string().describe('The Machine name.').optional(),
  nonce: z.string().describe('The lease nonce when the Machine is currently leased.').optional(),
  private_ip: z.string().describe('The Machine private 6PN IPv6 address.').optional(),
  region: z.string().describe('The Fly region where the Machine resides.').optional(),
  state: z.string().describe('The current Machine state.').optional(),
  updated_at: z.string().describe('When this Machine was last updated.').optional(),
}).describe('A Fly Machine returned by the Machines API.')

export const getMachineInput = z.strictObject({
  app_name: z.string().min(1).describe('The Fly App name.').optional(),
  machine_id: z.string().min(1).describe('The Fly Machine ID.').optional(),
}).describe('Input parameters for selecting a Fly Machine by app and Machine ID.')

export const getMachineOutput = z.looseObject({
  checks: z.array(z.looseObject({
    name: z.string().describe('The check name.').optional(),
    output: z.string().describe('The latest check output.').optional(),
    status: z.string().describe('The latest check status.').optional(),
    updated_at: z.string().describe('When Fly last updated this check status.').optional(),
  }).describe('A Machine check status entry.')).describe('Check statuses for this Machine.').optional(),
  config: z.looseObject({}).describe('The Fly Machine configuration object returned by the Machines API.').optional(),
  created_at: z.string().describe('When this Machine was created.').optional(),
  events: z.array(z.looseObject({
    id: z.string().describe('The event identifier.').optional(),
    request: z.looseObject({}).describe('Request details for this event.').optional(),
    source: z.string().describe('The event source.').optional(),
    status: z.string().describe('The event status.').optional(),
    timestamp: z.int().describe('The event timestamp.').optional(),
    type: z.string().describe('The event type.').optional(),
  }).describe('A Machine event returned by Fly.')).describe('Events for this Machine.').optional(),
  host_status: z.string().describe('The Machine host status.').optional(),
  id: z.string().describe('The Machine ID.').optional(),
  image_ref: z.looseObject({
    digest: z.string().describe('The image digest.').optional(),
    labels: z.record(z.string(), z.string().describe('A label value.')).describe('Image labels keyed by label name.').optional(),
    registry: z.string().describe('The image registry.').optional(),
    repository: z.string().describe('The image repository.').optional(),
    tag: z.string().describe('The image tag.').optional(),
  }).describe('The resolved image reference for a Machine.').optional(),
  incomplete_config: z.looseObject({}).describe('The Fly Machine configuration object returned by the Machines API.').optional(),
  instance_id: z.string().describe('The version-specific Machine instance ID.').optional(),
  name: z.string().describe('The Machine name.').optional(),
  nonce: z.string().describe('The lease nonce when the Machine is currently leased.').optional(),
  private_ip: z.string().describe('The Machine private 6PN IPv6 address.').optional(),
  region: z.string().describe('The Fly region where the Machine resides.').optional(),
  state: z.string().describe('The current Machine state.').optional(),
  updated_at: z.string().describe('When this Machine was last updated.').optional(),
}).describe('A Fly Machine returned by the Machines API.')

export const startMachineInput = z.strictObject({
  app_name: z.string().min(1).describe('The Fly App name.').optional(),
  machine_id: z.string().min(1).describe('The Fly Machine ID.').optional(),
}).describe('Input parameters for selecting a Fly Machine by app and Machine ID.')

export const startMachineOutput = z.strictObject({
  ok: z.literal(true).optional(),
}).describe('Acknowledgement for a successful Fly lifecycle request.')

export const stopMachineInput = z.strictObject({
  app_name: z.string().min(1).describe('The Fly App name.'),
  machine_id: z.string().min(1).describe('The Fly Machine ID.'),
  signal: z.enum(['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGKILL', 'SIGUSR1', 'SIGUSR2', 'SIGTERM']).describe('Unix signal to send when stopping the Machine.').optional(),
  timeout: z.string().describe('Stop timeout as a Go duration string, such as 1s.').optional(),
}).describe('Input parameters for stopping a Fly Machine.')

export const stopMachineOutput = z.strictObject({
  ok: z.literal(true).optional(),
}).describe('Acknowledgement for a successful Fly lifecycle request.')

export const restartMachineInput = z.strictObject({
  app_name: z.string().min(1).describe('The Fly App name.'),
  machine_id: z.string().min(1).describe('The Fly Machine ID.'),
  signal: z.enum(['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGKILL', 'SIGUSR1', 'SIGUSR2', 'SIGTERM']).describe('Unix signal to use for the restart.').optional(),
  timeout: z.string().describe('Restart timeout as a Go duration string or number of seconds.').optional(),
}).describe('Input parameters for restarting a Fly Machine.')

export const restartMachineOutput = z.strictObject({
  ok: z.literal(true).optional(),
}).describe('Acknowledgement for a successful Fly lifecycle request.')

export const waitForMachineInput = z.strictObject({
  app_name: z.string().min(1).describe('The Fly App name.'),
  machine_id: z.string().min(1).describe('The Fly Machine ID.'),
  from_event_id: z.string().describe('Machine event ID to start waiting after.').optional(),
  state: z.enum(['started', 'stopped', 'suspended', 'destroyed', 'failed', 'settled']).describe('Desired Machine state to wait for.').optional(),
  timeout: z.int().describe('Maximum wait time in seconds. Fly defaults to 60 seconds.').optional(),
  version: z.string().describe('Machine version ID to wait for.').optional(),
}).describe('Input parameters for waiting until a Fly Machine reaches a state.')

export const waitForMachineOutput = z.looseObject({
  event_id: z.string().describe('The event ID observed by the wait request.').optional(),
  ok: z.boolean().describe('Whether the Machine reached the desired state.').optional(),
  state: z.string().describe('The Machine state observed by Fly.').optional(),
  version: z.string().describe('The Machine version observed by Fly.').optional(),
}).describe('Result returned after waiting for a Fly Machine state.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const flyActions = {
  list_apps: {
    description: 'List Fly Apps for an organization through the Machines API.',
    effect: 'read',
    inputSchema: listAppsInput,
    outputSchema: z.toJSONSchema(listAppsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_app: {
    description: 'Retrieve details for a Fly App by name.',
    effect: 'read',
    inputSchema: getAppInput,
    outputSchema: z.toJSONSchema(getAppOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_machines: {
    description: 'List Fly Machines in an app with optional state, region, and summary filters.',
    effect: 'read',
    inputSchema: listMachinesInput,
    outputSchema: z.toJSONSchema(listMachinesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_machine: {
    description: 'Create a Fly Machine in an app using a JSON Machine configuration.',
    effect: 'write',
    inputSchema: createMachineInput,
    outputSchema: z.toJSONSchema(createMachineOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_machine: {
    description: 'Retrieve a Fly Machine by app and Machine ID.',
    effect: 'read',
    inputSchema: getMachineInput,
    outputSchema: z.toJSONSchema(getMachineOutput, { io: 'output', unrepresentable: 'any' }),
  },
  start_machine: {
    description: 'Start a Fly Machine.',
    effect: 'write',
    inputSchema: startMachineInput,
    outputSchema: z.toJSONSchema(startMachineOutput, { io: 'output', unrepresentable: 'any' }),
  },
  stop_machine: {
    description: 'Stop a Fly Machine, optionally with a Unix signal and timeout.',
    effect: 'write',
    inputSchema: stopMachineInput,
    outputSchema: z.toJSONSchema(stopMachineOutput, { io: 'output', unrepresentable: 'any' }),
  },
  restart_machine: {
    description: 'Restart a Fly Machine, optionally with a Unix signal and timeout.',
    effect: 'write',
    inputSchema: restartMachineInput,
    outputSchema: z.toJSONSchema(restartMachineOutput, { io: 'output', unrepresentable: 'any' }),
  },
  wait_for_machine: {
    description: 'Wait for a Fly Machine to reach a desired state.',
    effect: 'write',
    inputSchema: waitForMachineInput,
    outputSchema: z.toJSONSchema(waitForMachineOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
