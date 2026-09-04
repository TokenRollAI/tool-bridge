#!/usr/bin/env node
import { chown, mkdir, readFile, writeFile } from 'node:fs/promises'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import writeFileAtomic from 'write-file-atomic'
import { randomBytes } from 'node:crypto'
import { Command } from 'commander'
import { join } from 'node:path'
import pRetry from 'p-retry'
import pkg from '../package.json' with { type: 'json' }
import { BootstrapStateStore } from './bootstrapState'

const program = new Command('tool-bridge-admin')
  .version(pkg.version)
  .description(
    'Local installation and recovery; requires access to the protected bootstrap directory',
  )
for (const mode of ['pair', 'recover'] as const) {
  program
    .command(mode)
    .option(
      '--directory <path>',
      'Protected bootstrap directory',
      process.env.TB_BOOTSTRAP_DIR ?? '/data/bootstrap',
    )
    .action(async (opts: { directory: string }) => {
      const store = new BootstrapStateStore(opts.directory)
      const token = await store.createLocalPairing(
        mode === 'pair' ? 'setup' : 'recovery',
      )
      process.stdout.write(token + '\n')
    })
}
program
  .command('init')
  .option(
    '--directory <path>',
    'Protected bootstrap directory',
    '/data/bootstrap',
  )
  .option(
    '--pg-secrets <path>',
    'PostgreSQL credential directory',
    '/secrets/postgres',
  )
  .option('--s3-secrets <path>', 'S3 credential directory', '/secrets/s3')
  .action(
    async (opts: {
      directory: string
      pgSecrets: string
      s3Secrets: string
    }) => {
      const store = new BootstrapStateStore(opts.directory)
      await store.initialize()
      await store.exclusive(async () => {
        if (await store.defaults()) return
        const password = randomBytes(32).toString('hex')
        const pgAdminPassword = randomBytes(32).toString('hex')
        const appKey = randomBytes(24).toString('hex')
        const appSecret = randomBytes(32).toString('hex')
        const adminKey = randomBytes(24).toString('hex')
        const adminSecret = randomBytes(32).toString('hex')
        await mkdir(opts.pgSecrets, { recursive: true, mode: 0o755 })
        await mkdir(opts.s3Secrets, { recursive: true, mode: 0o755 })
        // This service runs once as root; only PostgreSQL receives the password volume.
        await writeFileAtomic(
          join(opts.pgSecrets, 'password'),
          pgAdminPassword + '\n',
          { mode: 0o400 },
        )
        await chown(join(opts.pgSecrets, 'password'), 999, 999)
        await writeFileAtomic(
          join(opts.pgSecrets, '01-app.sql'),
          `CREATE ROLE toolbridge LOGIN PASSWORD '${password}';\nALTER DATABASE toolbridge OWNER TO toolbridge;\n`,
          { mode: 0o400 },
        )
        await chown(join(opts.pgSecrets, '01-app.sql'), 999, 999)
        const identities = [
          {
            name: 'installer',
            credentials: [{ accessKey: adminKey, secretKey: adminSecret }],
            actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
          },
          {
            name: 'tool-bridge',
            credentials: [{ accessKey: appKey, secretKey: appSecret }],
            actions: [
              'Read:tb-objects',
              'Write:tb-objects',
              'List:tb-objects',
              'Tagging:tb-objects',
            ],
          },
        ]
        await writeFileAtomic(
          join(opts.s3Secrets, 's3.json'),
          JSON.stringify({ identities }),
          { mode: 0o400 },
        )
        await chown(join(opts.s3Secrets, 's3.json'), 1000, 1000)
        await writeFileAtomic(
          join(opts.s3Secrets, 'admin.json'),
          JSON.stringify({
            accessKeyId: adminKey,
            secretAccessKey: adminSecret,
          }),
          { mode: 0o400 },
        )
        await store.write('install-defaults.json', {
          databaseUrl: `postgres://toolbridge:${password}@postgres:5432/toolbridge`,
          databaseAdminUrl: `postgres://postgres:${pgAdminPassword}@postgres:5432/toolbridge`,
          storage: {
            endpoint: 'http://objects:8333',
            bucket: 'tb-objects',
            region: 'us-east-1',
            accessKeyId: appKey,
            secretAccessKey: appSecret,
          },
        })
        for (const name of [
          'bootstrap.json',
          'identity.json',
          'keys.json',
          'pairing.json',
          'pairing-token',
          'install-defaults.json',
        ]) {
          await chown(store.path(name), 1000, 1000)
        }
        await chown(opts.directory, 1000, 1000)
        // Readiness marker contains no secrets and is written only after durable initialization.
        await writeFile(join(opts.s3Secrets, 'ready'), 'ready\n', {
          mode: 0o444,
        })
      })
    },
  )
program
  .command('init-bucket')
  .option(
    '--credentials <path>',
    'S3 installer credentials',
    '/secrets/s3/admin.json',
  )
  .option('--endpoint <url>', 'Exact local S3 endpoint', 'http://objects:8333')
  .action(async (opts: { credentials: string, endpoint: string }) => {
    const credentials = JSON.parse(
      await readFile(opts.credentials, 'utf8'),
    ) as { accessKeyId: string, secretAccessKey: string }
    const client = new S3Client({
      endpoint: opts.endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials,
      maxAttempts: 1,
    })
    try {
      await pRetry(
        async () => {
          try {
            await client.send(
              new CreateBucketCommand({ Bucket: 'tb-objects' }),
            )
          } catch (error) {
            if (
              !['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(
                (error as { name: string }).name,
              )
            )
              throw error
          }
        },
        { retries: 30, minTimeout: 500, maxTimeout: 2000 },
      )
    } finally {
      client.destroy()
    }
  })
try {
  await program.parseAsync()
} catch {
  console.error(
    'Local maintenance failed; check protected files and service connectivity.',
  )
  process.exitCode = 1
}
