import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

/**
 * Global Search 只读验收：用真实 `tb search` 在管理员与窄 SK 下查询
 * `日程` / `create document`，验证非空、结果子集与允许路径。
 *
 * 用法：
 * `TB_BASE_URL=https://... TB_SK=tbk_admin_... TB_SEARCH_NARROW_SK=tbk_... \
 *   TB_SEARCH_ALLOWED_PREFIX=search/visible pnpm verify:search`
 *
 * 脚本不创建、修改或删除任何网关资源；目标环境需预先准备能命中两个
 * 查询的可见/不可见夹具，并签发只允许 `TB_SEARCH_ALLOWED_PREFIX` 的窄 SK。
 */

interface SearchItem {
  path: string
  tool: { name: string }
}

interface SearchPage {
  cursor?: string
  items: SearchItem[]
}

interface SearchResult {
  items: SearchItem[]
  pages: number
}

interface CliResult {
  code: number | null
  stderr: string
  stdout: string
}

const CLI_TIMEOUT_MS = 60_000
const PAGE_LIMIT = 200
const PAGE_MAX = 20
const QUERIES = ['日程', 'create document'] as const
const CLI = fileURLToPath(new URL('../packages/cli/dist/index.js', import.meta.url))

function requireValue(value: string | undefined, message: string): string {
  if (value === undefined || value.trim() === '') throw new Error(message)
  return value.trim()
}

function runCli(args: string[], sk: string, target: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, TB_BASE_URL: target, TB_SK: sk },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += String(chunk)))
    child.stderr.on('data', chunk => (stderr += String(chunk)))
    const timer = setTimeout(() => child.kill('SIGKILL'), CLI_TIMEOUT_MS)
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stderr, stdout })
    })
  })
}

function assertSearchPage(value: unknown, label: string): asserts value is SearchPage {
  assert.ok(value !== null && typeof value === 'object', `${label} must return a JSON object`)
  const items = (value as { items?: unknown }).items
  assert.ok(Array.isArray(items), `${label}.items must be an array`)
  const cursor = (value as { cursor?: unknown }).cursor
  assert.ok(
    cursor === undefined || (typeof cursor === 'string' && cursor.length > 0),
    `${label}.cursor must be a non-empty string when present`,
  )
  for (const item of items) {
    assert.ok(item !== null && typeof item === 'object', `${label} item must be an object`)
    const candidate = item as { path?: unknown, tool?: { name?: unknown } }
    assert.equal(typeof candidate.path, 'string', `${label} item.path must be a string`)
    assert.equal(typeof candidate.tool?.name, 'string', `${label} item.tool.name must be a string`)
  }
}

async function searchPage(
  query: string,
  sk: string,
  label: string,
  target: string,
  cursor?: string,
): Promise<SearchPage> {
  const args = ['search', query, '--limit', String(PAGE_LIMIT)]
  if (cursor !== undefined) args.push('--cursor', cursor)
  const result = await runCli([...args, '--json'], sk, target)
  assert.equal(
    result.code,
    0,
    `${label} exited ${result.code}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  )
  const parsed = JSON.parse(result.stdout) as unknown
  assertSearchPage(parsed, label)
  return parsed
}

function identity(item: SearchItem): string {
  return JSON.stringify([item.path, item.tool.name])
}

function withinPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

async function searchAll(
  query: string,
  sk: string,
  label: string,
  target: string,
): Promise<SearchResult> {
  const items: SearchItem[] = []
  const seenCursors = new Set<string>()
  const seenItems = new Set<string>()
  let cursor: string | undefined
  for (let pageNumber = 1; pageNumber <= PAGE_MAX; pageNumber += 1) {
    const page = await searchPage(query, sk, `${label} page ${pageNumber}`, target, cursor)
    for (const item of page.items) {
      const key = identity(item)
      assert.ok(!seenItems.has(key), `${label} repeated result '${item.path}:${item.tool.name}'`)
      seenItems.add(key)
      items.push(item)
    }
    if (page.cursor === undefined) return { items, pages: pageNumber }
    assert.ok(!seenCursors.has(page.cursor), `${label} repeated cursor`)
    seenCursors.add(page.cursor)
    cursor = page.cursor
  }
  throw new Error(`${label} exceeded ${PAGE_MAX} pages (${PAGE_MAX * PAGE_LIMIT} items)`)
}

const baseUrl = requireValue(
  process.argv[2] ?? process.env.TB_BASE_URL,
  'missing base URL. Set TB_BASE_URL or pass it as argv[2].',
).replace(/\/+$/, '')
const adminSk = requireValue(
  process.env.TB_ADMIN_SK ?? process.env.TB_SK,
  'missing admin SK. Set TB_ADMIN_SK or TB_SK.',
)
const narrowSk = requireValue(
  process.env.TB_SEARCH_NARROW_SK,
  'missing narrow SK. Set TB_SEARCH_NARROW_SK.',
)
const allowedPrefix = requireValue(
  process.env.TB_SEARCH_ALLOWED_PREFIX,
  'missing allowed prefix. Set TB_SEARCH_ALLOWED_PREFIX.',
).replace(/^\/+|\/+$/g, '')
assert.notEqual(allowedPrefix, '', 'TB_SEARCH_ALLOWED_PREFIX must name a non-root path')

if (!existsSync(CLI)) {
  throw new Error(`CLI dist not found at ${CLI}. Run \`pnpm --filter @tool-bridge/cli build\`.`)
}

for (const query of QUERIES) {
  const admin = await searchAll(query, adminSk, `admin search ${JSON.stringify(query)}`, baseUrl)
  const narrow = await searchAll(query, narrowSk, `narrow search ${JSON.stringify(query)}`, baseUrl)
  assert.ok(admin.items.length > 0, `admin search ${JSON.stringify(query)} must be non-empty`)
  assert.ok(narrow.items.length > 0, `narrow search ${JSON.stringify(query)} must be non-empty`)
  assert.ok(
    narrow.items.length < admin.items.length,
    `narrow search ${JSON.stringify(query)} must strictly shrink admin results`,
  )

  const adminItems = new Set(admin.items.map(identity))
  for (const item of narrow.items) {
    assert.ok(
      withinPrefix(item.path, allowedPrefix),
      `narrow search exposed '${item.path}' outside '${allowedPrefix}'`,
    )
    assert.ok(
      adminItems.has(identity(item)),
      `narrow search exposed non-admin result '${item.path}:${item.tool.name}'`,
    )
  }
  assert.ok(
    admin.items.some(item => !withinPrefix(item.path, allowedPrefix)),
    `admin search ${JSON.stringify(query)} needs an outside-prefix control result`,
  )
  console.log(
    `ok  tb search ${JSON.stringify(query)}: admin ${admin.items.length}/${admin.pages}p`
    + ` → narrow ${narrow.items.length}/${narrow.pages}p; prefix ${allowedPrefix}`,
  )
}

console.log(`\nSearch smoke passed against ${baseUrl}`)
