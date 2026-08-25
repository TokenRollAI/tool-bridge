import { describe, expect, it } from 'vitest'
import {
  feedbackDetailSchema,
  feedbackViewSchema,
  fixedControlPlaneOpenApi,
  healthResponseSchema,
  helpJsonSchema,
  oauthAuthorizeResponseSchema,
  readinessResponseSchema,
  registryNodeSchema,
  tbErrorBodySchema,
  toolSearchPageSchema,
  treeJsonSchema,
} from '../../src/protocol/public'
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
