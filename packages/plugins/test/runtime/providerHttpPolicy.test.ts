import { describe, expect, it } from 'vitest'
import policy from '../../provider-http-exceptions.json'

type Category = 'binary' | 'form' | 'graphql' | 'mixed' | 'multipart' | 'signed' | 'stream'

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

function isProviderTransport(file: string): boolean {
  return /\/api(?:\/shared)?\.ts$/.test(file)
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

function directCallCount(source: string): number {
  return source.match(/\bguardedFetch\s*\(/g)?.length ?? 0
}

describe('provider HTTP architecture policy', () => {
  it('所有 raw guardedFetch provider 都逐项登记，新增普通 JSON REST 不能绕开 providerHttp', () => {
    const declared = (policy.exceptions as ExceptionEntry[])
      .map(entry => entry.file)
      .sort()
    const actual = Object.entries(SOURCES)
      .filter(([file, source]) => isProviderTransport(file) && importsDirectGuardedFetch(source))
      .map(([file]) => repositoryPath(file))
      .sort()

    expect(actual).toEqual(declared)
  })

  it('例外清单只允许明确协议类别，理由非空且 raw 调用数精确', () => {
    const categories = new Set<Category>([
      'binary',
      'form',
      'graphql',
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
