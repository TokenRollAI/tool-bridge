import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
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
    await expect(reopenedSearch.search('rebuilt')).resolves.toMatchObject({
      items: [{ path: 'contract/sqlite/alpha', tool: { name: 'rebuilt_tool' } }],
    })
    expect(await reopenedState.get('probe:key')).toEqual({ alive: true })
  })
})
