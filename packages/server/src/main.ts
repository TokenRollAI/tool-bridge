#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { Command } from 'commander'
import pkg from '../package.json' with { type: 'json' }
import { createManagedServer } from './managedServer'

const program = new Command('tool-bridge-server')
  .version(pkg.version)
  .description(
    'Node self-hosted service with protected setup and PostgreSQL configuration',
  )
  .option(
    '--directory <path>',
    'Protected bootstrap directory',
    process.env.TB_BOOTSTRAP_DIR ?? '/data/bootstrap',
  )
  .option(
    '--port <number>',
    'Listening port (otherwise managed bootstrap port)',
    process.env.PORT,
  )
  .action(async (opts: { directory: string, port?: string }) => {
    const port = opts.port === undefined ? undefined : Number(opts.port)
    if (
      port !== undefined
      && (!Number.isInteger(port) || port < 1 || port > 65535)
    )
      throw new Error('port must be a valid TCP port')
    const server = await createManagedServer({
      directory: opts.directory,
      ...(existsSync('/app/dashboard/index.html')
        ? { uiDir: '/app/dashboard' }
        : {}),
      ...(port === undefined ? {} : { port }),
    })
    try {
      const started = await server.start()
      console.log(
        JSON.stringify({ event: 'tool_bridge_listening', port: started.port }),
      )
    } catch {
      console.error(JSON.stringify({ event: 'tool_bridge_start_failed' }))
      await server.close()
      process.exitCode = 1
      return
    }
    let stopping = false
    const shutdown = () => {
      if (stopping) return
      stopping = true
      server.startDraining()
      void server.close().then(
        () => process.exit(0),
        () => process.exit(1),
      )
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  })
try {
  await program.parseAsync()
} catch {
  console.error(
    'Service could not start; check the protected bootstrap directory and listening port.',
  )
  process.exitCode = 1
}
