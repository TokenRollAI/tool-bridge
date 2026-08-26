/**
 * Query-time federated keyword search coordinator.
 *
 * 每一跳只发现自己的 direct remote mounts；child 再递归自己的 direct mounts。
 * Coordinator 只缓存 compact head/continuation，完整 schema 在响应前按精确路径重新
 * 鉴权并 hydrate，因而 session 不持有凭证、baseUrl 或 schema。
 */
import {
  type CallContext,
  check,
  checkVia,
  NodeRegistryStore,
  type NormalizedToolSearchOptions,
  normalizeToolSearchOptions,
  parseVia,
  prepareToolSearchQuery,
  type SearchIndex,
  sha256Hex,
  type StateStore,
  TBError,
  TOOL_SEARCH_AUDIT_NODE_LIMIT,
  TOOL_SEARCH_DESCRIPTION_BYTES_MAX,
  TOOL_SEARCH_PAGE_BYTES,
  TOOL_SEARCH_RANKING_VERSION,
  type ToolSpec,
  type TreeNode,
  type TreePath,
  virtualizeTools,
} from '@tool-bridge/core'
import {
  helpJsonSchema,
  toolSearchPageSchema,
  type WireToolSearchItem,
  type WireToolSearchPage,
  type WireToolSearchRequest,
  type WireToolSearchSourceResult,
  type WireToolSearchSourceStatus,
} from '@tool-bridge/core/protocol'
import type { TbAppDeps } from '../deps'
import {
  type FederatedSearchSessionRecord,
  FederatedSearchSessionStore,
  isFederatedSearchSessionHandle,
} from './federatedSession'
import {
  canonicalRemotePath,
  RemotePathProjector,
  resolveRemoteSettings,
} from '../federation'
import {
  federatedSearchSettings,
  passthroughRemote,
} from '../providers/remote'
import { canonicalSearchTools, type SearchSynchronizer } from './synchronizer'
import { executeLocalSearch } from './localSearch'

const HEADER_REMAINING_MS = 'x-tb-search-remaining-ms'
const HEADER_SESSION_TTL_MS = 'x-tb-search-session-ttl-ms'
const HEADER_SOURCE_BUDGET = 'x-tb-search-source-budget'
const HEADER_VALIDATE_SNAPSHOT = 'x-tb-search-validate-snapshot'
const HEADER_VIA = 'x-tb-via'
const HEADER_WANT_SNAPSHOT = 'x-tb-search-want-snapshot'

interface SourceContinuation {
  balanceCount: number
  balanceCoverage?: number
  budget: number
  cursor?: string
  done: boolean
  excluded?: boolean
  kind: 'local' | 'remote'
  nextCursor?: string
  path: TreePath
  pending?: WireToolSearchItem
  validationCursor?: string
}

interface FederationPolicy {
  limit: number
  matching: 'all' | 'best'
}

interface FederatedPageState {
  excluded: WireToolSearchSourceResult[]
  page: WireToolSearchPage
  sources: SourceContinuation[]
  successfulSources: number
}

type SessionRecord = FederatedSearchSessionRecord<
  WireToolSearchPage,
  SourceContinuation[],
  WireToolSearchSourceResult[],
  FederationPolicy
>

interface CoordinatorInput {
  ctx: CallContext
  headers: Headers
  request: WireToolSearchRequest
  requestUrl: string
  search: SearchIndex
  searchSync?: SearchSynchronizer
  state: StateStore
}

function clampHeader(value: string | null, local: number): number {
  if (value === null || !/^\d+$/u.test(value)) return local
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, local) : local
}

function isPrefix(prefix: TreePath, path: TreePath): boolean {
  return prefix === '' || prefix === path || path.startsWith(`${prefix}/`)
}

function controlledStatus(error: unknown): WireToolSearchSourceStatus {
  if (error instanceof TBError) {
    if (error.message.includes('环')) return 'cycle'
    if (error.message.includes('跳数')) return 'hop_limit'
    if (error.message.includes('aborted')) return 'timed_out'
    if (error.message.includes('work budget')) return 'budget_exhausted'
  }
  return 'unavailable'
}

function retryableContinuationError(): TBError {
  return new TBError('unavailable', 'federated search continuation source unavailable', {
    retryable: true,
  })
}

function invalidContinuation(): TBError {
  return new TBError('invalid_argument', 'federated search cursor no longer matches topology', {
    retryable: false,
  })
}

function continuationSourceError(error: unknown): TBError {
  if (error instanceof TBError) {
    if (error.code === 'invalid_argument') return error
    if (error.message.includes('source work budget exhausted')) return invalidContinuation()
  }
  return retryableContinuationError()
}

function compactItem(item: WireToolSearchItem): WireToolSearchItem {
  const tool = { ...item.tool }
  delete tool.inputSchema
  delete tool.outputSchema
  if (tool.description !== undefined) {
    const encoder = new TextEncoder()
    if (encoder.encode(tool.description).length > TOOL_SEARCH_DESCRIPTION_BYTES_MAX) {
      let description = ''
      let bytes = 0
      for (const char of tool.description) {
        const size = encoder.encode(char).length
        if (bytes + size > TOOL_SEARCH_DESCRIPTION_BYTES_MAX) break
        description += char
        bytes += size
      }
      tool.description = description
    }
  }
  return { ...item, tool }
}

function normalizedEffect(effect: unknown): 'destructive' | 'read' | 'unknown' | 'write' {
  return effect === 'read' || effect === 'write' || effect === 'destructive'
    ? effect
    : 'unknown'
}

function requestConstraints(request: WireToolSearchRequest): NormalizedToolSearchOptions {
  return normalizeToolSearchOptions({
    ...(request.opts?.effects === undefined ? {} : { effects: request.opts.effects }),
    matching: request.opts?.matching ?? 'best',
    ...(request.opts?.minCoverage === undefined
      ? {}
      : { minCoverage: request.opts.minCoverage }),
    ...(request.opts?.pathPrefix === undefined
      ? {}
      : { pathPrefix: request.opts.pathPrefix }),
  })
}

function assertHardResultConstraints(
  item: WireToolSearchItem,
  constraints: NormalizedToolSearchOptions,
): void {
  const effects = constraints.effects === undefined ? undefined : new Set(constraints.effects)
  if (
    (constraints.pathPrefix !== undefined && !isPrefix(constraints.pathPrefix, item.path))
    || (
      constraints.minCoverage !== undefined
      && item.relevance.coverage < constraints.minCoverage
    )
    || (effects !== undefined && !effects.has(normalizedEffect(item.tool.effect)))
  ) {
    throw new TBError('unavailable', 'remote search violated a hard result constraint', {
      retryable: false,
    })
  }
}

function sourceStatusKey(value: WireToolSearchSourceResult): string {
  return `${value.path}\0${value.status}`
}

function mergeStatuses(
  ...groups: ReadonlyArray<readonly WireToolSearchSourceResult[]>
): WireToolSearchSourceResult[] {
  const seen = new Set<string>()
  const out: WireToolSearchSourceResult[] = []
  for (const item of groups.flat()) {
    const key = sourceStatusKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out.sort((left, right) => left.path.localeCompare(right.path)
    || left.status.localeCompare(right.status))
}

function responseHasMore(sources: readonly SourceContinuation[]): boolean {
  return sources.some(source => source.pending !== undefined || !source.done)
}

function serializableSources(sources: readonly SourceContinuation[]): SourceContinuation[] {
  return sources.map(source => ({
    balanceCount: source.balanceCount,
    ...(source.balanceCoverage === undefined ? {} : { balanceCoverage: source.balanceCoverage }),
    budget: source.budget,
    done: source.done,
    ...(source.excluded === undefined ? {} : { excluded: source.excluded }),
    kind: source.kind,
    path: source.path,
    ...(source.cursor === undefined ? {} : { cursor: source.cursor }),
    ...(source.nextCursor === undefined ? {} : { nextCursor: source.nextCursor }),
    ...(source.pending === undefined ? {} : { pending: compactItem(source.pending) }),
    ...(source.validationCursor === undefined
      ? {}
      : { validationCursor: source.validationCursor }),
  }))
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function assertNextRecord(
  current: SessionRecord,
  next: SessionRecord,
  topology: string,
): void {
  if (
    next.topologyDigest !== topology
    || next.rankingVersion !== TOOL_SEARCH_RANKING_VERSION
    || next.sessionId !== current.sessionId
    || next.generation !== current.generation + 1
    || next.expiresAt !== current.expiresAt
    || !sameJson(next.federationPolicy, current.federationPolicy)
  ) {
    throw invalidContinuation()
  }
}

function assertCachedPage(
  computed: FederatedPageState,
  cached: SessionRecord,
): void {
  if (
    !sameJson(computed.page, cached.page)
    || !sameJson(computed.excluded, cached.excludedStatuses)
    || !sameJson(serializableSources(computed.sources), cached.sourceContinuations)
  ) {
    throw invalidContinuation()
  }
}

function requestForDigest(request: WireToolSearchRequest, limit: number): unknown {
  const opts = request.opts ?? {}
  return {
    query: request.query,
    opts: {
      effects: opts.effects ?? null,
      federation: 'recursive',
      limit,
      matching: opts.matching ?? 'best',
      minCoverage: opts.minCoverage ?? null,
      mode: opts.mode ?? 'keyword',
      pathPrefix: opts.pathPrefix ?? null,
    },
  }
}

async function topologyDigest(
  nodes: readonly TreeNode[],
  includeLocal: boolean,
  localRevision: number | string,
  remotePolicy: unknown,
): Promise<string> {
  return await sha256Hex(canonicalJson({
    local: includeLocal,
    localRevision,
    nodes: nodes.map(node => ({
      kind: node.kind,
      path: node.path,
      remote: node.config?.kind === 'remote'
        ? { baseUrl: node.config.baseUrl, skRef: node.config.skRef ?? null }
        : null,
      updatedAt: node.updatedAt ?? '',
      virtualize: node.virtualize ?? null,
    })),
    remotePolicy,
  }))
}

function directRemoteNodes(nodes: readonly TreeNode[]): TreeNode[] {
  const remotes = nodes
    .filter(node => node.kind === 'remote' && node.config?.kind === 'remote')
    .sort((left, right) => left.path.localeCompare(right.path))
  return remotes.filter(node => !remotes.some(parent =>
    parent.path !== node.path && isPrefix(parent.path, node.path)))
}

function childPrefixFor(
  mount: TreePath,
  pathPrefix: string | undefined,
): { eligible: boolean, pathPrefix?: TreePath } {
  if (pathPrefix === undefined) return { eligible: true }
  if (isPrefix(mount, pathPrefix)) {
    const child = new RemotePathProjector(mount).childPath(pathPrefix)
    return { eligible: true, ...(child === '' ? {} : { pathPrefix: child }) }
  }
  return { eligible: isPrefix(pathPrefix, mount) }
}

function localEligible(remotes: readonly TreeNode[], pathPrefix: string | undefined): boolean {
  return pathPrefix === undefined || !remotes.some(node => isPrefix(node.path, pathPrefix))
}

async function mapLimit<T, R>(
  values: readonly T[],
  concurrency: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++
      results[index] = await fn(values[index] as T)
    }
  })
  await Promise.all(workers)
  return results
}

function deadlineSignal(deadline: number): AbortSignal {
  return AbortSignal.timeout(Math.max(1, Math.floor(deadline - Date.now())))
}

function federatedHeaders(
  inbound: Headers,
  remainingMs: number,
  sourceBudget: number,
  sessionTtlMs: number,
): Headers {
  const headers = new Headers()
  headers.set('accept', 'application/json')
  headers.set('content-type', 'application/json')
  const via = inbound.get(HEADER_VIA)
  if (via !== null) headers.set(HEADER_VIA, via)
  headers.set(HEADER_REMAINING_MS, String(Math.max(1, Math.floor(remainingMs))))
  headers.set(HEADER_SESSION_TTL_MS, String(Math.max(1, Math.floor(sessionTtlMs))))
  headers.set(HEADER_SOURCE_BUDGET, String(Math.max(1, Math.floor(sourceBudget))))
  headers.set(HEADER_WANT_SNAPSHOT, '1')
  return headers
}

function projectChildPage(
  mount: TreePath,
  page: WireToolSearchPage,
  totalTermCount: number,
  ctx: CallContext,
  request: WireToolSearchRequest,
): WireToolSearchPage {
  const projector = new RemotePathProjector(mount)
  const constraints = requestConstraints(request)
  const items = page.items.map((item) => {
    if (
      item.relevance.rankingVersion !== TOOL_SEARCH_RANKING_VERSION
      || item.relevance.totalTermCount !== totalTermCount
      || item.relevance.matchedTermCount < 1
      || item.relevance.matchedTermCount > totalTermCount
      || item.relevance.coverage !== item.relevance.matchedTermCount / totalTermCount
    ) {
      throw new TBError('unavailable', 'remote search returned incompatible relevance evidence', {
        retryable: false,
      })
    }
    const path = projector.localPath(item.path, false)
    const sourcePath = projector.localPath(item.source?.path ?? '', true)
    if (item.tool.name.includes('/')) {
      throw new TBError('unavailable', 'remote search returned an unsafe tool name', {
        retryable: false,
      })
    }
    try {
      if (canonicalRemotePath(item.tool.name, false) !== item.tool.name.toLowerCase()) {
        throw new Error('non-canonical')
      }
    } catch {
      throw new TBError('unavailable', 'remote search returned an unsafe tool name', {
        retryable: false,
      })
    }
    if (!isPrefix(sourcePath, path)) {
      throw new TBError('unavailable', 'remote search source does not own its result', {
        retryable: false,
      })
    }
    const projected = compactItem({ ...item, path, source: { path: sourcePath } })
    assertHardResultConstraints(projected, constraints)
    return projected
  }).filter(item => check(ctx, item.path, 'read').allow && check(ctx, item.path, 'call').allow)
  const projectedSources = page.sources?.map(source => ({
    path: projector.localPath(source.path, true),
    status: source.status,
  }))
  const sourceStatuses = new Map<TreePath, WireToolSearchSourceStatus>()
  for (const source of projectedSources ?? []) {
    const previous = sourceStatuses.get(source.path)
    if (previous !== undefined && previous !== source.status) {
      throw new TBError('unavailable', 'remote search returned conflicting source statuses', {
        retryable: false,
      })
    }
    sourceStatuses.set(source.path, source.status)
  }
  const hasFailure = [...sourceStatuses.values()].some(status => status !== 'ok')
  if (
    page.partial === true !== hasFailure
    || (page.cursor !== undefined && !isFederatedSearchSessionHandle(page.cursor))
    || (page.snapshot !== undefined && !isFederatedSearchSessionHandle(page.snapshot))
  ) {
    throw new TBError('unavailable', 'remote search returned inconsistent page metadata', {
      retryable: false,
    })
  }
  const sources = projectedSources?.filter(source =>
    check(ctx, source.path, 'read').allow && check(ctx, source.path, 'call').allow)
  const visiblePartial = sources?.some(source => source.status !== 'ok') === true
  return {
    items,
    ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
    ...(visiblePartial ? { partial: true } : {}),
    ...(sources === undefined ? {} : { sources }),
  }
}

async function remoteResponse(
  deps: TbAppDeps,
  input: CoordinatorInput,
  node: TreeNode,
  requestPath: TreePath,
  method: 'GET' | 'POST',
  headers: Headers,
  deadline: number,
  body?: string,
): Promise<Response> {
  if (node.config?.kind !== 'remote') throw invalidContinuation()
  return await passthroughRemote({
    actor: {
      keyId: input.ctx.keyId,
      owner: input.ctx.owner,
      traceId: input.ctx.traceId,
    },
    ...(body === undefined ? {} : { body }),
    config: node.config,
    headers,
    maxResponseBodyBytes: federatedSearchSettings(deps.remote).maxResponseBodyBytes,
    method,
    nodePath: node.path,
    requestPath,
    requestUrl: input.requestUrl,
    secrets: deps.secrets,
    settings: await resolveRemoteSettings(input.state, deps.remote),
    signal: deadlineSignal(deadline),
  })
}

async function assertFederatedCapability(
  deps: TbAppDeps,
  input: CoordinatorInput,
  node: TreeNode,
  headers: Headers,
  deadline: number,
): Promise<void> {
  if (node.config?.kind !== 'remote' || node.config.skRef === undefined) {
    throw new TBError('unavailable', 'remote search source is unsupported', { retryable: false })
  }
  const response = await remoteResponse(
    deps,
    input,
    node,
    `${node.path}/~describe`,
    'GET',
    headers,
    deadline,
  )
  if (!response.ok) {
    throw new TBError('unavailable', 'remote search capability is unavailable', {
      retryable: response.status >= 500,
    })
  }
  const value = await response.json().catch(() => null) as unknown
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || !Array.isArray((value as { capabilities?: unknown }).capabilities)
    || !(value as { capabilities: unknown[] }).capabilities.includes('search:federated')
  ) {
    throw new TBError('unavailable', 'remote search source is unsupported', { retryable: false })
  }
}

function childSearchRequest(
  input: CoordinatorInput,
  source: SourceContinuation,
  cursor?: string,
): WireToolSearchRequest {
  const opts = input.request.opts ?? {}
  const childPrefix = childPrefixFor(source.path, opts.pathPrefix).pathPrefix
  return {
    query: input.request.query,
    opts: {
      ...(opts.effects === undefined ? {} : { effects: opts.effects }),
      ...(cursor === undefined ? {} : { cursor }),
      detail: 'compact',
      federation: 'recursive',
      limit: 1,
      matching: opts.matching ?? 'best',
      ...(opts.minCoverage === undefined ? {} : { minCoverage: opts.minCoverage }),
      mode: 'keyword',
      ...(childPrefix === undefined ? {} : { pathPrefix: childPrefix }),
    },
  }
}

async function throwChildSearchError(response: Response): Promise<never> {
  const error = await response.json().catch(() => null) as {
    code?: unknown
    message?: unknown
  } | null
  const message = typeof error?.message === 'string' ? error.message : ''
  if (message.includes('环')) {
    throw new TBError('unavailable', '检测到透传环', { retryable: false })
  }
  if (message.includes('跳数')) {
    throw new TBError('unavailable', '透传跳数超限', { retryable: false })
  }
  if (response.status >= 400 && response.status < 500) throw invalidContinuation()
  throw new TBError('unavailable', 'remote search unavailable', {
    retryable: response.status >= 500,
  })
}

async function fetchHead(
  deps: TbAppDeps,
  input: CoordinatorInput,
  source: SourceContinuation,
  remoteNodes: ReadonlyMap<TreePath, TreeNode>,
  deadline: number,
  expiresAt: number,
  totalTermCount: number,
  skipBudget = 20,
): Promise<{ statuses: WireToolSearchSourceResult[] }> {
  if (source.done || source.pending !== undefined) return { statuses: [] }
  const opts = input.request.opts ?? {}
  if (source.kind === 'local') {
    const page = await executeLocalSearch(
      {
        ctx: input.ctx,
        search: input.search,
        state: input.state,
      },
      {
        query: input.request.query,
        opts: {
          ...(opts.effects === undefined ? {} : { effects: opts.effects }),
          ...(source.cursor === undefined ? {} : { cursor: source.cursor }),
          detail: 'compact',
          federation: 'local',
          limit: 1,
          matching: opts.matching ?? 'best',
          ...(opts.minCoverage === undefined ? {} : { minCoverage: opts.minCoverage }),
          mode: 'keyword',
          ...(opts.pathPrefix === undefined ? {} : { pathPrefix: opts.pathPrefix }),
        },
      },
    )
    const item = page.items[0]
    if (item === undefined) {
      source.done = page.cursor === undefined
      source.cursor = page.cursor
      return { statuses: [] }
    }
    source.pending = compactItem({ ...item, source: { path: '' } })
    source.nextCursor = page.cursor
    return { statuses: [] }
  }

  const node = remoteNodes.get(source.path)
  if (
    node === undefined
    || node.config?.kind !== 'remote'
    || !check(input.ctx, node.path, 'read').allow
    || !check(input.ctx, node.path, 'call').allow
  ) {
    throw invalidContinuation()
  }
  const settings = federatedSearchSettings(deps.remote)
  const remainingMs = deadline - Date.now() - settings.perHopReturnReserveMs
  if (remainingMs < settings.minChildWorkMs) {
    throw new TBError('unavailable', 'federated search child has no remaining work budget', {
      retryable: false,
    })
  }
  const headers = federatedHeaders(
    input.headers,
    remainingMs,
    source.budget,
    expiresAt - Date.now(),
  )
  const childRequest = childSearchRequest(input, source, source.cursor)
  const response = await remoteResponse(
    deps,
    input,
    node,
    `${node.path}/~search`,
    'POST',
    headers,
    deadline,
    JSON.stringify(childRequest),
  )
  if (!response.ok) await throwChildSearchError(response)
  const parsed = toolSearchPageSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) {
    throw new TBError('unavailable', 'remote search returned invalid JSON', { retryable: false })
  }
  if (parsed.data.items.length > 1) {
    throw new TBError('unavailable', 'remote search exceeded the requested source batch size', {
      retryable: false,
    })
  }
  if (!isFederatedSearchSessionHandle(parsed.data.snapshot)) {
    throw new TBError('unavailable', 'remote search omitted its validation snapshot', {
      retryable: false,
    })
  }
  source.validationCursor = parsed.data.snapshot
  const page = projectChildPage(
    source.path,
    parsed.data,
    totalTermCount,
    input.ctx,
    input.request,
  )
  const item = page.items[0]
  if (item === undefined) {
    source.done = page.cursor === undefined
    source.cursor = page.cursor
    if (!source.done) {
      if (skipBudget <= 1) {
        throw new TBError('unavailable', 'federated search source work budget exhausted', {
          retryable: false,
        })
      }
      return await fetchHead(
        deps,
        input,
        source,
        remoteNodes,
        deadline,
        expiresAt,
        totalTermCount,
        skipBudget - 1,
      )
    }
  } else {
    source.pending = item
    source.nextCursor = page.cursor
  }
  return { statuses: page.sources?.filter(status => status.status !== 'ok') ?? [] }
}

async function validateSourceSnapshots(
  deps: TbAppDeps,
  input: CoordinatorInput,
  sources: readonly SourceContinuation[],
  remoteNodes: ReadonlyMap<TreePath, TreeNode>,
  deadline: number,
  expiresAt: number,
  maxConcurrency: number,
): Promise<void> {
  const remotes = sources.filter(source => source.kind === 'remote' && source.excluded !== true)
  await mapLimit(remotes, maxConcurrency, async (source) => {
    const node = remoteNodes.get(source.path)
    if (node === undefined || source.validationCursor === undefined) throw invalidContinuation()
    const settings = federatedSearchSettings(deps.remote)
    const remainingMs = deadline - Date.now() - settings.perHopReturnReserveMs
    if (remainingMs < settings.minChildWorkMs) throw retryableContinuationError()
    const headers = federatedHeaders(
      input.headers,
      remainingMs,
      source.budget,
      expiresAt - Date.now(),
    )
    headers.set(HEADER_VALIDATE_SNAPSHOT, '1')
    const response = await remoteResponse(
      deps,
      input,
      node,
      `${node.path}/~search`,
      'POST',
      headers,
      deadline,
      JSON.stringify(childSearchRequest(input, source, source.validationCursor)),
    )
    if (!response.ok) await throwChildSearchError(response)
    const parsed = toolSearchPageSchema.safeParse(await response.json().catch(() => null))
    if (
      !parsed.success
      || parsed.data.items.length !== 0
      || parsed.data.cursor !== undefined
      || parsed.data.snapshot !== undefined
      || parsed.data.partial !== undefined
      || parsed.data.sources !== undefined
    ) throw invalidContinuation()
  })
}

function consume(source: SourceContinuation): WireToolSearchItem {
  const item = source.pending
  if (item === undefined) throw new Error('federated source has no pending item')
  source.pending = undefined
  source.cursor = source.nextCursor
  source.nextCursor = undefined
  source.done = source.cursor === undefined
  return item
}

async function hydrateLocal(
  input: CoordinatorInput,
  item: WireToolSearchItem,
): Promise<WireToolSearchItem> {
  if (!check(input.ctx, item.path, 'read').allow || !check(input.ctx, item.path, 'call').allow) {
    throw invalidContinuation()
  }
  const registry = new NodeRegistryStore(input.state)
  const node = await registry.get(item.path).catch(() => null)
  if (
    node === null
    || (node.kind !== 'mcp' && node.kind !== 'http' && node.kind !== 'tool')
    || node.config?.kind !== node.kind
  ) {
    throw invalidContinuation()
  }
  const raw = (await canonicalSearchTools(input.state, [node])).get(node.path)
  if (raw === undefined) throw invalidContinuation()
  const matches = virtualizeTools(node.virtualize, raw).exposed
    .filter(tool => tool.name === item.tool.name)
  if (matches.length !== 1) throw invalidContinuation()
  const tool = matches[0]
  if (tool === undefined) throw invalidContinuation()
  return { ...item, tool }
}

async function hydrateRemote(
  deps: TbAppDeps,
  input: CoordinatorInput,
  item: WireToolSearchItem,
  source: SourceContinuation,
  node: TreeNode,
  deadline: number,
): Promise<WireToolSearchItem> {
  if (
    !check(input.ctx, source.path, 'read').allow
    || !check(input.ctx, source.path, 'call').allow
    || !check(input.ctx, item.path, 'read').allow
    || !check(input.ctx, item.path, 'call').allow
  ) {
    throw invalidContinuation()
  }
  const response = await remoteResponse(
    deps,
    input,
    node,
    `${item.path}/${item.tool.name}/~help`,
    'GET',
    (() => {
      const headers = new Headers({ accept: 'application/json' })
      const via = input.headers.get(HEADER_VIA)
      if (via !== null) headers.set(HEADER_VIA, via)
      headers.set(
        HEADER_REMAINING_MS,
        String(Math.max(1, Math.floor(deadline - Date.now()))),
      )
      return headers
    })(),
    deadline,
  )
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) throw invalidContinuation()
    throw retryableContinuationError()
  }
  const parsed = helpJsonSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw invalidContinuation()
  const projected = new RemotePathProjector(source.path)
    .projectHelp(parsed.data, `${item.path}/${item.tool.name}`)
  const commands = projected.cmds.filter(cmd =>
    cmd.name === item.tool.name
    && cmd.path === `/${item.path}/${item.tool.name}`
    && cmd.scope === 'call')
  if (commands.length !== 1) throw invalidContinuation()
  const command = commands[0]
  if (command === undefined) throw invalidContinuation()
  const tool: ToolSpec = {
    name: command.name,
    ...(command.h === undefined ? {} : { description: command.h }),
    ...(command.effect === undefined ? {} : { effect: command.effect }),
    ...(command.confirm === undefined ? {} : { confirm: command.confirm }),
    ...(command.inputSchema === undefined ? {} : { inputSchema: command.inputSchema }),
    ...(command.outputSchema === undefined ? {} : { outputSchema: command.outputSchema }),
  }
  return { ...item, tool }
}

async function computePage(
  deps: TbAppDeps,
  input: CoordinatorInput,
  sources: SourceContinuation[],
  remoteNodes: ReadonlyMap<TreePath, TreeNode>,
  deadline: number,
  expiresAt: number,
  totalTermCount: number,
  initial: boolean,
  initialExcluded: readonly WireToolSearchSourceResult[],
  maxConcurrency: number,
): Promise<FederatedPageState> {
  let excluded = [...initialExcluded]
  if (!initial) {
    await validateSourceSnapshots(
      deps,
      input,
      sources,
      remoteNodes,
      deadline,
      expiresAt,
      maxConcurrency,
    )
  }
  const active = sources.filter(source => !source.done)
  const capabilityFailures = await mapLimit(
    initial ? active.filter(source => source.kind === 'remote') : [],
    maxConcurrency,
    async (source) => {
      const node = remoteNodes.get(source.path)
      if (node === undefined) return { source, status: 'invalid_response' as const }
      const settings = federatedSearchSettings(deps.remote)
      const remainingMs = deadline - Date.now() - settings.perHopReturnReserveMs
      if (remainingMs < settings.minChildWorkMs) {
        return { source, status: 'budget_exhausted' as const }
      }
      const headers = federatedHeaders(
        input.headers,
        remainingMs,
        source.budget,
        expiresAt - Date.now(),
      )
      try {
        await assertFederatedCapability(deps, input, node, headers, deadline)
        return null
      } catch (error) {
        const status = error instanceof TBError && error.message.includes('unsupported')
          ? 'unsupported' as const
          : controlledStatus(error)
        return { error, source, status }
      }
    },
  )
  for (const failure of capabilityFailures) {
    if (failure === null) continue
    if (!initial) {
      if (failure.error instanceof TBError && failure.error.code === 'invalid_argument') {
        throw failure.error
      }
      throw failure.status === 'unsupported'
        ? invalidContinuation()
        : retryableContinuationError()
    }
    failure.source.done = true
    failure.source.excluded = true
    excluded = mergeStatuses(excluded, [{ path: failure.source.path, status: failure.status }])
  }

  const storedPending = sources.filter(source => source.pending !== undefined)
  const refreshedStatuses = await mapLimit(storedPending, maxConcurrency, async (source) => {
    try {
      const pending = source.pending
      if (pending === undefined) throw invalidContinuation()
      const hydrated = source.kind === 'local'
        ? await hydrateLocal(input, pending)
        : await (async () => {
            const node = remoteNodes.get(source.path)
            if (node === undefined) throw invalidContinuation()
            return await hydrateRemote(deps, input, pending, source, node, deadline)
          })()
      if (!sameJson(compactItem(hydrated), pending)) throw invalidContinuation()
      return []
    } catch (error) {
      throw continuationSourceError(error)
    }
  })
  excluded = mergeStatuses(excluded, ...refreshedStatuses)

  let successfulSources = storedPending.length
  const headResults = await mapLimit(
    sources.filter(source => !source.done && source.pending === undefined),
    maxConcurrency,
    async (source) => {
      try {
        const result = await fetchHead(
          deps,
          input,
          source,
          remoteNodes,
          deadline,
          expiresAt,
          totalTermCount,
        )
        return { ...result, success: true }
      } catch (error) {
        if (!initial) throw continuationSourceError(error)
        source.done = true
        source.excluded = true
        return {
          statuses: [{ path: source.path, status: controlledStatus(error) }],
          success: false,
        }
      }
    },
  )
  successfulSources += headResults.filter(result => result.success).length
  excluded = mergeStatuses(excluded, ...headResults.map(result => result.statuses))

  const items: WireToolSearchItem[] = []
  let selectedCoverage: number | undefined
  const limit = input.request.opts?.limit ?? 10
  while (items.length < limit) {
    const heads = sources.filter(source => source.pending !== undefined)
    if (heads.length === 0) break
    const highest = Math.max(...heads.map(source => source.pending?.relevance.coverage ?? -1))
    selectedCoverage ??= highest
    if ((input.request.opts?.matching ?? 'best') === 'best' && highest !== selectedCoverage) break
    const bucket = heads.filter(source => source.pending?.relevance.coverage === highest)
      .sort((left, right) =>
        (left.balanceCoverage === highest ? left.balanceCount : 0)
        - (right.balanceCoverage === highest ? right.balanceCount : 0)
        || left.path.localeCompare(right.path))
    const source = bucket[0]
    if (source === undefined) break
    items.push(consume(source))
    if (source.balanceCoverage !== highest) {
      source.balanceCoverage = highest
      source.balanceCount = 0
    }
    source.balanceCount++
    try {
      const result = await fetchHead(
        deps,
        input,
        source,
        remoteNodes,
        deadline,
        expiresAt,
        totalTermCount,
      )
      excluded = mergeStatuses(excluded, result.statuses)
    } catch (error) {
      if (!initial) throw continuationSourceError(error)
      source.done = true
      source.excluded = true
      excluded = mergeStatuses(excluded, [{ path: source.path, status: controlledStatus(error) }])
    }
  }

  const partial = excluded.length > 0
  const page: WireToolSearchPage = {
    items,
    ...(partial ? { partial: true, sources: excluded } : {}),
  }
  return { excluded, page, sources, successfulSources }
}

function visibleSourceStatuses(
  ctx: CallContext,
  page: WireToolSearchPage,
): WireToolSearchPage {
  const rawSources = page.sources
  const rest = { ...page }
  delete rest.partial
  delete rest.sources
  const sources = rawSources?.filter(source =>
    check(ctx, source.path, 'read').allow && check(ctx, source.path, 'call').allow)
  const partial = sources?.some(source => source.status !== 'ok') === true
  return {
    ...rest,
    ...(partial ? { partial: true } : {}),
    ...(sources === undefined || sources.length === 0 ? {} : { sources }),
  }
}

async function hydratePage(
  deps: TbAppDeps,
  input: CoordinatorInput,
  page: WireToolSearchPage,
  sources: readonly SourceContinuation[],
  remoteNodes: ReadonlyMap<TreePath, TreeNode>,
  deadline: number,
  forceRevalidate = false,
): Promise<WireToolSearchPage> {
  const visiblePage = visibleSourceStatuses(input.ctx, page)
  const detail = input.request.opts?.detail ?? 'compact'
  if (detail !== 'full' && !forceRevalidate) return visiblePage

  const constraints = requestConstraints(input.request)
  const output: WireToolSearchItem[] = []
  const encoder = new TextEncoder()
  let outputBytes = encoder.encode(JSON.stringify({ ...visiblePage, items: [] })).length
  const concurrency = federatedSearchSettings(deps.remote).maxConcurrency
  for (let offset = 0; offset < visiblePage.items.length; offset += concurrency) {
    const batch = visiblePage.items.slice(offset, offset + concurrency)
    const hydrated = await Promise.all(batch.map(async (item) => {
      const direct = sources.find(source =>
        source.kind === 'remote' && isPrefix(source.path, item.path))
      const full = direct === undefined
        ? await hydrateLocal(input, item)
        : await (async () => {
            const node = remoteNodes.get(direct.path)
            if (node === undefined) throw invalidContinuation()
            return await hydrateRemote(deps, input, item, direct, node, deadline)
          })()
      if (!sameJson(compactItem(full), compactItem(item))) throw invalidContinuation()
      assertHardResultConstraints(full, constraints)
      return full
    }))
    if (detail !== 'full') continue
    for (const item of hydrated) {
      outputBytes += encoder.encode(JSON.stringify(item)).length
      if (outputBytes > TOOL_SEARCH_PAGE_BYTES) {
        throw new TBError('rate_limited', 'federated search page exceeds response byte budget', {
          retryable: false,
        })
      }
      output.push(item)
    }
  }
  return detail === 'full' ? { ...visiblePage, items: output } : visiblePage
}

function pageWithCursor(page: WireToolSearchPage, cursor: string | undefined): WireToolSearchPage {
  return cursor === undefined ? page : { ...page, cursor }
}

function assertPageBytes(page: WireToolSearchPage): void {
  if (new TextEncoder().encode(JSON.stringify(page)).length > TOOL_SEARCH_PAGE_BYTES) {
    throw new TBError('rate_limited', 'federated search page exceeds response byte budget', {
      retryable: false,
    })
  }
}

export async function executeFederatedSearch(
  deps: TbAppDeps,
  input: CoordinatorInput,
): Promise<WireToolSearchPage> {
  if (deps.remote.instanceId === undefined || input.state.compareAndSwap === undefined) {
    throw new TBError(
      'invalid_argument',
      'recursive search requires explicit TB_INSTANCE_ID and atomic StateStore CAS',
    )
  }
  if ((input.request.opts?.mode ?? 'keyword') !== 'keyword') {
    throw new TBError('invalid_argument', 'semantic search cannot use recursive federation')
  }
  const wireOpts = input.request.opts ?? {}
  const constraints = normalizeToolSearchOptions({
    ...(wireOpts.effects === undefined ? {} : { effects: wireOpts.effects }),
    matching: wireOpts.matching ?? 'best',
    ...(wireOpts.minCoverage === undefined ? {} : { minCoverage: wireOpts.minCoverage }),
    ...(wireOpts.pathPrefix === undefined ? {} : { pathPrefix: wireOpts.pathPrefix }),
  })
  input = {
    ...input,
    request: {
      query: input.request.query,
      opts: {
        ...wireOpts,
        ...(constraints.effects === undefined ? {} : { effects: constraints.effects }),
        matching: constraints.matching,
        ...(constraints.minCoverage === undefined
          ? {}
          : { minCoverage: constraints.minCoverage }),
        ...(constraints.pathPrefix === undefined
          ? {}
          : { pathPrefix: constraints.pathPrefix }),
      },
    },
  }
  const viaError = checkVia(
    parseVia(input.headers.get(HEADER_VIA) ?? undefined),
    deps.remote.instanceId,
    deps.remote.maxHops,
  )
  if (viaError !== null) throw viaError

  const settings = federatedSearchSettings(deps.remote)
  await input.searchSync?.ensureReady()
  if (input.search.revision === undefined) {
    throw new TBError('invalid_argument', 'recursive search requires a revisioned search index')
  }
  const localRevision = await input.search.revision()
  const deadlineMs = clampHeader(input.headers.get(HEADER_REMAINING_MS), settings.totalDeadlineMs)
  const sessionTtlMs = clampHeader(input.headers.get(HEADER_SESSION_TTL_MS), settings.sessionTtlMs)
  const sourceBudget = clampHeader(input.headers.get(HEADER_SOURCE_BUDGET), settings.maxSources)
  const deadline = Date.now() + deadlineMs
  const expiresAtMs = Date.now() + sessionTtlMs
  const limit = input.request.opts?.limit ?? 10
  const requestDigest = await sha256Hex(canonicalJson({
    authorization: input.ctx.scopes,
    request: requestForDigest(input.request, limit),
  }))
  const sessionStore = new FederatedSearchSessionStore(input.state)
  const plan = prepareToolSearchQuery(input.request.query)
  const registry = new NodeRegistryStore(input.state)
  const snapshot = await registry.rootSnapshot(TOOL_SEARCH_AUDIT_NODE_LIMIT)
  const allDirect = directRemoteNodes(snapshot.items)
  const eligibleRemotes = allDirect.filter((node) => {
    const relation = childPrefixFor(node.path, input.request.opts?.pathPrefix)
    return relation.eligible
      && check(input.ctx, node.path, 'read').allow
      && check(input.ctx, node.path, 'call').allow
  })
  const includeLocal = localEligible(allDirect, input.request.opts?.pathPrefix)
  const configuredRemotes = eligibleRemotes.filter(node =>
    node.config?.kind === 'remote' && node.config.skRef !== undefined)
  const secretAvailability = await mapLimit(
    configuredRemotes,
    settings.maxConcurrency,
    async (node) => {
      if (node.config?.kind !== 'remote' || node.config.skRef === undefined) return false
      try {
        return await deps.secrets.resolve(node.config.skRef) !== undefined
      } catch {
        return false
      }
    },
  )
  const participatingRemotes = configuredRemotes.filter((_node, index) =>
    secretAvailability[index] === true)
  const unavailableRemotes = configuredRemotes.filter((_node, index) =>
    secretAvailability[index] !== true)
  const transportSettings = await resolveRemoteSettings(input.state, deps.remote)
  const topologyNodes = snapshot.items.filter(node =>
    check(input.ctx, node.path, 'read').allow && check(input.ctx, node.path, 'call').allow)
  const digest = await topologyDigest(topologyNodes, includeLocal, localRevision, {
    allowInsecure: transportSettings.allowInsecure,
    allowlist: [...transportSettings.allowlist].sort(),
    availableRemotes: participatingRemotes.map(node => node.path),
    instanceId: transportSettings.instanceId ?? null,
    maxHops: transportSettings.maxHops,
  })
  const remoteNodes = new Map(participatingRemotes.map(node => [node.path, node]))

  const cursor = input.request.opts?.cursor
  if (cursor !== undefined) {
    const current = await sessionStore.read<
      WireToolSearchPage,
      SourceContinuation[],
      WireToolSearchSourceResult[],
      FederationPolicy
    >(cursor, { actorKeyId: input.ctx.keyId, requestDigest })
    if (current.topologyDigest !== digest || current.rankingVersion !== TOOL_SEARCH_RANKING_VERSION) {
      throw invalidContinuation()
    }
    if (input.headers.get(HEADER_VALIDATE_SNAPSHOT) === '1') {
      await validateSourceSnapshots(
        deps,
        input,
        current.sourceContinuations,
        remoteNodes,
        deadline,
        Date.parse(current.expiresAt),
        settings.maxConcurrency,
      )
      return { items: [] }
    }
    if (current.nextHandle === null) throw invalidContinuation()
    let next: SessionRecord | undefined
    try {
      next = await sessionStore.read(current.nextHandle, {
        actorKeyId: input.ctx.keyId,
        requestDigest,
      }) as SessionRecord
    } catch (error) {
      if (!(error instanceof TBError) || error.code !== 'invalid_argument') throw error
    }
    if (next !== undefined) assertNextRecord(current, next, digest)
    const cachedNext = next !== undefined
    if (next === undefined) {
      const state = await computePage(
        deps,
        input,
        structuredClone(current.sourceContinuations),
        remoteNodes,
        deadline,
        Date.parse(current.expiresAt),
        plan.totalTermCount,
        false,
        current.excludedStatuses,
        settings.maxConcurrency,
      )
      const hasMore = responseHasMore(state.sources)
      const nextNextHandle = hasMore ? sessionStore.issueHandle() : null
      next = await sessionStore.create(current.nextHandle, {
        actorKeyId: input.ctx.keyId,
        excludedStatuses: state.excluded,
        expiresAt: current.expiresAt,
        federationPolicy: current.federationPolicy,
        generation: current.generation + 1,
        nextHandle: nextNextHandle,
        page: state.page,
        rankingVersion: TOOL_SEARCH_RANKING_VERSION,
        requestDigest,
        sessionId: current.sessionId,
        sourceContinuations: serializableSources(state.sources),
        topologyDigest: digest,
      })
      assertNextRecord(current, next, digest)
      assertCachedPage(state, next)
    }
    if (cachedNext) {
      await validateSourceSnapshots(
        deps,
        input,
        next.sourceContinuations,
        remoteNodes,
        deadline,
        Date.parse(next.expiresAt),
        settings.maxConcurrency,
      )
    }
    const wantsSnapshot = input.headers.get(HEADER_WANT_SNAPSHOT) === '1'
    const responsePage = {
      ...pageWithCursor(
        next.page,
        next.nextHandle === null ? undefined : current.nextHandle,
      ),
      ...(wantsSnapshot ? { snapshot: current.nextHandle } : {}),
    }
    const response = await hydratePage(
      deps,
      input,
      responsePage,
      next.sourceContinuations,
      remoteNodes,
      deadline,
      cachedNext,
    )
    assertPageBytes(response)
    return response
  }

  const initialExcluded: WireToolSearchSourceResult[] = eligibleRemotes
    .filter(node => node.config?.kind === 'remote' && node.config.skRef === undefined)
    .map(node => ({ path: node.path, status: 'unsupported' }))
  initialExcluded.push(...unavailableRemotes.map(node => ({
    path: node.path,
    status: 'unavailable' as const,
  })))
  const availableRemoteSlots = Math.max(0, sourceBudget - (includeLocal ? 1 : 0))
  const selectedRemotes = participatingRemotes.slice(0, availableRemoteSlots)
  for (const node of participatingRemotes.slice(availableRemoteSlots)) {
    initialExcluded.push({ path: node.path, status: 'budget_exhausted' })
  }
  if (snapshot.truncated) initialExcluded.push({ path: '', status: 'budget_exhausted' })
  const allocations = selectedRemotes.map((_node, index) => {
    const base = selectedRemotes.length === 0 ? 0 : Math.floor(availableRemoteSlots / selectedRemotes.length)
    const extra = index < (availableRemoteSlots % Math.max(1, selectedRemotes.length)) ? 1 : 0
    return Math.max(1, base + extra)
  })
  const sources: SourceContinuation[] = [
    ...(includeLocal
      ? [{ balanceCount: 0, budget: 1, done: false, kind: 'local' as const, path: '' as TreePath }]
      : []),
    ...selectedRemotes.map((node, index) => ({
      balanceCount: 0,
      budget: allocations[index] ?? 1,
      done: false,
      kind: 'remote' as const,
      path: node.path,
    })),
  ]
  const state = await computePage(
    deps,
    input,
    sources,
    remoteNodes,
    deadline,
    expiresAtMs,
    plan.totalTermCount,
    true,
    initialExcluded,
    settings.maxConcurrency,
  )
  const candidateSourceCount = (includeLocal ? 1 : 0) + eligibleRemotes.length
  if (
    candidateSourceCount > 0
    && state.successfulSources === 0
    && state.page.items.length === 0
  ) {
    throw new TBError('unavailable', 'all federated search sources failed', { retryable: true })
  }
  const hasMore = responseHasMore(state.sources)
  const wantsSnapshot = input.headers.get(HEADER_WANT_SNAPSHOT) === '1'
  const needsSession = hasMore || wantsSnapshot
  const sessionHandle = needsSession ? sessionStore.issueHandle() : undefined
  const responseCursor = hasMore ? sessionHandle : undefined
  const nextHandle = hasMore ? sessionStore.issueHandle() : null
  const responsePage = {
    ...pageWithCursor(state.page, responseCursor),
    ...(wantsSnapshot && sessionHandle !== undefined ? { snapshot: sessionHandle } : {}),
  }
  const response = await hydratePage(
    deps,
    input,
    responsePage,
    state.sources,
    remoteNodes,
    deadline,
  )
  assertPageBytes(response)
  if (sessionHandle !== undefined) {
    await sessionStore.create(sessionHandle, {
      actorKeyId: input.ctx.keyId,
      excludedStatuses: state.excluded,
      expiresAt: new Date(expiresAtMs).toISOString(),
      federationPolicy: { limit, matching: input.request.opts?.matching ?? 'best' },
      generation: 0,
      nextHandle,
      page: state.page,
      rankingVersion: TOOL_SEARCH_RANKING_VERSION,
      requestDigest,
      sourceContinuations: serializableSources(state.sources),
      topologyDigest: digest,
    })
  }
  return response
}
