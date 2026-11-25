import type { AddressInfo } from 'node:net'
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { join, relative, resolve, sep } from 'node:path'
import { createAdaptorServer } from '@hono/node-server'
import { type FSWatcher, watch } from 'chokidar'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { loadPluginWorker, type PluginDevWorker, readPluginEntry, startPluginWorker } from './worker'
import { createDevIdentity, type DevGateway, prepareDevGateway } from './gateway'
import { printLine } from '../output'
import { CliError } from '../http'

interface Revision {
  gateway: DevGateway
  requests: number
  worker: PluginDevWorker
}

async function watchProject(directory: string, signal: AbortSignal): Promise<FSWatcher> {
  // Poll project files so watch also works on volumes without native notifications.
  const watcher = watch(directory, {
    ignoreInitial: true,
    followSymlinks: false,
    ignored: path => relative(directory, path).split(sep).some(part => part === 'node_modules' || part.startsWith('.')),
    interval: 200,
    usePolling: true,
  })
  try {
    await once(watcher, 'ready', { signal })
    return watcher
  } catch (error) {
    await watcher.close()
    throw error
  }
}

function listMounts(gateway: DevGateway): void {
  for (const path of gateway.mounts) printLine(`  ${path}`)
  for (const id of gateway.manualExports) {
    printLine(`  ${id} (requires manual binding)`)
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll('\'', '\'\\\'\'')}'`
}

export async function runPluginDev(dir: string, json: boolean, stopSignal?: AbortSignal): Promise<void> {
  stopSignal?.throwIfAborted()
  const directory = await realpath(resolve(dir))
  const controller = new AbortController()
  const { signal } = controller
  const identity = await createDevIdentity()
  const workers = new Set<PluginDevWorker>()
  let current: Revision | undefined
  let server: ReturnType<typeof createAdaptorServer> | undefined
  let watcher: FSWatcher | undefined
  let credentialDir: string | undefined
  let edits = 0
  let wake: (() => void) | undefined
  const stop = () => {
    controller.abort()
    wake?.()
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  stopSignal?.addEventListener('abort', stop, { once: true })
  if (stopSignal?.aborted) stop()

  const closeWorker = (worker: PluginDevWorker): void => {
    workers.delete(worker)
    worker.close()
  }
  const prepare = async (): Promise<Revision> => {
    const entry = await readPluginEntry(directory)
    signal.throwIfAborted()
    const startup = AbortSignal.any([signal, AbortSignal.timeout(15_000)])
    const worker = await loadPluginWorker(startPluginWorker(directory), entry, identity.token, startup)
    workers.add(worker)
    try {
      const gateway = await prepareDevGateway(identity, worker.fetch, startup)
      return { gateway, requests: 0, worker }
    } catch (error) {
      closeWorker(worker)
      throw error
    }
  }

  try {
    watcher = await watchProject(directory, signal)
    watcher.on('all', () => {
      edits += 1
      wake?.()
    })
    watcher.on('error', (error) => {
      controller.abort(error)
      wake?.()
    })

    while (!signal.aborted) {
      const before = edits
      let next: Revision | undefined
      try {
        next = await prepare()
      } catch (error) {
        if (signal.aborted) break
        const message = (error instanceof Error ? error.message : String(error))
          .replaceAll(identity.sk, '[redacted]').replaceAll(identity.token, '[redacted]')
        if (before === edits) {
          if (!current) throw new CliError(`Could not load plugin: ${message}`)
          process.stderr.write(`Reload failed. Still serving the previous version. ${message}\n`)
        }
      }

      if (next) {
        if (signal.aborted || before !== edits) {
          closeWorker(next.worker)
        } else {
          const previous = current
          current = next
          if (previous?.requests === 0) closeWorker(previous.worker)
          if (!server) {
            server = createAdaptorServer({
              overrideGlobalObjects: false,
              fetch: async (request) => {
                const revision = current!
                revision.requests += 1
                try {
                  return await revision.gateway.fetch(request)
                } finally {
                  revision.requests -= 1
                  if (revision !== current && revision.requests === 0) closeWorker(revision.worker)
                }
              },
            })
            const listening = once(server, 'listening', { signal })
            server.listen(0, '127.0.0.1')
            await listening
            const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
            credentialDir = await mkdtemp(join(tmpdir(), 'tb-plugin-dev-'))
            const envFile = join(credentialDir, 'session.env')
            await writeFile(envFile, `export TB_BASE_URL=${shellQuote(baseUrl)}\nexport TB_SK=${shellQuote(identity.sk)}\n`, {
              flag: 'wx',
              mode: 0o600,
            })
            await chmod(envFile, 0o600)
            if (signal.aborted) break
            const source = `source ${shellQuote(envFile)}`
            if (json) {
              printLine(JSON.stringify({
                event: 'ready', envFile, source, mounts: next.gateway.mounts, manualExports: next.gateway.manualExports,
              }))
            } else {
              printLine('Local plugin gateway is ready. Run this in a second terminal:\n')
              printLine(`${source}\n`)
              listMounts(next.gateway)
              printLine('Press Ctrl-C to stop.')
            }
          } else if (json) {
            printLine(JSON.stringify({ event: 'reloaded', mounts: next.gateway.mounts, manualExports: next.gateway.manualExports }))
          } else {
            printLine('Reloaded plugin.')
            listMounts(next.gateway)
          }
        }
      }

      if (!signal.aborted && edits === before) {
        await new Promise<void>((done) => {
          wake = done
        })
        wake = undefined
      }
      if (!signal.aborted) await delay(150, undefined, { signal })
    }
  } catch (error) {
    if (!signal.aborted) throw error
  } finally {
    if (!signal.aborted) controller.abort()
    try {
      server?.close()
      if (server && 'closeAllConnections' in server) server.closeAllConnections()
      for (const worker of workers) closeWorker(worker)
      await watcher?.close()
    } finally {
      try {
        if (credentialDir) await rm(credentialDir, { recursive: true, force: true })
      } finally {
        process.off('SIGINT', stop)
        process.off('SIGTERM', stop)
        stopSignal?.removeEventListener('abort', stop)
      }
    }
  }
  if (signal.reason instanceof Error && signal.reason.name !== 'AbortError') throw signal.reason
}
