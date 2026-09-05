import type {
  DeviceOperationState,
  DeviceOperationSummary,
} from '@tool-bridge/sdk/client'
import { Command } from 'commander'
import type { Node, Page } from '../types'
import { collect, parsePageOpts, resolveTarget, withGlobalOpts, withPageOpts } from '../args'
import { operationMeaning, printDeviceOperation } from '../deviceOutput'
import { callDirect, CliError, withClient } from '../http'
import { printJson, printLine, table } from '../output'

const OPERATION_STATES = new Set<DeviceOperationState>([
  'queued',
  'claimed',
  'succeeded',
  'rejected',
  'failed',
  'result_unknown',
  'cancelled',
  'expired',
])

function deviceIdFromPath(path: string): string {
  const parts = path.split('/')
  return parts[0] === 'device' ? (parts[1] ?? path) : path
}

export function deviceLsCommand() {
  return withPageOpts(withGlobalOpts(new Command('ls')))
    .description('List registered devices')
    .action(async (opts) => {
      const asJson = Boolean(opts.json)
      const target = resolveTarget(opts)
      const pageOpts = parsePageOpts(opts)
      const page = await callDirect<Page<Node>>(target, '/system/registry/list', {
        prefix: 'device',
        ...(Object.keys(pageOpts).length ? { opts: pageOpts } : {}),
      })
      const devices = (page.items ?? []).filter(
        n => n.kind === 'directory' && n.online !== undefined,
      )
      const out: Page<Node> = page.cursor
        ? { items: devices, cursor: page.cursor }
        : { items: devices }
      if (asJson) {
        printJson(out)
        return
      }
      if (devices.length === 0) {
        printLine(page.cursor ? '(no devices on this page)' : '(no devices)')
        if (page.cursor) printLine(`next cursor: ${page.cursor}`)
        return
      }
      // ONLINE 来自存储层的连接位(建立/拆除),不是 `~tree` 的三态 presence:registry list
      // 返回未投影的 TreeNode。LAST_SEEN 给出最近一次存活观察,让 online=yes 但早已失联的设备
      // 能被看出来。
      printLine(
        table(
          ['DEVICE_ID', 'PATH', 'RECORDED_ONLINE', 'LAST_SEEN', 'DESCRIPTION'],
          devices.map(n => [
            deviceIdFromPath(n.path),
            n.path,
            n.online ? 'yes' : 'no',
            n.lastSeenAt ?? '-',
            n.description ?? '',
          ]),
        ),
      )
      if (page.cursor) printLine(`next cursor: ${page.cursor}`)
    })
}

function states(values: readonly string[]): DeviceOperationState[] | undefined {
  if (values.length === 0) return undefined
  const unique = [...new Set(values)]
  for (const value of unique) {
    if (!OPERATION_STATES.has(value as DeviceOperationState)) {
      throw new CliError(`invalid --state '${value}'`)
    }
  }
  return unique as DeviceOperationState[]
}

function printOperationList(page: { cursor?: string, items: DeviceOperationSummary[] }): void {
  if (page.items.length === 0) {
    printLine(page.cursor ? '(no visible operations on this page)' : '(no device operations)')
  } else {
    printLine(table(
      ['OPERATION_ID', 'STATE', 'TARGET', 'CLAIM_ATTEMPTS', 'UPDATED', 'MEANING'],
      page.items.map(operation => [
        operation.operationId,
        operation.state,
        operation.targetPath,
        String(operation.attempt),
        operation.updatedAt,
        operationMeaning(operation),
      ]),
    ))
  }
  if (page.cursor) printLine(`next cursor: ${page.cursor}`)
}

export function deviceOperationListCommand() {
  return withPageOpts(withGlobalOpts(new Command('ls')))
    .alias('list')
    .description('List durable operations for one device')
    .argument('<device-id>', 'Device identifier')
    .option('--state <state>', 'Filter by operation state (repeatable)', collect, [])
    .action(async (deviceIdArg, opts) => {
      const deviceId = String(deviceIdArg ?? '').trim()
      if (deviceId === '') throw new CliError('device id is required')
      const pageOpts = parsePageOpts(opts)
      const selected = states(opts.state ?? [])
      const page = await withClient(resolveTarget(opts), async client =>
        await client.deviceOperations.list({
          deviceId,
          ...(
            Object.keys(pageOpts).length === 0 && selected === undefined
              ? {}
              : { opts: { ...pageOpts, ...(selected === undefined ? {} : { states: selected }) } }
          ),
        }))
      if (opts.json) printJson(page)
      else printOperationList(page)
    })
}

function deviceOperationReadCommand(command: 'get' | 'cancel') {
  return withGlobalOpts(new Command(command))
    .description(command === 'get' ? 'Show one durable device operation' : 'Cancel or request cancellation')
    .argument('<device-id>', 'Device identifier')
    .argument('<operation-id>', 'Operation identifier')
    .action(async (deviceIdArg, operationIdArg, opts) => {
      const deviceId = String(deviceIdArg ?? '').trim()
      const operationId = String(operationIdArg ?? '').trim()
      if (deviceId === '' || operationId === '') throw new CliError('device id and operation id are required')
      const operation = await withClient(resolveTarget(opts), async client => command === 'get'
        ? await client.deviceOperations.get(deviceId, operationId)
        : await client.deviceOperations.cancel(deviceId, operationId))
      if (opts.json) printJson(operation)
      else printDeviceOperation(operation)
    })
}

export function deviceOperationCommand() {
  return new Command('op')
    .description('Inspect and cancel durable device operations')
    .addCommand(deviceOperationListCommand())
    .addCommand(deviceOperationReadCommand('get'))
    .addCommand(deviceOperationReadCommand('cancel'))
}

export function deviceCommand() {
  return new Command('device')
    .description('Manage reverse-connected devices')
    .addCommand(deviceLsCommand())
    .addCommand(deviceOperationCommand())
}
