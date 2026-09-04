import { describe, expect, it } from 'vitest'
import policy from '../../provider-http-exceptions.json'

type Category = 'binary' | 'form' | 'graphql' | 'mcp' | 'mixed' | 'multipart' | 'signed' | 'stream'

interface ExceptionEntry {
  category: Category
  file: string
  guardedFetchCalls: number
  reason: string
}

const SOURCES = import.meta.glob<string>('../../src/**/*.ts', {
  eager: true,
  import: 'default',
  query: '?raw',
})

function repositoryPath(globPath: string): string {
  return globPath.replace(/^\.\.\/\.\.\//, '')
}

/**
 * 策略覆盖 `src/<provider>/**` 全部源码,不按文件名猜哪些是 transport:曾经只匹配
 * `api.ts|api/shared.ts`,feishu 的 `tat.ts`/`feishuMcp.ts` 各自 `createGuardedFetch` 却从未
 * 进入例外表,测试始终全绿。`_runtime/` 是薄层本身;`registry*.ts`/`catalog.generated.ts`
 * 是装配与生成物,均不是 provider 出站代码。
 */
function isProviderSource(file: string): boolean {
  const path = repositoryPath(file)
  if (!path.startsWith('src/')) return false
  if (path.startsWith('src/_runtime/')) return false
  return !/^src\/(?:registry(?:\.generated)?|catalog\.generated)\.ts$/.test(path)
}

function importsDirectGuardedFetch(source: string): boolean {
  if (/import\s*\(\s*['"][^'"]*\/_runtime\/guardedFetch['"]\s*\)/s.test(source)) return true
  const imports = source.matchAll(
    /import\s+(\*\s+as\s+\w+|\{([^}]*)\})\s*from\s*['"][^'"]*\/_runtime\/guardedFetch['"]/gs,
  )
  for (const match of imports) {
    if (match[1]?.startsWith('*')) return true
    const specifiers = match[2]?.split(',') ?? []
    if (specifiers.some(specifier => /^(?:type\s+)?(?:createGuardedFetch|guardedFetch)\b/.test(specifier.trim()))) {
      return true
    }
  }
  return false
}

/**
 * raw 出站点数 = 共享 `guardedFetch(` 直调 + `createGuardedFetch(` 工厂实例化。工厂返回的
 * 本地 fetch 之后可被任意次调用,因此按"建了几个绕过 providerHttp 的 transport"计数,
 * 而不是追踪其调用点;两种形态都要在例外表精确登记。
 */
function directCallCount(source: string): number {
  const shared = source.match(/(?<![\w$.])guardedFetch\s*\(/g)?.length ?? 0
  const factories = source.match(/\bcreateGuardedFetch\s*\(/g)?.length ?? 0
  return shared + factories
}

describe('provider HTTP architecture policy', () => {
  it('所有 raw guardedFetch/createGuardedFetch provider 源文件都逐项登记，新增普通 JSON REST 不能绕开 providerHttp', () => {
    const declared = (policy.exceptions as ExceptionEntry[])
      .map(entry => entry.file)
      .sort()
    const actual = Object.entries(SOURCES)
      .filter(([file, source]) => isProviderSource(file) && importsDirectGuardedFetch(source))
      .map(([file]) => repositoryPath(file))
      .sort()

    expect(actual).toEqual(declared)
  })

  it('策略范围覆盖 provider 目录下任意文件名，而不只是 api.ts', () => {
    // 回归:曾因只匹配 api.ts 漏掉 feishu/tat.ts 与 feishu/feishuMcp.ts。
    expect(isProviderSource('../../src/feishu/tat.ts')).toBe(true)
    expect(isProviderSource('../../src/feishu/feishuMcp.ts')).toBe(true)
    expect(isProviderSource('../../src/github/api/pull-request.ts')).toBe(true)
    expect(isProviderSource('../../src/_runtime/providerHttp.ts')).toBe(false)
    expect(isProviderSource('../../src/registry.ts')).toBe(false)
    expect(isProviderSource('../../src/registry.generated.ts')).toBe(false)
    expect(isProviderSource('../../src/catalog.generated.ts')).toBe(false)
    expect(directCallCount('const f = createGuardedFetch({ crossOriginRedirect: \'error\' }); await f(u)')).toBe(1)
    expect(directCallCount('await guardedFetch(u); await guardedFetch(v)')).toBe(2)
    // 工厂返回值的本地名被调用不重复计数;成员访问不算共享实例直调。
    expect(directCallCount('const feishuMcpFetch = createGuardedFetch(); feishuMcpFetch(u); client.guardedFetch(x)')).toBe(1)
  })

  it('例外清单只允许明确协议类别，理由非空且 raw 调用数精确', () => {
    const categories = new Set<Category>([
      'binary',
      'form',
      'graphql',
      'mcp',
      'mixed',
      'multipart',
      'signed',
      'stream',
    ])
    const entries = policy.exceptions as ExceptionEntry[]
    expect(new Set(entries.map(entry => entry.file)).size).toBe(entries.length)

    for (const entry of entries) {
      expect(categories.has(entry.category), entry.file).toBe(true)
      expect(entry.reason.trim().length, entry.file).toBeGreaterThan(20)
      expect(entry.guardedFetchCalls, entry.file).toBeGreaterThan(0)

      const source = SOURCES[`../../${entry.file}`]
      expect(source, `${entry.file} 不存在`).toBeDefined()
      expect(directCallCount(source!), `${entry.file} 的 raw 调用数漂移`).toBe(entry.guardedFetchCalls)
    }
  })
})
