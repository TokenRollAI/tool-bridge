/** Context 命令的 metadata、strict schema、scope 与 provider dispatch 单一真源。 */

import { z } from 'zod/v4'
import type {
  ContextEntryInput,
  ContextPatch,
  ContextProvider,
  ContextUploadInput,
  SearchOptions,
} from './types'
import {
  HTBP_LIST_OPTIONS_SCHEMA,
  HtbpCommandRegistry,
} from '../operation/htbpCommandRegistry'
import { TBError } from '../errors'

interface ContextCommandTarget {
  provider?: ContextProvider
  upload?: (input: ContextUploadInput) => unknown | Promise<unknown>
}

const metadataSchema = z.record(z.string(), z.string()).optional().describe(
  'string-to-string metadata map',
)
const entrySchema = z.strictObject({
  contentType: z.string().optional().describe(
    'required when content is a string; defaults to application/json for non-string content',
  ),
  content: z.unknown().describe('entry body: string, or any JSON value'),
  metadata: metadataSchema,
  ifVersion: z.string().optional().describe('optimistic concurrency: expected current version'),
})
const patchSchema = z.strictObject({
  content: z.unknown().optional().describe('replacement content'),
  metadata: metadataSchema,
  ifVersion: z.string().optional().describe('optimistic concurrency: expected current version'),
}).describe('partial update; omitted fields keep their current value')
const searchOptionsSchema = z.strictObject({
  cursor: z.string().optional().describe('opaque cursor returned by the previous page'),
  limit: z.number().optional().describe('page size (default 50, max 200)'),
  mode: z.enum(['keyword', 'semantic']).optional().describe('default "keyword"'),
}).describe('pagination + search mode')

export const contextCommands = new HtbpCommandRegistry<ContextCommandTarget>()
  .register(
    'list',
    {
      h: 'list entries directly under a path (shallow, paginated)',
      inputSchema: z.strictObject({
        path: z.string().optional().describe('entry path prefix inside the namespace'),
        opts: HTBP_LIST_OPTIONS_SCHEMA.optional(),
      }),
      returns: 'Page<ContextEntryMeta>',
      scope: 'read',
    },
    ({ opts, path }, { provider }) => provider!.list!(path ?? '', opts),
  )
  .register(
    'get',
    {
      h: 'read one entry with content (oversized content comes back as { $ref: <download URL> })',
      inputSchema: z.strictObject({
        path: z.string().describe('entry path inside the namespace'),
      }),
      returns: 'ContextEntry',
      scope: 'read',
    },
    ({ path }, { provider }) => provider!.get!(path),
  )
  .register(
    'write',
    {
      h: 'create or fully replace an entry (idempotent upsert)',
      inputSchema: z.strictObject({
        path: z.string().describe('entry path inside the namespace'),
        entry: entrySchema,
      }),
      returns: 'ContextEntryMeta',
      scope: 'write',
    },
    ({ entry, path }, { provider }) =>
      provider!.write!(path, entry as ContextEntryInput),
  )
  .register(
    'update',
    {
      h: 'partially update content and/or metadata (shallow merge); not_found if the entry does not exist',
      inputSchema: z.strictObject({
        path: z.string().describe('entry path inside the namespace'),
        patch: patchSchema,
      }),
      returns: 'ContextEntryMeta',
      scope: 'write',
    },
    ({ patch, path }, { provider }) => provider!.update!(path, patch as ContextPatch),
  )
  .register(
    'delete',
    {
      h: 'delete an entry (idempotent)',
      inputSchema: z.strictObject({
        path: z.string().describe('entry path inside the namespace'),
      }),
      scope: 'write',
      effect: 'destructive',
    },
    ({ path }, { provider }) => provider!.delete!(path),
  )
  .register(
    'search',
    {
      h: 'keyword search: substring match on entry paths and metadata values',
      inputSchema: z.strictObject({
        query: z.string().describe('substring to match'),
        opts: searchOptionsSchema.optional(),
      }),
      returns: 'Page<ContextEntryMeta>',
      scope: 'read',
    },
    ({ opts, query }, { provider }) =>
      provider!.search!(query, opts as SearchOptions | undefined),
  )
  .register(
    'create_upload',
    {
      h: 'create a short-lived, path-scoped direct-upload grant; persist the returned uri, not url',
      inputSchema: z.strictObject({
        path: z.string().describe('target entry path inside the namespace'),
        contentType: z.string().describe('media type signed into the PUT request'),
        overwrite: z.boolean().optional().describe(
          'allow replacing an existing object; default false',
        ),
      }),
      returns: 'ContextUploadGrant',
      scope: 'write',
      effect: 'write',
    },
    ({ contentType, overwrite, path }, { upload }) => upload!({
      path,
      contentType,
      ...(overwrite !== undefined ? { overwrite } : {}),
    }),
  )

/** 数据面命令叶子 → scope；未知(含大小写不符)→ null。 */
export function contextScopeForCmd(command: string): 'read' | 'write' | null {
  const scope = contextCommands.scopeFor(command)
  return scope === 'read' || scope === 'write' ? scope : null
}

/** 设备转发等宿主 transport 复用注册真源的 strict schema。 */
export function parseContextCmdArgs(
  command: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = command.toLowerCase()
  if (!contextCommands.has(normalized) || normalized === 'create_upload') {
    throw new TBError('invalid_argument', `unknown cmd '${command}'`)
  }
  return contextCommands.parse(normalized, args) as Record<string, unknown>
}

/** ContextProvider 的可选方法调度；缺 handler 保持旧 unknown-cmd 文案。 */
export async function dispatchContextCmd(
  provider: ContextProvider,
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const normalized = command.toLowerCase()
  if (!contextCommands.has(normalized) || normalized === 'create_upload') {
    throw new TBError('invalid_argument', `unknown cmd '${command}'`)
  }
  const method = normalized as keyof ContextProvider
  if (typeof provider[method] !== 'function') {
    throw new TBError('invalid_argument', `unknown cmd '${command}'(provider 未实现)`)
  }
  // 保留旧的两条高信息量文案，其余形状错误由统一 Zod 映射。
  if (normalized === 'write' && (typeof args.entry !== 'object' || args.entry === null)) {
    throw new TBError('invalid_argument', 'write 需要对象 \'entry\'')
  }
  if (normalized === 'update' && (typeof args.patch !== 'object' || args.patch === null)) {
    throw new TBError('invalid_argument', 'update 需要对象 \'patch\'')
  }
  return await contextCommands.invoke(normalized, args, { provider })
}

/** create_upload 复用同一 schema/handler，grant 签发仍由宿主 callback 完成。 */
export async function dispatchContextUploadCmd(
  args: Record<string, unknown>,
  upload: (input: ContextUploadInput) => unknown | Promise<unknown>,
): Promise<unknown> {
  return await contextCommands.invoke('create_upload', args, {
    upload,
  })
}
