import { TOOL_SEARCH_AUDIT_NODE_LIMIT } from '@tool-bridge/core'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import Database from 'better-sqlite3'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifySearchIndexContract } from '../../core/test/search/searchIndex.fixture'
import { SqliteSearchIndex } from '../src/sqliteSearchIndex'
import { SqliteStateStore } from '../src/sqliteStateStore'

const cleanups: Array<() => void> = []

function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-search-sqlite-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return join(dir, 'state.sqlite3')
}

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

describe('SqliteSearchIndex', () => {
  it('caps indexed paths without limiting canonical state', async () => {
    const search = new SqliteSearchIndex(tmpDbPath())
    cleanups.push(() => search.close())
    await search.rebuild(Array.from({ length: TOOL_SEARCH_AUDIT_NODE_LIMIT }, (_, i) => ({
      path: `contract/sqlite/cap/${i}`,
      tool: { name: `cap_${i}` },
    })))
    await expect(search.replace('contract/sqlite/cap/overflow', [{ name: 'overflow' }]))
      .rejects.toMatchObject({ code: 'rate_limited' })
  })

  it('satisfies the shared contract beside SqliteStateStore and persists on reopen', async () => {
    const dbPath = tmpDbPath()
    const state = new SqliteStateStore(dbPath)
    const search = new SqliteSearchIndex(dbPath)
    await state.put('probe:key', { alive: true })

    await verifySearchIndexContract(search, 'contract/sqlite')
    expect(await state.get('probe:key')).toEqual({ alive: true })
    search.close()
    state.close()

    const reopenedState = new SqliteStateStore(dbPath)
    const reopenedSearch = new SqliteSearchIndex(dbPath)
    cleanups.push(() => reopenedSearch.close(), () => reopenedState.close())
    const reopenedCandidates = await reopenedSearch.search('rebuilt')
    await expect(reopenedSearch.hydrate(reopenedCandidates.items)).resolves.toMatchObject({
      hits: [{ path: 'contract/sqlite/alpha', tool: { name: 'rebuilt_tool' } }],
    })
    expect(await reopenedState.get('probe:key')).toEqual({ alive: true })
  })

  it('migrates legacy v1 rows once and does not resurrect a removed row on reopen', async () => {
    const dbPath = tmpDbPath()
    const legacy = new Database(dbPath)
    legacy.exec(`
      CREATE TABLE tb_search_tools (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tool_json TEXT NOT NULL,
        UNIQUE(path, name)
      )
    `)
    legacy.prepare(`
      INSERT INTO tb_search_tools(path, name, description, tool_json) VALUES (?, ?, ?, ?)
    `).run(
      'legacy/search',
      'legacy_probe',
      'legacymigrationprobe',
      JSON.stringify({ name: 'legacy_probe', description: 'legacymigrationprobe' }),
    )
    legacy.close()

    const migrated = new SqliteSearchIndex(dbPath)
    await expect(migrated.initialized()).resolves.toBe(false)
    const candidates = await migrated.search('legacymigrationprobe')
    expect((await migrated.hydrate(candidates.items)).hits).toHaveLength(1)
    await migrated.remove('legacy/search')
    migrated.close()

    const reopened = new SqliteSearchIndex(dbPath)
    cleanups.push(() => reopened.close())
    await expect(reopened.search('legacymigrationprobe')).resolves.toMatchObject({ items: [] })
  })
})
