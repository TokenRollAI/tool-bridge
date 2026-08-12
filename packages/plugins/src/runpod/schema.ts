/**
 * Runpod 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listPodsInput = z.strictObject({
  computeType: z.enum(['GPU', 'CPU']).describe('Filter to GPU Pods or CPU Pods only.').optional(),
  cpuFlavorId: z.array(z.string().min(1).describe('One Runpod CPU flavor ID such as cpu3c.')).min(1).describe('Filter to CPU Pods with any of the provided Runpod CPU flavor IDs.').optional(),
  dataCenterId: z.array(z.string().min(1).describe('One Runpod data center ID such as EU-RO-1.')).min(1).describe('Filter to Pods located in any of the provided Runpod data centers.').optional(),
  desiredStatus: z.enum(['RUNNING', 'EXITED', 'TERMINATED']).describe('Filter to Pods in the provided desired status.').optional(),
  endpointId: z.string().min(1).describe('Filter to Pods attached to the provided Runpod Serverless endpoint.').optional(),
  gpuTypeId: z.array(z.string().min(1).describe('One Runpod GPU type ID such as NVIDIA RTX A5000.')).min(1).describe('Filter to GPU Pods with any of the provided Runpod GPU type IDs.').optional(),
  id: z.string().min(1).describe('Filter to a specific Pod by ID.').optional(),
  imageName: z.string().min(1).describe('Filter to Pods created from the provided image name.').optional(),
  includeMachine: z.boolean().describe('Whether to include machine details for each returned Pod.').optional(),
  includeNetworkVolume: z.boolean().describe('Whether to include attached network volume details for each returned Pod.').optional(),
  includeSavingsPlans: z.boolean().describe('Whether to include savings plan details applied to each returned Pod.').optional(),
  includeTemplate: z.boolean().describe('Whether to include template details for each returned Pod.').optional(),
  includeWorkers: z.boolean().describe('Whether to include Pods that are serving as Serverless workers.').optional(),
  name: z.string().min(1).describe('Filter to Pods with the provided name.').optional(),
  networkVolumeId: z.string().min(1).describe('Filter to Pods with the provided attached network volume ID.').optional(),
  templateId: z.string().min(1).describe('Filter to Pods created from the provided template ID.').optional(),
}).describe('The input payload for listing Runpod Pods.')

export const listPodsOutput = z.strictObject({
  pods: z.array(z.looseObject({
    id: z.string().min(1).describe('The Runpod Pod ID.'),
    name: z.string().describe('The Pod name.').optional(),
    desiredStatus: z.string().describe('The desired Pod status such as RUNNING, EXITED, or TERMINATED.').optional(),
    image: z.string().describe('The image tag used by the Pod.').optional(),
    machineId: z.string().describe('The backing machine ID.').optional(),
    endpointId: z.string().describe('The attached Serverless endpoint ID when present.').optional(),
    templateId: z.string().describe('The template ID used to create the Pod.').optional(),
    publicIp: z.string().describe('The Pod public IPv4 address when available.').optional(),
    costPerHr: z.number().describe('The Pod hourly cost before savings plans.').optional(),
    adjustedCostPerHr: z.number().describe('The Pod hourly cost after active savings plans are applied.').optional(),
    interruptible: z.boolean().describe('Whether the Pod is interruptible rather than reserved.').optional(),
    locked: z.boolean().describe('Whether the Pod is locked against stop or reset.').optional(),
    lastStartedAt: z.string().describe('The UTC timestamp when the Pod was last started.').optional(),
    lastStatusChange: z.string().describe('The last Pod lifecycle status message.').optional(),
    cpuFlavorId: z.string().describe('The Runpod CPU flavor ID for CPU Pods.').optional(),
    vcpuCount: z.number().describe('The number of vCPUs assigned to the Pod.').optional(),
    memoryInGb: z.number().describe('The amount of memory assigned to the Pod in GB.').optional(),
    containerDiskInGb: z.int().describe('The container disk size assigned to the Pod in GB.').optional(),
    volumeInGb: z.int().describe('The Pod volume size assigned in GB.').optional(),
    volumeMountPath: z.string().describe('The filesystem mount path for the Pod or attached network volume.').optional(),
    ports: z.array(z.string().min(1)).describe('The exposed Pod ports.').optional(),
    portMappings: z.record(z.string(), z.int().describe('A public port.')).describe('A map from internal Pod ports to public ports.').optional(),
    env: z.record(z.string(), z.string().describe('An environment variable value.')).describe('The environment variables configured on the Pod.').optional(),
    gpu: z.looseObject({}).describe('The GPU summary for the Pod when present.').optional(),
    machine: z.looseObject({}).describe('Machine details for the Pod when included.').optional(),
    networkVolume: z.looseObject({}).describe('The attached network volume when includeNetworkVolume is enabled.').optional(),
    savingsPlans: z.array(z.looseObject({})).describe('Savings plans applied to the Pod when includeSavingsPlans is enabled.').optional(),
  }).describe('A Runpod Pod payload.')).describe('The Pods returned by Runpod.').optional(),
}).describe('The response returned when listing Runpod Pods.')

export const getPodInput = z.strictObject({
  podId: z.string().min(1).describe('The Runpod Pod ID.'),
  includeMachine: z.boolean().describe('Whether to include machine details for each returned Pod.').optional(),
  includeNetworkVolume: z.boolean().describe('Whether to include attached network volume details for each returned Pod.').optional(),
  includeSavingsPlans: z.boolean().describe('Whether to include savings plan details applied to each returned Pod.').optional(),
  includeTemplate: z.boolean().describe('Whether to include template details for each returned Pod.').optional(),
  includeWorkers: z.boolean().describe('Whether to include Pods that are serving as Serverless workers.').optional(),
}).describe('The input payload for fetching one Runpod Pod.')

export const getPodOutput = z.strictObject({
  pod: z.looseObject({
    id: z.string().min(1).describe('The Runpod Pod ID.'),
    name: z.string().describe('The Pod name.').optional(),
    desiredStatus: z.string().describe('The desired Pod status such as RUNNING, EXITED, or TERMINATED.').optional(),
    image: z.string().describe('The image tag used by the Pod.').optional(),
    machineId: z.string().describe('The backing machine ID.').optional(),
    endpointId: z.string().describe('The attached Serverless endpoint ID when present.').optional(),
    templateId: z.string().describe('The template ID used to create the Pod.').optional(),
    publicIp: z.string().describe('The Pod public IPv4 address when available.').optional(),
    costPerHr: z.number().describe('The Pod hourly cost before savings plans.').optional(),
    adjustedCostPerHr: z.number().describe('The Pod hourly cost after active savings plans are applied.').optional(),
    interruptible: z.boolean().describe('Whether the Pod is interruptible rather than reserved.').optional(),
    locked: z.boolean().describe('Whether the Pod is locked against stop or reset.').optional(),
    lastStartedAt: z.string().describe('The UTC timestamp when the Pod was last started.').optional(),
    lastStatusChange: z.string().describe('The last Pod lifecycle status message.').optional(),
    cpuFlavorId: z.string().describe('The Runpod CPU flavor ID for CPU Pods.').optional(),
    vcpuCount: z.number().describe('The number of vCPUs assigned to the Pod.').optional(),
    memoryInGb: z.number().describe('The amount of memory assigned to the Pod in GB.').optional(),
    containerDiskInGb: z.int().describe('The container disk size assigned to the Pod in GB.').optional(),
    volumeInGb: z.int().describe('The Pod volume size assigned in GB.').optional(),
    volumeMountPath: z.string().describe('The filesystem mount path for the Pod or attached network volume.').optional(),
    ports: z.array(z.string().min(1)).describe('The exposed Pod ports.').optional(),
    portMappings: z.record(z.string(), z.int().describe('A public port.')).describe('A map from internal Pod ports to public ports.').optional(),
    env: z.record(z.string(), z.string().describe('An environment variable value.')).describe('The environment variables configured on the Pod.').optional(),
    gpu: z.looseObject({}).describe('The GPU summary for the Pod when present.').optional(),
    machine: z.looseObject({}).describe('Machine details for the Pod when included.').optional(),
    networkVolume: z.looseObject({}).describe('The attached network volume when includeNetworkVolume is enabled.').optional(),
    savingsPlans: z.array(z.looseObject({})).describe('Savings plans applied to the Pod when includeSavingsPlans is enabled.').optional(),
  }).describe('A Runpod Pod payload.').optional(),
}).describe('The response returned when fetching one Runpod Pod.')

export const startPodInput = z.strictObject({
  podId: z.string().min(1).describe('The Runpod Pod ID.').optional(),
}).describe('The input payload for a Runpod Pod lifecycle request.')

export const startPodOutput = z.strictObject({
  podId: z.string().min(1).describe('The Pod ID targeted by the lifecycle request.').optional(),
  action: z.literal('start').describe('The lifecycle operation that was requested.').optional(),
  success: z.boolean().describe('Whether the lifecycle request completed successfully.').optional(),
}).describe('The response returned after requesting to start a Runpod Pod.')

export const stopPodInput = z.strictObject({
  podId: z.string().min(1).describe('The Runpod Pod ID.').optional(),
}).describe('The input payload for a Runpod Pod lifecycle request.')

export const stopPodOutput = z.strictObject({
  podId: z.string().min(1).describe('The Pod ID targeted by the lifecycle request.').optional(),
  action: z.literal('stop').describe('The lifecycle operation that was requested.').optional(),
  success: z.boolean().describe('Whether the lifecycle request completed successfully.').optional(),
}).describe('The response returned after requesting to stop a Runpod Pod.')

export const restartPodInput = z.strictObject({
  podId: z.string().min(1).describe('The Runpod Pod ID.').optional(),
}).describe('The input payload for a Runpod Pod lifecycle request.')

export const restartPodOutput = z.strictObject({
  podId: z.string().min(1).describe('The Pod ID targeted by the lifecycle request.').optional(),
  action: z.literal('restart').describe('The lifecycle operation that was requested.').optional(),
  success: z.boolean().describe('Whether the lifecycle request completed successfully.').optional(),
}).describe('The response returned after requesting to restart a Runpod Pod.')

export const resetPodInput = z.strictObject({
  podId: z.string().min(1).describe('The Runpod Pod ID.').optional(),
}).describe('The input payload for a Runpod Pod lifecycle request.')

export const resetPodOutput = z.strictObject({
  podId: z.string().min(1).describe('The Pod ID targeted by the lifecycle request.').optional(),
  action: z.literal('reset').describe('The lifecycle operation that was requested.').optional(),
  success: z.boolean().describe('Whether the lifecycle request completed successfully.').optional(),
}).describe('The response returned after requesting to reset a Runpod Pod.')

export const deletePodInput = z.strictObject({
  podId: z.string().min(1).describe('The Runpod Pod ID.').optional(),
}).describe('The input payload for a Runpod Pod lifecycle request.')

export const deletePodOutput = z.strictObject({
  podId: z.string().min(1).describe('The Pod ID targeted by the lifecycle request.').optional(),
  action: z.literal('delete').describe('The lifecycle operation that was requested.').optional(),
  success: z.boolean().describe('Whether the lifecycle request completed successfully.').optional(),
}).describe('The response returned after requesting to delete a Runpod Pod.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const runpodActions = {
  list_pods: {
    description: 'List Runpod Pods with optional official filter parameters.',
    effect: 'read',
    inputSchema: listPodsInput,
    outputSchema: z.toJSONSchema(listPodsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_pod: {
    description: 'Get one Runpod Pod by ID.',
    effect: 'read',
    inputSchema: getPodInput,
    outputSchema: z.toJSONSchema(getPodOutput, { io: 'output', unrepresentable: 'any' }),
  },
  start_pod: {
    description: 'Start or resume a Runpod Pod.',
    effect: 'write',
    inputSchema: startPodInput,
    outputSchema: z.toJSONSchema(startPodOutput, { io: 'output', unrepresentable: 'any' }),
  },
  stop_pod: {
    description: 'Stop a Runpod Pod.',
    effect: 'write',
    inputSchema: stopPodInput,
    outputSchema: z.toJSONSchema(stopPodOutput, { io: 'output', unrepresentable: 'any' }),
  },
  restart_pod: {
    description: 'Restart a Runpod Pod.',
    effect: 'write',
    inputSchema: restartPodInput,
    outputSchema: z.toJSONSchema(restartPodOutput, { io: 'output', unrepresentable: 'any' }),
  },
  reset_pod: {
    description: 'Reset a Runpod Pod.',
    effect: 'write',
    inputSchema: resetPodInput,
    outputSchema: z.toJSONSchema(resetPodOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_pod: {
    description: 'Delete a Runpod Pod.',
    effect: 'destructive',
    inputSchema: deletePodInput,
    outputSchema: z.toJSONSchema(deletePodOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
