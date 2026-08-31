/** Portable pull-only durable mailbox processor for device installations. */

import {
  deviceOperationClaimResponseSchema,
  deviceOperationCompleteRequestSchema,
  deviceOperationDetailSchema,
  deviceOperationRenewResponseSchema,
  tbErrorBodySchema,
  type WireDeviceOperationClaim,
  type WireDeviceOperationDetail,
} from '@tool-bridge/core/protocol'
import {
  type DeviceOperationCompletion,
  isTBError,
  normalizePath,
  TBError,
  type TBErrorBody,
} from '@tool-bridge/core/device'
import type {
  DeviceCallHandler,
  DeviceClientExpose,
  DeviceCredentialProvider,
} from './connection'
import { credentialHeadersFrom, statusFallback } from '../shared/transport'

export type DeviceOperationJournalState = 'discovered' | 'executing' | 'terminal'

export interface DeviceOperationJournalEntry {
  completion?: DeviceOperationCompletion
  expiresAt: string
  operationId: string
  state: DeviceOperationJournalState
  updatedAt: string
}

/**
 * Installation-local durable execution journal. Implementations must make put
 * durable before resolving and should garbage-collect entries after expiresAt.
 */
export interface DeviceOperationJournal {
  get(operationId: string): Promise<DeviceOperationJournalEntry | null>
  put(entry: DeviceOperationJournalEntry): Promise<void>
  remove(operationId: string): Promise<void>
}

export interface DeviceMailboxProcessorOptions {
  baseUrl: string
  credentialProvider: DeviceCredentialProvider
  deviceId: string
  expose: DeviceClientExpose | (() => DeviceClientExpose | Promise<DeviceClientExpose>)
  fetcher?: typeof fetch
  handler: DeviceCallHandler
  journal: DeviceOperationJournal
  /** Maximum operations processed by one drain call; default 50, maximum 200. */
  maxDrainOperations?: number
}

export interface DeviceMailboxPullResult {
  cursor?: string
  operation?: WireDeviceOperationDetail
  processed: boolean
  serverNow: string
}

export interface DeviceMailboxDrainResult {
  processed: number
  serverNow?: string
}

export interface DeviceMailboxProcessor {
  drain(opts?: { maxOperations?: number, signal?: AbortSignal }): Promise<DeviceMailboxDrainResult>
  pullOnce(opts?: { cursor?: string, signal?: AbortSignal }): Promise<DeviceMailboxPullResult>
}

interface RenewalHandle {
  failure(): Error | undefined
  stop(): Promise<void>
}

function invalidProcessor(message: string): TBError {
  return new TBError('invalid_argument', message)
}

function safeBaseUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw invalidProcessor('device mailbox baseUrl is invalid')
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
  ) throw invalidProcessor('device mailbox baseUrl must be an HTTP(S) URL without credentials')
  return url
}

function endpoint(base: URL, path: string): string {
  const url = new URL(base.toString())
  url.pathname = path
  url.search = ''
  url.hash = ''
  return url.toString()
}

function credentialHeaders(value: Awaited<ReturnType<DeviceCredentialProvider['prepare']>>): Headers {
  const headers = credentialHeadersFrom(value.headers, 'device mailbox HTTP credential')
  headers.set('accept', 'application/json')
  headers.set('content-type', 'application/json')
  return headers
}

function stableError(body: TBErrorBody, status: number): TBError {
  return new TBError(body.code, body.message, {
    retryable: body.retryable,
    ...(status === 401 ? { httpStatus: 401 } : {}),
  })
}

function parseJournalEntry(value: DeviceOperationJournalEntry | null): DeviceOperationJournalEntry | null {
  if (value === null) return null
  if (
    typeof value !== 'object'
    || typeof value.operationId !== 'string'
    || value.operationId === ''
    || !['discovered', 'executing', 'terminal'].includes(value.state)
    || typeof value.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(value.expiresAt))
    || typeof value.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(value.updatedAt))
    || (value.state === 'terminal') !== (value.completion !== undefined)
  ) throw new TBError('unavailable', 'device operation journal returned invalid state')
  return value
}

function jsonResult(value: unknown): unknown {
  let encoded: string
  try {
    encoded = JSON.stringify({ value })
  } catch {
    throw new TBError('internal', 'device mailbox handler result is not JSON serializable')
  }
  const parsed = JSON.parse(encoded) as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(parsed, 'value')) {
    throw new TBError('internal', 'device mailbox handler result is not JSON serializable')
  }
  return parsed.value
}

function failedCompletion(error: unknown, aborted: boolean): DeviceOperationCompletion {
  if (aborted) {
    return {
      outcome: 'result_unknown',
      error: {
        code: 'unavailable',
        message: 'device operation execution was interrupted',
        retryable: false,
      },
    }
  }
  const body = isTBError(error)
    ? error.toJSON()
    : { code: 'internal' as const, message: 'device mailbox handler failed', retryable: false }
  return { outcome: 'failed', error: body }
}

function queueable(expose: DeviceClientExpose, path: string): boolean {
  for (const node of expose.nodes) {
    if (node.kind !== 'tool' || node.cmds === undefined) continue
    const nodePath = normalizePath(node.path).toLowerCase()
    for (const command of node.cmds) {
      const fullPath = `${nodePath}/${command.name.toLowerCase()}`
      if (
        fullPath === path.toLowerCase()
        && (command.delivery === 'mailbox' || command.delivery === 'both')
      ) return true
    }
  }
  return false
}

function journalEntry(
  claim: WireDeviceOperationClaim,
  state: DeviceOperationJournalState,
  completion?: DeviceOperationCompletion,
): DeviceOperationJournalEntry {
  return {
    operationId: claim.operationId,
    expiresAt: claim.expiresAt,
    state,
    updatedAt: new Date().toISOString(),
    ...(completion === undefined ? {} : { completion }),
  }
}

function maxOperations(value: number | undefined, fallback: number): number {
  const actual = value ?? fallback
  if (!Number.isSafeInteger(actual) || actual < 1 || actual > 200) {
    throw invalidProcessor('maxOperations must be between 1 and 200')
  }
  return actual
}

/** Create an explicit pull processor; it never starts polling or background work on its own. */
export function createDeviceMailboxProcessor(opts: DeviceMailboxProcessorOptions): DeviceMailboxProcessor {
  const base = safeBaseUrl(opts.baseUrl)
  const fetcher = opts.fetcher ?? globalThis.fetch
  if (typeof fetcher !== 'function') throw invalidProcessor('device mailbox processor requires fetch')
  if (
    opts.journal === null
    || typeof opts.journal !== 'object'
    || typeof opts.journal.get !== 'function'
    || typeof opts.journal.put !== 'function'
    || typeof opts.journal.remove !== 'function'
  ) throw invalidProcessor('device mailbox processor requires a durable journal')
  const defaultMax = maxOperations(opts.maxDrainOperations, 50)
  let active = false

  const control = async <T>(
    path: string,
    body: Record<string, unknown>,
    schema: { safeParse(value: unknown): { data: T, success: true } | { success: false } },
    signal: AbortSignal,
  ): Promise<T> => {
    const credential = await opts.credentialProvider.prepare({
      baseUrl: opts.baseUrl,
      deviceId: opts.deviceId,
      purpose: 'http',
      signal,
    })
    if (signal.aborted) throw signal.reason
    const headers = credentialHeaders(credential)
    let response: Response
    try {
      response = await fetcher(endpoint(base, path), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        credentials: 'omit',
        redirect: 'error',
        signal,
      })
    } catch (error) {
      if (signal.aborted) throw error
      throw new TBError('unavailable', 'device mailbox request failed', { retryable: true })
    }
    let raw: unknown
    try {
      raw = await response.json()
    } catch {
      throw new TBError('unavailable', 'device mailbox returned invalid JSON', { retryable: true })
    }
    if (!response.ok) {
      const known = tbErrorBodySchema.safeParse(raw)
      const body = known.success
        ? known.data
        : {
            ...statusFallback(response.status),
            message: `device mailbox returned HTTP ${response.status}`,
          }
      if (response.status === 401) opts.credentialProvider.invalidate?.(body)
      throw stableError(body, response.status)
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      throw new TBError('unavailable', 'device mailbox returned an invalid response', {
        retryable: true,
      })
    }
    return parsed.data
  }

  const claim = async (cursor: string | undefined, signal: AbortSignal) => await control(
    '/~device/mailbox/claim',
    {
      deviceId: opts.deviceId,
      ...(cursor === undefined ? {} : { cursor }),
    },
    deviceOperationClaimResponseSchema,
    signal,
  )

  const complete = async (
    operation: WireDeviceOperationClaim,
    completion: DeviceOperationCompletion,
    signal: AbortSignal,
  ): Promise<WireDeviceOperationDetail> => {
    const body = deviceOperationCompleteRequestSchema.parse({
      deviceId: opts.deviceId,
      operationId: operation.operationId,
      leaseId: operation.leaseId,
      ...completion,
    })
    return await control(
      '/~device/mailbox/complete',
      body,
      deviceOperationDetailSchema,
      signal,
    )
  }

  const startRenewal = (
    operation: WireDeviceOperationClaim,
    initialServerNow: string,
    controller: AbortController,
  ): RenewalHandle => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending: Promise<void> | undefined
    let stopped = false
    let renewalFailure: Error | undefined
    const schedule = (serverNow: string, leaseUntil: string): void => {
      if (stopped || controller.signal.aborted) return
      const remaining = Date.parse(leaseUntil) - Date.parse(serverNow)
      const delay = Math.max(250, Math.floor(remaining / 2))
      timer = setTimeout(() => {
        pending = control(
          '/~device/mailbox/renew',
          {
            deviceId: opts.deviceId,
            operationId: operation.operationId,
            leaseId: operation.leaseId,
          },
          deviceOperationRenewResponseSchema,
          controller.signal,
        ).then((renewed) => {
          if (renewed.cancelRequestedAt !== undefined) {
            controller.abort(new TBError('unavailable', 'device operation cancellation requested'))
            return
          }
          schedule(renewed.serverNow, renewed.leaseUntil)
        }).catch((error: unknown) => {
          if (stopped) return
          renewalFailure = error instanceof Error ? error : new Error('device mailbox renewal failed')
          controller.abort(renewalFailure)
        })
      }, delay)
      ;(timer as unknown as { unref?: () => void }).unref?.()
    }
    schedule(initialServerNow, operation.leaseUntil)
    return {
      failure: () => renewalFailure,
      async stop() {
        stopped = true
        if (timer !== undefined) clearTimeout(timer)
        await pending?.catch(() => {})
      },
    }
  }

  const processOperation = async (
    operation: WireDeviceOperationClaim,
    serverNow: string,
    outerSignal: AbortSignal,
  ): Promise<WireDeviceOperationDetail> => {
    let existing = parseJournalEntry(await opts.journal.get(operation.operationId))
    if (existing !== null && existing.operationId !== operation.operationId) {
      throw new TBError('unavailable', 'device operation journal identity mismatch')
    }
    if (existing?.state === 'terminal') {
      const result = await complete(operation, existing.completion!, outerSignal)
      await opts.journal.remove(operation.operationId)
      return result
    }
    if (existing?.state === 'executing') {
      const completion: DeviceOperationCompletion = {
        outcome: 'result_unknown',
        error: {
          code: 'unavailable',
          message: 'device restarted after operation execution began',
          retryable: false,
        },
      }
      await opts.journal.put(journalEntry(operation, 'terminal', completion))
      const result = await complete(operation, completion, outerSignal)
      await opts.journal.remove(operation.operationId)
      return result
    }
    if (existing === null) {
      existing = journalEntry(operation, 'discovered')
      await opts.journal.put(existing)
    }

    const expose = await (typeof opts.expose === 'function' ? opts.expose() : opts.expose)
    if (!queueable(expose, operation.path) || operation.cancelRequestedAt !== undefined) {
      const completion: DeviceOperationCompletion = {
        outcome: 'rejected',
        error: {
          code: 'invalid_argument',
          message: operation.cancelRequestedAt === undefined
            ? 'device handler is unavailable or no longer mailbox-capable'
            : 'device operation was cancelled before execution',
          retryable: false,
        },
      }
      await opts.journal.put(journalEntry(operation, 'terminal', completion))
      const result = await complete(operation, completion, outerSignal)
      await opts.journal.remove(operation.operationId)
      return result
    }

    await opts.journal.put(journalEntry(operation, 'executing'))
    const controller = new AbortController()
    const abort = (): void => controller.abort(outerSignal.reason)
    outerSignal.addEventListener('abort', abort, { once: true })
    const renewal = startRenewal(operation, serverNow, controller)
    let completion: DeviceOperationCompletion
    try {
      const value = await opts.handler({
        id: operation.operationId,
        path: operation.path,
        arguments: operation.arguments,
        signal: controller.signal,
        context: {
          caller: operation.caller,
          traceId: operation.traceId,
          createdAt: operation.createdAt,
          expiresAt: operation.expiresAt,
        },
        uploadObject: async () => {
          throw new TBError('unavailable', 'mailbox operation Store upload is not implemented')
        },
      })
      completion = { outcome: 'succeeded', result: jsonResult(value) }
    } catch (error) {
      completion = failedCompletion(error, controller.signal.aborted)
    } finally {
      outerSignal.removeEventListener('abort', abort)
      await renewal.stop()
    }
    if (renewal.failure() !== undefined && completion.outcome === 'failed') {
      completion = failedCompletion(renewal.failure(), true)
    }
    await opts.journal.put(journalEntry(operation, 'terminal', completion))
    const result = await complete(operation, completion, outerSignal)
    await opts.journal.remove(operation.operationId)
    return result
  }

  const pullOnce = async (
    input: { cursor?: string, signal?: AbortSignal } = {},
  ): Promise<DeviceMailboxPullResult> => {
    if (active) throw new TBError('conflict', 'device mailbox processor is already active')
    active = true
    const signal = input.signal ?? new AbortController().signal
    try {
      const page = await claim(input.cursor, signal)
      if (page.operation === undefined) {
        return {
          processed: false,
          serverNow: page.serverNow,
          ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
        }
      }
      return {
        processed: true,
        serverNow: page.serverNow,
        operation: await processOperation(page.operation, page.serverNow, signal),
      }
    } finally {
      active = false
    }
  }

  return {
    pullOnce,
    async drain(input = {}) {
      const maximum = maxOperations(input.maxOperations, defaultMax)
      let cursor: string | undefined
      let processed = 0
      let serverNow: string | undefined
      while (processed < maximum) {
        const result = await pullOnce({
          ...(cursor === undefined ? {} : { cursor }),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        })
        serverNow = result.serverNow
        if (result.processed) {
          processed++
          cursor = undefined
          continue
        }
        if (result.cursor === undefined) break
        cursor = result.cursor
      }
      return { processed, ...(serverNow === undefined ? {} : { serverNow }) }
    },
  }
}
