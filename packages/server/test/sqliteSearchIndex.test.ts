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
    expect(reopenedCandidates).toMatchObject({
      items: [{ path: 'contract/sqlite/alpha', name: 'rebuilt_tool' }],
    })
    expect(await reopenedState.get('probe:key')).toEqual({ alive: true })
  })

  it('leaves v3 rows orphaned and seeds v4 only from canonical rebuild input', async () => {
    const dbPath = tmpDbPath()
    const legacy = new Database(dbPath)
    legacy.exec(`
      CREATE TABLE tb_search_tools_v3 (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        feedback TEXT NOT NULL DEFAULT '',
        UNIQUE(path, name)
      )
    `)
    legacy.prepare(`
      INSERT INTO tb_search_tools_v3(path, name, description, feedback) VALUES (?, ?, ?, ?)
    `).run(
      'legacy/search',
      'legacy_probe',
      'legacymigrationprobe',
      '',
    )
    legacy.close()

    const migrated = new SqliteSearchIndex(dbPath)
    await expect(migrated.initialized()).resolves.toBe(false)
    await expect(migrated.search('legacymigrationprobe')).resolves.toMatchObject({ items: [] })
    await migrated.rebuild([{
      path: 'legacy/search',
      tool: { name: 'legacy_probe', description: 'legacymigrationprobe' },
    }])
    await expect(migrated.search('legacymigrationprobe')).resolves.toMatchObject({
      items: [{ path: 'legacy/search', name: 'legacy_probe' }],
    })
    await migrated.remove('legacy/search')
    migrated.close()

    const orphan = new Database(dbPath, { readonly: true })
    expect(orphan.prepare('SELECT COUNT(*) AS count FROM tb_search_tools_v3').get())
      .toEqual({ count: 1 })
    orphan.close()

    const reopened = new SqliteSearchIndex(dbPath)
    cleanups.push(() => reopened.close())
    await expect(reopened.search('legacymigrationprobe')).resolves.toMatchObject({ items: [] })
  })
})
