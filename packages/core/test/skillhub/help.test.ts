import { describe, expect, it } from 'vitest'
import { skillhubHelpModel, skillhubScopeForCmd } from '../../src/skillhub/help'

const node = { path: 'skills/team', description: 'team skills' }

describe('skillhubHelpModel', () => {
  it('命令顺序、完整 path 与 scope 来自注册真源', () => {
    const help = skillhubHelpModel(node)
    expect(help.node).toEqual({ path: 'skills/team', kind: 'skillhub', description: 'team skills' })
    expect(help.cmds.map(command => command.name)).toEqual([
      'list', 'get', 'search', 'publish', 'remove',
    ])
    expect(help.cmds.every(command => command.path === `/skills/team/${command.name}`)).toBe(true)
    expect(Object.fromEntries(help.cmds.map(command => [command.name, command.scope]))).toEqual({
      list: 'read', get: 'read', search: 'read', publish: 'write', remove: 'write',
    })
  })

  it('publish Help 精确带嵌套 required/additionalProperties', () => {
    const publish = skillhubHelpModel(node).cmds.find(command => command.name === 'publish')
    expect(publish).toEqual({
      name: 'publish',
      method: 'POST',
      path: '/skills/team/publish',
      scope: 'write',
      h: 'publish/replace a skill from a set of text files (must include SKILL.md with name+description frontmatter)',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            description: 'skill id; defaults to a slug derived from the frontmatter name',
            type: 'string',
          },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'file path relative to the skill root, e.g. \'SKILL.md\', \'scripts/run.sh\'',
                },
                content: { type: 'string', description: 'UTF-8 text content' },
                contentType: {
                  description: 'optional; inferred from extension when omitted',
                  type: 'string',
                },
              },
              required: ['path', 'content'],
              additionalProperties: false,
            },
            description: 'the skill files; whole-skill replace (files not listed are removed)',
          },
        },
        required: ['files'],
        additionalProperties: false,
      },
      returns: '{ id, name, description, fileCount }',
    })
  })

  it('readOnly 隐藏写命令；scope 未知/大写不匹配为 null', () => {
    expect(skillhubHelpModel(node, { readOnly: true }).cmds.map(command => command.name))
      .toEqual(['list', 'get', 'search'])
    expect(skillhubScopeForCmd('publish')).toBe('write')
    expect(skillhubScopeForCmd('get')).toBe('read')
    expect(skillhubScopeForCmd('Publish')).toBeNull()
    expect(skillhubScopeForCmd('watch')).toBeNull()
  })
})
