/** D1Database 与请求级 D1DatabaseSession 共有的查询面。 */
export interface D1Executor {
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>>
  prepare(query: string): D1PreparedStatement
}

export type D1QuerySource = 'search' | 'state'

/** 单个请求内的 D1 统计；只记录性能元数据，不记录 SQL、参数、key 或返回值。 */
export class D1RequestMetrics {
  private calls = 0
  private primaryCalls = 0
  private replicaCalls = 0
  private rowsRead = 0
  private rowsWritten = 0
  private sqlDurationMs = 0
  private readonly regions = new Set<string>()
  private searchCalls = 0
  private stateCalls = 0
  private waitDurationMs = 0

  async measure<T extends D1Result | D1Result[]>(
    source: D1QuerySource,
    query: () => Promise<T>,
  ): Promise<T> {
    const started = performance.now()
    let result: T
    try {
      result = await query()
    } catch (error) {
      this.waitDurationMs += performance.now() - started
      throw error
    }
    this.waitDurationMs += performance.now() - started
    const results = Array.isArray(result) ? result : [result]
    this.calls += results.length
    if (source === 'state') this.stateCalls += results.length
    else this.searchCalls += results.length
    for (const item of results) {
      const meta = item.meta
      this.rowsRead += meta.rows_read
      this.rowsWritten += meta.rows_written
      this.sqlDurationMs += meta.timings?.sql_duration_ms ?? meta.duration
      if (meta.served_by_primary === true) this.primaryCalls++
      else if (meta.served_by_primary === false) this.replicaCalls++
      if (meta.served_by_region !== undefined) this.regions.add(meta.served_by_region)
    }
    return result
  }

  serverTiming(): string | undefined {
    if (this.calls === 0) return undefined
    return `tb-d1;dur=${this.waitDurationMs.toFixed(1)}`
  }

  snapshot(): Record<string, unknown> {
    return {
      calls: this.calls,
      primaryCalls: this.primaryCalls,
      regions: [...this.regions].sort(),
      replicaCalls: this.replicaCalls,
      rowsRead: this.rowsRead,
      rowsWritten: this.rowsWritten,
      searchCalls: this.searchCalls,
      sqlDurationMs: Number(this.sqlDurationMs.toFixed(1)),
      stateCalls: this.stateCalls,
      waitDurationMs: Number(this.waitDurationMs.toFixed(1)),
    }
  }
}

/** schema 初始化的 isolate 级 gate；失败后清空，允许下一请求重试。 */
export class D1SchemaGate {
  private ready: Promise<void> | undefined

  constructor(private readonly initialize: () => Promise<void>) {}

  ensure(): Promise<void> {
    this.ready ??= this.initialize().catch((error: unknown) => {
      this.ready = undefined
      throw error
    })
    return this.ready
  }
}

export async function measuredD1<T extends D1Result | D1Result[]>(
  metrics: D1RequestMetrics | undefined,
  source: D1QuerySource,
  query: () => Promise<T>,
): Promise<T> {
  return metrics === undefined ? await query() : await metrics.measure(source, query)
}
