/** Skillhub 命令的 metadata、strict schema、scope 与 provider dispatch 单一真源。 */

import { z } from 'zod/v4'
import type { SkillhubProvider, SkillPublishInput } from './provider'
import {
  HTBP_LIST_OPTIONS_SCHEMA,
  HtbpCommandRegistry,
} from '../operation/htbpCommandRegistry'
import { TBError } from '../errors'

const publishFileSchema = z.strictObject({
  path: z.string().describe(
    'file path relative to the skill root, e.g. \'SKILL.md\', \'scripts/run.sh\'',
  ),
  content: z.string().describe('UTF-8 text content'),
  contentType: z.string().optional().describe('optional; inferred from extension when omitted'),
})

export const skillhubCommands = new HtbpCommandRegistry<SkillhubProvider>()
  .register(
    'list',
    {
      h: 'list published skills (id / name / description from SKILL.md frontmatter, paginated)',
      inputSchema: z.strictObject({ opts: HTBP_LIST_OPTIONS_SCHEMA.optional() }),
      returns: 'Page<SkillSummary>',
      scope: 'read',
    },
    ({ opts }, provider) => provider.list(opts),
  )
  .register(
    'get',
    {
      h: 'read a skill: SKILL.md body + file manifest; pass \'file\' to fetch one bundled file (oversized/binary as { $ref })',
      inputSchema: z.strictObject({
        id: z.string().describe('skill id'),
        file: z.string().optional().describe(
          'optional: path of one bundled file to fetch instead of the manifest',
        ),
      }),
      returns: 'SkillDetail | SkillFile',
      scope: 'read',
    },
    ({ file, id }, provider) => file === undefined
      ? provider.get(id)
      : provider.get_file(id, file),
  )
  .register(
    'search',
    {
      h: 'keyword search over skill id / name / description',
      inputSchema: z.strictObject({
        query: z.string().describe('substring to match'),
        opts: HTBP_LIST_OPTIONS_SCHEMA.optional(),
      }),
      returns: 'Page<SkillSummary>',
      scope: 'read',
    },
    ({ opts, query }, provider) => provider.search(query, opts),
  )
  .register(
    'publish',
    {
      h: 'publish/replace a skill from a set of text files (must include SKILL.md with name+description frontmatter)',
      inputSchema: z.strictObject({
        id: z.string().optional().describe(
          'skill id; defaults to a slug derived from the frontmatter name',
        ),
        files: z.array(publishFileSchema).describe(
          'the skill files; whole-skill replace (files not listed are removed)',
        ),
      }),
      returns: '{ id, name, description, fileCount }',
      scope: 'write',
    },
    ({ files, id }, provider) => {
      const input: SkillPublishInput = {
        files,
        ...(id !== undefined ? { id } : {}),
      }
      return provider.publish(input)
    },
  )
  .register(
    'remove',
    {
      h: 'delete a skill and all its files (not_found if it does not exist)',
      inputSchema: z.strictObject({ id: z.string().describe('skill id') }),
      scope: 'write',
      effect: 'destructive',
    },
    ({ id }, provider) => provider.remove(id),
  )

/** 数据面命令叶子 → scope；未知(含大小写不符)→ null。 */
export function skillhubScopeForCmd(command: string): 'read' | 'write' | null {
  const scope = skillhubCommands.scopeFor(command)
  return scope === 'read' || scope === 'write' ? scope : null
}

export async function dispatchSkillhubCmd(
  provider: SkillhubProvider,
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const normalized = command.toLowerCase()
  if (!skillhubCommands.has(normalized)) {
    throw new TBError('invalid_argument', `unknown cmd '${command}'`)
  }
  if (normalized === 'publish' && !Array.isArray(args.files)) {
    throw new TBError('invalid_argument', 'publish 需要数组 \'files\'')
  }
  return await skillhubCommands.invoke(normalized, args, provider)
}
