import { Command } from 'commander'
import { resolveTarget, withGlobalOpts } from '../args'
import { callTool } from '../http'
import { guard, printJson, printLine, table } from '../output'

interface NoteGlobalOpts {
  json?: boolean
  baseUrl?: string
  sk?: string
}

/** system/annotation 的一条补充说明。 */
interface Annotation {
  path: string
  text: string
  updatedAt: string
  updatedBy: string
}

/** 根路径在 CLI 参数里写 '/',发给 API 时化为 ''(全树公告)。 */
function apiPath(pathArg: string): string {
  const p = String(pathArg ?? '').trim()
  return p === '/' ? '' : p
}

function displayPath(path: string): string {
  return path === '' ? '/' : path
}

/** `tb note ls [prefix]` → 全部(或某前缀下)已标注路径。 */
export function noteLsCommand(): Command {
  return withGlobalOpts(new Command('ls'))
    .description('List annotated paths (optionally under a prefix)')
    .argument('[prefix]', 'Only paths under this prefix')
    .action(async (prefixArg: string | undefined, opts: NoteGlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const args = prefixArg !== undefined ? { prefix: prefixArg } : {}
        const page = await callTool<{ items: Annotation[] }>(
          resolveTarget(opts),
          '/system/annotation',
          'list',
          args,
        )
        if (asJson) {
          printJson(page)
          return
        }
        const rows = (page.items ?? []).map((a) => [
          displayPath(a.path),
          a.text,
          a.updatedAt ? new Date(a.updatedAt).toLocaleString() : '-',
        ])
        printLine(table(['PATH', 'NOTE', 'UPDATED'], rows))
      })
    })
}

/** `tb note get <path>` → 单条补充说明全文。 */
export function noteGetCommand(): Command {
  return withGlobalOpts(new Command('get'))
    .description('Show the note of a path')
    .argument('<path>', "Tree path (use '/' for the tree-wide notice)")
    .action(async (pathArg: string, opts: NoteGlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const entry = await callTool<Annotation>(resolveTarget(opts), '/system/annotation', 'get', {
          path: apiPath(pathArg),
        })
        if (asJson) printJson(entry)
        else printLine(entry.text)
      })
    })
}

/** `tb note set <path> <text>` → 覆盖写入(展示在该 path 的 ~help;admin scope)。 */
export function noteSetCommand(): Command {
  return withGlobalOpts(new Command('set'))
    .description("Upsert the note shown in ~help of a path (use '/' for a tree-wide notice)")
    .argument('<path>', 'Tree path (tool sub-paths allowed, e.g. feishu/create-doc)')
    .argument('<text>', 'Note text (<= 2000 chars)')
    .action(async (pathArg: string, textArg: string, opts: NoteGlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const entry = await callTool<Annotation>(resolveTarget(opts), '/system/annotation', 'set', {
          path: apiPath(pathArg),
          text: textArg,
        })
        if (asJson) printJson(entry)
        else printLine(`note set on ${displayPath(entry.path)}`)
      })
    })
}

/** `tb note rm <path>` → 删除补充说明(admin scope)。 */
export function noteRmCommand(): Command {
  return withGlobalOpts(new Command('rm'))
    .description('Remove the note of a path')
    .argument('<path>', "Tree path (use '/' for the tree-wide notice)")
    .action(async (pathArg: string, opts: NoteGlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const path = apiPath(pathArg)
        await callTool(resolveTarget(opts), '/system/annotation', 'remove', { path })
        if (asJson) printJson({ ok: true, path })
        else printLine(`note removed from ${displayPath(path)}`)
      })
    })
}

export function noteCommand(): Command {
  return new Command('note')
    .description('Manage path notes shown in ~help (system/annotation; set/rm need admin scope)')
    .addCommand(noteLsCommand())
    .addCommand(noteGetCommand())
    .addCommand(noteSetCommand())
    .addCommand(noteRmCommand())
}
