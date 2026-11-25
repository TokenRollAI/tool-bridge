import { EVENT_MAX_WAIT_MS, type EventPublishInput, type EventReadInput, ToolBridgeClientError } from '@tool-bridge/sdk/client'
import { readFile } from 'node:fs/promises'
import { Command } from 'commander'
import { once } from 'node:events'
import pRetry from 'p-retry'
import { parsePositiveInt, resolveTarget, withGlobalOpts } from '../args'
import { CliError, withClient } from '../http'
import { printJson } from '../output'

export function topicCommand() {
  return new Command('topic').description('Manage durable event topics')
    .addCommand(withGlobalOpts(new Command('create'))
      .argument('<path>').option('--description <text>', 'Describe this topic')
      .action(async (path, opts) => {
        printJson(await withClient(resolveTarget(opts), client => client.events.create(path, opts.description)))
      }))
}

export function pubCommand() {
  return withGlobalOpts(new Command('pub'))
    .description('Publish a JSON event and print its committed receipt')
    .argument('<path>').requiredOption('--type <type>', 'Event type')
    .requiredOption('--data-file <file>', 'JSON event data')
    .option('--idempotency-key <key>', 'Reuse a receipt for 24 hours')
    .option('--schema-version <number>', 'Positive schema version (default 1)')
    .option('--subject <subject>', 'Subject of the event')
    .action(async (path, opts) => {
      const raw = await readFile(opts.dataFile, 'utf8')
      let data: EventPublishInput['data']
      try {
        data = JSON.parse(raw)
      } catch {
        throw new CliError('event data file must contain JSON')
      }
      printJson(await withClient(resolveTarget(opts), client => client.events.publish(path, {
        type: opts.type, data, subject: opts.subject, idempotencyKey: opts.idempotencyKey,
        schemaVersion: parsePositiveInt(opts.schemaVersion, '--schema-version'),
      })))
    })
}

function readCommand(name: 'sub' | 'wait') {
  return withGlobalOpts(new Command(name)).argument('<path>')
    .option('--after <cursor>', 'Resume after this cursor (default: current tail)')
    .option('--type <type>', 'Exact event type (must match the cursor filter)')
}

export function waitCommand() {
  const cmd = readCommand('wait').description('Wait for the first matching event (timeout exit 2, gap exit 3)')
  cmd.options.find(o => o.long === '--timeout')!.description = 'Total wait, in seconds or with ms/s suffix (default 30s)'
  return cmd.action(async (path, opts) => {
    const duration = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(opts.timeout ?? '30s')
    if (!duration) throw new CliError('invalid --timeout, expected a duration such as 30s')
    const budget = Math.ceil(Number(duration[1]) * (duration[2] === 'ms' ? 1 : 1000))
    if (!Number.isSafeInteger(budget) || budget > 86_400_000) throw new CliError('--timeout must be at most one day')
    const deadline = performance.now() + budget
    const input: EventReadInput = { after: opts.after, type: opts.type, limit: 1 }
    await withClient(resolveTarget({ ...opts, timeout: undefined }), async (client) => {
      for (;;) {
        input.waitMs = Math.max(0, Math.min(EVENT_MAX_WAIT_MS, Math.ceil(deadline - performance.now())))
        const page = await client.events.read(path, input)
        if (page.gap || page.events.length || performance.now() >= deadline) {
          if (page.gap) process.exitCode = 3
          else if (!page.events.length) process.exitCode = 2
          printJson({ ...page, timedOut: !page.gap && !page.events.length })
          return
        }
        input.after = page.nextCursor
      }
    })
  })
}

export function subCommand() {
  return readCommand('sub').description('Stream one JSON event per line; resume from its cursor')
    .action(async (path, opts) => {
      const target = resolveTarget(opts)
      const waitMs = Math.min(EVENT_MAX_WAIT_MS, Math.floor((target.timeoutMs ?? 120_000) * 0.8))
      const input: EventReadInput = { after: opts.after, type: opts.type, waitMs }
      await withClient(target, async (client) => {
        for (;;) {
          const page = await pRetry(() => client.events.read(path, input), {
            retries: 4,
            shouldRetry: ({ error }) => input.after !== undefined && error instanceof ToolBridgeClientError
              && (error.kind === 'network' || error.kind === 'timeout' || error.retryable),
            onFailedAttempt: ({ error }) => { process.stderr.write(`${error.message}\n`) },
          })
          if (page.gap) {
            process.stderr.write(`${JSON.stringify(page)}\n`)
            process.exitCode = 3
            return
          }
          for (const event of page.events) {
            if (!process.stdout.write(`${JSON.stringify(event)}\n`)) await once(process.stdout, 'drain')
          }
          input.after = page.nextCursor
        }
      })
    })
}
