import { describe, expect, expectTypeOf, it } from 'vitest'
import type { ToolSpec } from '../../src/tool/types'
import {
  actionSchema,
  feedbackDetailSchema,
  feedbackViewSchema,
  fixedControlPlaneOpenApi,
  healthResponseSchema,
  helpJsonSchema,
  nodeKindSchema,
  oauthAuthorizeResponseSchema,
  readinessResponseSchema,
  registryNodeSchema,
  tbErrorBodySchema,
  tbErrorCodeSchema,
  toolSearchPageSchema,
  toolSearchRequestSchema,
  treeJsonSchema,
  type WireAction,
  type WireNodeKind,
  type WirePage,
  type WireTBErrorBody,
  type WireTBErrorCode,
  type WireToolSearchDetail,
  type WireToolSearchEffect,
  type WireToolSearchFederation,
  type WireToolSearchItem,
  type WireToolSearchMatching,
  type WireToolSearchPage,
  type WireToolSearchRelevance,
  type WireToolSearchRequest,
  type WireToolSearchSource,
  type WireToolSearchSourceResult,
  type WireToolSearchSourceStatus,
  type WireToolSpec,
} from '../../src/protocol/public'
import {
  type Action,
  ACTIONS,
  NODE_KINDS,
  type NodeKind,
  type Page,
} from '../../src/types'
import { TB_ERROR_CODES, type TBErrorBody, type TBErrorCode } from '../../src/errors'
import fixture from '../../../../test/fixtures/fixed-control-plane.json'

describe('fixed control-plane wire source', () => {
  it('accepts the cross-client fixture through every response schema', () => {
    expect(tbErrorBodySchema.parse(fixture.error)).toEqual(fixture.error)
    expect(feedbackViewSchema.parse(fixture.feedback)).toEqual(fixture.feedback)
    expect(feedbackDetailSchema.parse(fixture.feedbackDetail)).toEqual(fixture.feedbackDetail)
    expect(healthResponseSchema.parse(fixture.health)).toEqual(fixture.health)
    expect(helpJsonSchema.parse(fixture.help)).toEqual(fixture.help)
    expect(oauthAuthorizeResponseSchema.parse(fixture.oauth)).toEqual(fixture.oauth)
    expect(readinessResponseSchema.parse(fixture.readiness)).toEqual(fixture.readiness)
    expect(registryNodeSchema.parse(fixture.registryNode)).toEqual(fixture.registryNode)
    expect(toolSearchPageSchema.parse(fixture.search)).toEqual(fixture.search)
    expect(treeJsonSchema.parse(fixture.tree)).toEqual(fixture.tree)
  })

  it('accepts full search schemas without adding them to the compact fixture', () => {
    expect(fixture.search.items[0]?.tool).not.toHaveProperty('inputSchema')
    expect(fixture.search.items[0]?.tool).not.toHaveProperty('outputSchema')
    const full = {
      ...fixture.search,
      items: fixture.search.items.map(item => ({
        ...item,
        tool: {
          ...item.tool,
          inputSchema: { type: 'object', properties: {} },
          outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
        },
      })),
    }
    expect(toolSearchPageSchema.parse(full)).toEqual(full)
  })

  it('accepts the complete search request surface and rejects malformed options', () => {
    const request = {
      query: 'status',
      opts: {
        cursor: 'next',
        detail: 'full' as const,
        effects: ['read', 'unknown'] as const,
        federation: 'recursive' as const,
        limit: 10,
        matching: 'best' as const,
        minCoverage: 0.75,
        mode: 'keyword' as const,
        pathPrefix: 'system/status',
      },
    }
    expect(toolSearchRequestSchema.parse(request)).toEqual(request)
    expect(toolSearchRequestSchema.safeParse({ query: 'status', typo: true }).success).toBe(false)
    expect(toolSearchRequestSchema.safeParse({ query: 'status', opts: { typo: true } }).success)
      .toBe(false)
    expect(toolSearchRequestSchema.safeParse({ query: 'status', opts: { effects: [] } }).success)
      .toBe(false)
    expect(toolSearchRequestSchema.safeParse({
      query: 'status',
      opts: { federation: 'direct' },
    }).success).toBe(false)
    expect(toolSearchRequestSchema.safeParse({ query: 'status', opts: { matching: 'any' } }).success)
      .toBe(false)
    expect(toolSearchRequestSchema.safeParse({ query: 'status', opts: { minCoverage: 0 } }).success)
      .toBe(false)
    expect(toolSearchRequestSchema.safeParse({ query: 'status', opts: { minCoverage: 1.01 } }).success)
      .toBe(false)
  })

  it('accepts federated evidence without transport internals', () => {
    const basePage = toolSearchPageSchema.parse(fixture.search)
    const federated: WireToolSearchPage = {
      cursor: 'next',
      items: basePage.items.map((item, index) => ({
        ...item,
        source: { path: index === 0 ? '' : 'remotes/child' },
      })),
      partial: true,
      sources: [
        { path: '', status: 'ok' },
        { path: 'remotes/child', status: 'timed_out' },
      ],
    }
    expect(toolSearchPageSchema.parse(federated)).toEqual(federated)
    expect(JSON.stringify(federated)).not.toMatch(/baseUrl|instanceId|rawError/u)

    const internalSnapshot = { ...federated, snapshot: 'fsc1_snapshot' }
    expect(toolSearchPageSchema.parse(internalSnapshot)).toEqual(internalSnapshot)
  })

  it('keeps the search response strict and requires relevance evidence', () => {
    expect(helpJsonSchema.parse({ ...fixture.help, secret: 'must-not-cross' })).toEqual(fixture.help)
    expect(toolSearchPageSchema.safeParse({
      ...fixture.search,
      secret: 'must-not-cross',
    }).success).toBe(false)
    const withoutRelevance = {
      ...fixture.search,
      items: fixture.search.items.map(item => ({ path: item.path, tool: item.tool })),
    }
    expect(toolSearchPageSchema.safeParse(withoutRelevance).success).toBe(false)
    const [item] = fixture.search.items
    if (item === undefined) throw new Error('missing search fixture item')
    for (const malformed of [
      { ...fixture.search, partial: 'yes' },
      { ...fixture.search, sources: [{ path: '', status: 'failed' }] },
      { ...fixture.search, sources: [{ path: '', status: 'ok', rawError: 'secret' }] },
      { ...fixture.search, items: [{ ...item, unexpected: true }] },
      { ...fixture.search, items: [{
        ...item,
        relevance: { ...item.relevance, rawScore: 42 },
      }] },
      { ...fixture.search, items: [{
        ...item,
        relevance: { ...item.relevance, matchedTermCount: item.relevance.totalTermCount + 1 },
      }] },
      { ...fixture.search, items: [{
        ...item,
        relevance: { ...item.relevance, coverage: 0.5 },
      }] },
      { ...fixture.search, items: [{ ...item, source: { path: '', baseUrl: 'https://secret' } }] },
      { ...fixture.search, items: [{ ...item, source: { path: 7 } }] },
    ]) {
      expect(toolSearchPageSchema.safeParse(malformed).success).toBe(false)
    }
  })

  it('reuses the canonical error, action, and node-kind vocabularies', () => {
    for (const code of TB_ERROR_CODES) expect(tbErrorCodeSchema.parse(code)).toBe(code)
    for (const action of ACTIONS) expect(actionSchema.parse(action)).toBe(action)
    for (const kind of NODE_KINDS) expect(nodeKindSchema.parse(kind)).toBe(kind)

    expect(tbErrorCodeSchema.safeParse('future_error').success).toBe(false)
    expect(actionSchema.safeParse('future_action').success).toBe(false)
    expect(nodeKindSchema.safeParse('future_kind').success).toBe(false)
  })

  it('keeps the existing public wire aliases compatible with core types', () => {
    expectTypeOf<WireTBErrorCode>().toEqualTypeOf<TBErrorCode>()
    expectTypeOf<WireTBErrorBody>().toEqualTypeOf<TBErrorBody>()
    expectTypeOf<WireAction>().toEqualTypeOf<Action>()
    expectTypeOf<WireNodeKind>().toEqualTypeOf<NodeKind>()
    expectTypeOf<WirePage<string>>().toEqualTypeOf<Page<string>>()
    expectTypeOf<WireToolSpec>().toEqualTypeOf<ToolSpec>()
    expectTypeOf<WireToolSearchItem['relevance']>()
      .toEqualTypeOf<WireToolSearchRelevance>()
    expectTypeOf<NonNullable<WireToolSearchRequest['opts']>['detail']>()
      .toEqualTypeOf<WireToolSearchDetail | undefined>()
    expectTypeOf<NonNullable<WireToolSearchRequest['opts']>['effects']>()
      .toEqualTypeOf<WireToolSearchEffect[] | undefined>()
    expectTypeOf<NonNullable<WireToolSearchRequest['opts']>['federation']>()
      .toEqualTypeOf<WireToolSearchFederation | undefined>()
    expectTypeOf<NonNullable<WireToolSearchRequest['opts']>['matching']>()
      .toEqualTypeOf<WireToolSearchMatching | undefined>()
    expectTypeOf<NonNullable<WireToolSearchItem['source']>>()
      .toEqualTypeOf<WireToolSearchSource>()
    expectTypeOf<WireToolSearchSourceResult['status']>()
      .toEqualTypeOf<WireToolSearchSourceStatus>()
  })

  it('emits OpenAPI 3.1 components with valid component refs', () => {
    expect(fixedControlPlaneOpenApi.openapi).toBe('3.1.0')
    expect(fixedControlPlaneOpenApi.paths['/~search'].post.operationId).toBe('searchTools')
    expect(fixedControlPlaneOpenApi.paths['/{path}/~register'].post.operationId).toBe(
      'registerNode',
    )
    const feedbackDetail = fixedControlPlaneOpenApi.components.schemas.FeedbackDetail as {
      properties: Record<string, unknown>
      required: string[]
    }
    expect(feedbackDetail.required).toEqual(expect.arrayContaining(['detail', 'path']))
    expect(feedbackDetail.properties).toHaveProperty('detail')
    expect(feedbackDetail.properties).toHaveProperty('path')
    const searchRequest = fixedControlPlaneOpenApi.components.schemas.SearchRequest as {
      properties: {
        opts: {
          properties: Record<string, Record<string, unknown>>
        }
      }
    }
    expect(Object.keys(searchRequest.properties.opts.properties)).toEqual([
      'cursor',
      'detail',
      'effects',
      'federation',
      'limit',
      'matching',
      'minCoverage',
      'mode',
      'pathPrefix',
    ])
    expect(searchRequest.properties.opts.properties.effects).toMatchObject({
      minItems: 1,
      items: { enum: ['read', 'write', 'destructive', 'unknown'] },
    })
    expect(searchRequest.properties.opts.properties.federation)
      .toMatchObject({ enum: ['local', 'recursive'] })
    expect(searchRequest.properties.opts.properties.matching)
      .toMatchObject({ enum: ['best', 'all'] })
    expect(searchRequest.properties.opts.properties.minCoverage)
      .toMatchObject({ exclusiveMinimum: 0, maximum: 1 })
    expect(searchRequest.properties.opts.properties.detail)
      .toMatchObject({ enum: ['compact', 'full'] })
    const searchRelevance = fixedControlPlaneOpenApi.components.schemas.SearchRelevance as {
      properties: Record<string, unknown>
      required: string[]
    }
    expect(searchRelevance.required).toEqual([
      'coverage',
      'matchedTermCount',
      'rankingVersion',
      'totalTermCount',
    ])
    expect(searchRelevance.properties.rankingVersion).toEqual({
      type: 'string',
      const: 'keyword-v2',
    })
    const searchResponse = fixedControlPlaneOpenApi.components.schemas.SearchResponse as {
      additionalProperties: boolean
      properties: {
        items: { items: { properties: Record<string, unknown>, required: string[] } }
        partial: Record<string, unknown>
        sources: { items: Record<string, unknown> }
      }
    }
    expect(searchResponse.additionalProperties).toBe(false)
    expect(searchResponse.properties.items.items.required).toEqual(['path', 'relevance', 'tool'])
    expect(searchResponse.properties.items.items.properties.relevance).toEqual({
      $ref: '#/components/schemas/SearchRelevance',
    })
    expect(searchResponse.properties.items.items.properties.source).toEqual({
      $ref: '#/components/schemas/SearchSource',
    })
    expect(searchResponse.properties.partial).toEqual({ type: 'boolean' })
    expect(searchResponse.properties.sources.items).toEqual({
      $ref: '#/components/schemas/SearchSourceResult',
    })
    const searchSource = fixedControlPlaneOpenApi.components.schemas.SearchSource as {
      additionalProperties: boolean
      properties: Record<string, unknown>
      required: string[]
    }
    expect(searchSource).toMatchObject({
      additionalProperties: false,
      required: ['path'],
      properties: { path: { type: 'string' } },
    })
    const searchSourceResult = fixedControlPlaneOpenApi.components.schemas.SearchSourceResult as {
      additionalProperties: boolean
      properties: { status: Record<string, unknown> }
      required: string[]
    }
    expect(searchSourceResult.additionalProperties).toBe(false)
    expect(searchSourceResult.required).toEqual(['path', 'status'])
    expect(searchSourceResult.properties.status).toEqual({
      type: 'string',
      enum: [
        'ok',
        'unsupported',
        'timed_out',
        'unavailable',
        'cycle',
        'hop_limit',
        'budget_exhausted',
        'invalid_response',
      ],
    })
    const serialized = JSON.stringify(fixedControlPlaneOpenApi)
    expect(serialized).toContain('#/components/schemas/Tree')
    expect(serialized).not.toMatch(/"\$ref":"Tree"/)
    expect(serialized).not.toContain('authorizationUrl":"https://')
  })
})
