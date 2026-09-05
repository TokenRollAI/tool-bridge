import type { DeviceOperationDetail, DeviceOperationSummary } from '@tool-bridge/sdk/client'
import { printLine, table } from './output'

/** 描述记录能证明的状态；claim/barrier 均不能证明 handler 已经执行。 */
export function operationMeaning(operation: DeviceOperationSummary): string {
  switch (operation.state) {
    case 'queued': return 'waiting for the device to claim it'
    case 'claimed': return operation.cancelRequestedAt === undefined
      ? 'claimed by the device; completion not reported'
      : 'cancellation requested; execution may still continue'
    case 'succeeded': return 'device reported success'
    case 'failed': return 'device reported failure'
    case 'rejected': return 'device rejected the operation'
    case 'cancelled': return 'cancelled before execution'
    case 'result_unknown': return 'may have started; result unknown'
    case 'expired': return operation.executionMayHaveOccurred
      ? 'expired; may have executed, result unknown'
      : 'expired before execution'
  }
}

export function printDeviceOperation(operation: DeviceOperationDetail): void {
  printLine(`state: ${operation.state} (${operationMeaning(operation)})`)
  printLine(table(
    ['FIELD', 'VALUE'],
    [
      ['operation', operation.operationId],
      ['device', operation.deviceId],
      ['command', operation.targetPath],
      ['claim attempts', String(operation.attempt)],
      ['created', operation.createdAt],
      ['expires', operation.expiresAt],
      ['updated', operation.updatedAt],
      ...(operation.cancelRequestedAt === undefined
        ? []
        : [['cancellation requested', operation.cancelRequestedAt]]),
    ],
  ))
  if (operation.state === 'result_unknown' || (operation.state === 'expired' && operation.executionMayHaveOccurred)) {
    printLine('Execution is uncertain; check the business result before retrying.')
  }
  if (operation.error !== undefined) printLine(`error: ${operation.error.code}: ${operation.error.message}`)
  if (operation.result !== undefined) printLine(`result: ${JSON.stringify(operation.result)}`)
}
