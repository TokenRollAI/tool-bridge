import { describe, expect, it } from 'vitest'
import {
  resolveToolSearchOptions,
  toolSearchQueryKey,
} from '../src/lib/toolSearch'

describe('Dashboard tool search options', () => {
  it('defaults to a compact ten-result best-match page', () => {
    expect(resolveToolSearchOptions()).toEqual({
      detail: 'compact',
      limit: 10,
      matching: 'best',
      mode: 'keyword',
    })
  })

  it('preserves every wire search option in both the request snapshot and query key', () => {
    const options = resolveToolSearchOptions({
      detail: 'full',
      effects: ['read', 'destructive'],
      federation: 'local',
      limit: 7,
      matching: 'all',
      minCoverage: 0.8,
      mode: 'semantic',
      pathPrefix: 'home/assistant',
    })
    expect(options).toEqual({
      detail: 'full',
      effects: ['read', 'destructive'],
      federation: 'local',
      limit: 7,
      matching: 'all',
      minCoverage: 0.8,
      mode: 'semantic',
      pathPrefix: 'home/assistant',
    })
    expect(toolSearchQueryKey(['tb', 'profile'], 'temperature', options)).toEqual([
      'tb',
      'profile',
      'tool-search',
      'temperature',
      options,
    ])
    expect(toolSearchQueryKey(['tb'], 'temperature', options)).not.toEqual(
      toolSearchQueryKey(['tb'], 'temperature', {
        ...options,
        minCoverage: 0.9,
      }),
    )
    expect(toolSearchQueryKey(['tb'], 'temperature', options)).not.toEqual(
      toolSearchQueryKey(['tb'], 'temperature', {
        ...options,
        federation: 'recursive',
      }),
    )
  })
})
