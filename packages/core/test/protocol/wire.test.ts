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
  treeJsonSchema,
  type WireAction,
  type WireNodeKind,
  type WirePage,
  type WireTBErrorBody,
  type WireTBErrorCode,
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

  it('strips unknown response fields but rejects unknown request fields', async () => {
    expect(helpJsonSchema.parse({ ...fixture.help, secret: 'must-not-cross' })).toEqual(fixture.help)
    const { toolSearchRequestSchema } = await import('../../src/protocol/public')
    expect(toolSearchRequestSchema.safeParse({ query: 'status', typo: true }).success).toBe(false)
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
    const serialized = JSON.stringify(fixedControlPlaneOpenApi)
    expect(serialized).toContain('#/components/schemas/Tree')
    expect(serialized).not.toMatch(/"\$ref":"Tree"/)
    expect(serialized).not.toContain('authorizationUrl":"https://')
  })
})
