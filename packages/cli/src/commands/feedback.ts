import { Command } from 'commander'
import { resolveTarget, withGlobalOpts } from '../args'
import { apiJson, CliError } from '../http'
import { guard, printJson, printLine, table } from '../output'

interface FeedbackGlobalOpts {
  json?: boolean
  baseUrl?: string
  sk?: string
}

/** ~feedback 列表的一行(不含 detail;下钻用 get)。 */
interface FeedbackView {
  id: string
  title: string
  by: string
  at: string
  up: number
  down: number
  score: number
}

/** `/<path>/~feedback[/<id>]` 端点路径(feedback 是 per-path 保留段能力)。 */
function fbPath(pathArg: string, id?: string): string {
  const p = String(pathArg ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
  if (p === '') throw new CliError('path is required (feedback is per-path)')
  return id !== undefined ? `/${p}/~feedback/${id}` : `/${p}/~feedback`
}

/** `tb feedback ls <path>` → GET /<path>/~feedback(净分排序;--hidden 含隐藏条目)。 */
export function feedbackLsCommand(): Command {
  return withGlobalOpts(new Command('ls'))
    .description('List feedback of a path, sorted by score')
    .argument('<path>', 'Tree path (tool sub-paths allowed)')
    .option('--hidden', 'Also show entries hidden from ~help (score <= -3)')
    .action(async (pathArg: string, opts: FeedbackGlobalOpts & { hidden?: boolean }) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const page = await apiJson<{ items: FeedbackView[] }>(resolveTarget(opts), {
          path: fbPath(pathArg),
          ...(opts.hidden ? { query: { hidden: 1 } } : {}),
        })
        if (asJson) {
          printJson(page)
          return
        }
        const rows = (page.items ?? []).map((f) => [
          f.id,
          String(f.score),
          f.title,
          f.by,
          f.at ? new Date(f.at).toLocaleString() : '-',
        ])
        printLine(table(['ID', 'SCORE', 'TITLE', 'BY', 'AT'], rows))
      })
    })
}

/** `tb feedback get <path> <id>` → GET /<path>/~feedback/<id>(含 detail)。 */
export function feedbackGetCommand(): Command {
  return withGlobalOpts(new Command('get'))
    .description('Show full detail of one feedback (ids appear in ~help / ls)')
    .argument('<path>', 'Tree path the feedback belongs to')
    .argument('<id>', 'Feedback id (fb_*)')
    .action(async (pathArg: string, idArg: string, opts: FeedbackGlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const entry = await apiJson<FeedbackView & { detail: string }>(resolveTarget(opts), {
          path: fbPath(pathArg, idArg),
        })
        if (asJson) {
          printJson(entry)
          return
        }
        printLine(`${entry.title}  (score ${entry.score}: +${entry.up}/-${entry.down})`)
        printLine(`by ${entry.by} at ${entry.at ? new Date(entry.at).toLocaleString() : '-'}`)
        printLine('')
        printLine(entry.detail)
      })
    })
}

/** `tb feedback submit <path> --title <t> --detail <d>` → POST /<path>/~feedback(call scope)。 */
export function feedbackSubmitCommand(): Command {
  return withGlobalOpts(new Command('submit'))
    .description('Share a pitfall you hit on a path (keep it short)')
    .argument('<path>', 'Tree path (tool sub-paths allowed)')
    .requiredOption('--title <title>', 'One-line summary (<= 80 chars)')
    .requiredOption('--detail <detail>', 'Short detail (<= 500 chars)')
    .action(
      async (pathArg: string, opts: FeedbackGlobalOpts & { title: string; detail: string }) => {
        const asJson = Boolean(opts.json)
        await guard(asJson, async () => {
          const entry = await apiJson<{ id: string; path: string; title: string }>(
            resolveTarget(opts),
            {
              method: 'POST',
              path: fbPath(pathArg),
              body: { title: opts.title, detail: opts.detail },
            },
          )
          if (asJson) printJson(entry)
          else printLine(`feedback ${entry.id} submitted on ${entry.path}`)
        })
      },
    )
}

const VOTE_VALUES = ['up', 'down', 'clear']

/** `tb feedback vote <path> <id> <up|down|clear>` → POST /<path>/~feedback/<id>。 */
export function feedbackVoteCommand(): Command {
  return withGlobalOpts(new Command('vote'))
    .description('Rate a feedback: up / down / clear (one vote per identity, revote overrides)')
    .argument('<path>', 'Tree path the feedback belongs to')
    .argument('<id>', 'Feedback id (fb_*)')
    .argument('<value>', 'up | down | clear')
    .action(async (pathArg: string, idArg: string, valueArg: string, opts: FeedbackGlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const value = String(valueArg ?? '').trim()
        if (!VOTE_VALUES.includes(value)) {
          throw new CliError(`value must be one of: ${VOTE_VALUES.join(' | ')}`)
        }
        const view = await apiJson<FeedbackView>(resolveTarget(opts), {
          method: 'POST',
          path: fbPath(pathArg, idArg),
          body: { vote: value },
        })
        if (asJson) printJson(view)
        else printLine(`${view.id}: score ${view.score} (+${view.up}/-${view.down})`)
      })
    })
}

/** `tb feedback rm <path> <id>` → DELETE /<path>/~feedback/<id>(admin scope)。 */
export function feedbackRmCommand(): Command {
  return withGlobalOpts(new Command('rm'))
    .description('Remove one feedback (admin scope)')
    .argument('<path>', 'Tree path the feedback belongs to')
    .argument('<id>', 'Feedback id (fb_*)')
    .action(async (pathArg: string, idArg: string, opts: FeedbackGlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        await apiJson(resolveTarget(opts), { method: 'DELETE', path: fbPath(pathArg, idArg) })
        if (asJson) printJson({ ok: true, id: idArg })
        else printLine(`feedback ${idArg} removed`)
      })
    })
}

export function feedbackCommand(): Command {
  return new Command('feedback')
    .description('Agent feedback on paths (~feedback endpoint): top entries show up in ~help')
    .addCommand(feedbackLsCommand())
    .addCommand(feedbackGetCommand())
    .addCommand(feedbackSubmitCommand())
    .addCommand(feedbackVoteCommand())
    .addCommand(feedbackRmCommand())
}
