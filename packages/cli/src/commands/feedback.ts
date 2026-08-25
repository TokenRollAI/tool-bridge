import { Command } from 'commander'
import { printJson, printLine, table } from '../output'
import { resolveTarget, withGlobalOpts } from '../args'
import { confirmDestructive } from '../confirm'
import { CliError, withClient } from '../http'

/** feedback 是 per-path 能力；CLI 先拒绝空路径，编码/保留段由 SDK 权威处理。 */
function feedbackTarget(pathArg: string): string {
  const p = String(pathArg ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
  if (p === '') throw new CliError('path is required (feedback is per-path)')
  return p
}

/** `tb feedback ls <path>` → GET /<path>/~feedback(净分排序;--hidden 含隐藏条目)。 */
export function feedbackLsCommand() {
  return withGlobalOpts(new Command('ls'))
    .description('List feedback of a path, sorted by score')
    .argument('<path>', 'Tree path (tool sub-paths allowed)')
    .option('--hidden', 'Also show entries hidden from ~help (score <= -3)')
    .action(async (pathArg, opts) => {
      const asJson = Boolean(opts.json)
      const target = resolveTarget(opts)
      const page = await withClient(
        target,
        async client => await client.feedback.list(feedbackTarget(pathArg), {
          hidden: opts.hidden,
        }),
      )
      if (asJson) {
        printJson(page)
        return
      }
      const rows = (page.items ?? []).map(f => [
        f.id,
        String(f.score),
        f.title,
        f.by,
        f.at ? new Date(f.at).toLocaleString() : '-',
      ])
      printLine(table(['ID', 'SCORE', 'TITLE', 'BY', 'AT'], rows))
    })
}

/** `tb feedback get <path> <id>` → GET /<path>/~feedback/<id>(含 detail)。 */
export function feedbackGetCommand() {
  return withGlobalOpts(new Command('get'))
    .description('Show full detail of one feedback (ids appear in ~help / ls)')
    .argument('<path>', 'Tree path the feedback belongs to')
    .argument('<id>', 'Feedback id (fb_*)')
    .action(async (pathArg, idArg, opts) => {
      const asJson = Boolean(opts.json)
      const target = resolveTarget(opts)
      const entry = await withClient(
        target,
        async client => await client.feedback.get(feedbackTarget(pathArg), idArg),
      )
      if (asJson) {
        printJson(entry)
        return
      }
      printLine(`${entry.title}  (score ${entry.score}: +${entry.up}/-${entry.down})`)
      printLine(`by ${entry.by} at ${entry.at ? new Date(entry.at).toLocaleString() : '-'}`)
      printLine('')
      printLine(entry.detail)
    })
}

/** `tb feedback submit <path> --title <t> --detail <d>` → POST /<path>/~feedback(call scope)。 */
export function feedbackSubmitCommand() {
  return withGlobalOpts(new Command('submit'))
    .description('Share a pitfall you hit on a path (keep it short)')
    .argument('<path>', 'Tree path (tool sub-paths allowed)')
    .requiredOption('--title <title>', 'One-line summary (<= 80 chars)')
    .requiredOption('--detail <detail>', 'Short detail (<= 500 chars)')
    .action(
      async (pathArg, opts) => {
        const asJson = Boolean(opts.json)
        const target = resolveTarget(opts)
        const entry = await withClient(
          target,
          async client => await client.feedback.submit(feedbackTarget(pathArg), {
            title: opts.title,
            detail: opts.detail,
          }),
        )
        if (asJson) printJson(entry)
        else printLine(`feedback ${entry.id} submitted on ${entry.path}`)
      },
    )
}

const VOTE_VALUES = ['up', 'down', 'clear']

/** `tb feedback vote <path> <id> <up|down|clear>` → POST /<path>/~feedback/<id>。 */
export function feedbackVoteCommand() {
  return withGlobalOpts(new Command('vote'))
    .description('Rate a feedback: up / down / clear (one vote per identity, revote overrides)')
    .argument('<path>', 'Tree path the feedback belongs to')
    .argument('<id>', 'Feedback id (fb_*)')
    .argument('<value>', 'up | down | clear')
    .action(async (pathArg, idArg, valueArg, opts) => {
      const asJson = Boolean(opts.json)
      const value = String(valueArg ?? '').trim()
      if (!VOTE_VALUES.includes(value)) {
        throw new CliError(`value must be one of: ${VOTE_VALUES.join(' | ')}`)
      }
      const target = resolveTarget(opts)
      const view = await withClient(
        target,
        async client => await client.feedback.vote(
          feedbackTarget(pathArg),
          idArg,
          value as 'clear' | 'down' | 'up',
        ),
      )
      if (asJson) printJson(view)
      else printLine(`${view.id}: score ${view.score} (+${view.up}/-${view.down})`)
    })
}

/** `tb feedback rm <path> <id>` → DELETE /<path>/~feedback/<id>(admin scope)。 */
export function feedbackRmCommand() {
  return withGlobalOpts(new Command('rm'))
    .description('Remove one feedback (admin scope)')
    .argument('<path>', 'Tree path the feedback belongs to')
    .argument('<id>', 'Feedback id (fb_*)')
    .option('--yes', 'Skip the confirmation prompt')
    .action(async (pathArg, idArg, opts) => {
      const asJson = Boolean(opts.json)
      await confirmDestructive(opts, `Remove feedback ${idArg} on ${pathArg}?`)
      const target = resolveTarget(opts)
      await withClient(
        target,
        async client => await client.feedback.remove(feedbackTarget(pathArg), idArg),
      )
      if (asJson) printJson({ ok: true, id: idArg })
      else printLine(`feedback ${idArg} removed`)
    })
}

export function feedbackCommand() {
  return new Command('feedback')
    .description('Agent feedback on paths (~feedback endpoint): top entries show up in ~help')
    .addCommand(feedbackLsCommand())
    .addCommand(feedbackGetCommand())
    .addCommand(feedbackSubmitCommand())
    .addCommand(feedbackVoteCommand())
    .addCommand(feedbackRmCommand())
}
