import { mkdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { Command } from 'commander'
import pluginSdk from '../../../plugin-sdk/package.json' with { type: 'json' }
import { printJson, printLine } from '../output'
import { withGlobalOpts } from '../args'
import { CliError } from '../http'

const starter = `import { createPlugin } from '@tool-bridge/plugin-sdk'
import { z } from 'zod/v4'

const plugin = createPlugin({ token: env => env.PLUGIN_TOKEN })

plugin.tools('actions', { description: 'Example tools' })
  .auth({ kind: 'none' })
  .register('greet', {
    description: 'Greet someone by name',
    effect: 'read',
    inputSchema: z.object({ name: z.string().min(1) }),
  }, ({ name }) => ({ message: \`Hello, \${name}!\` }))

export default plugin
`

const host = `import { serve } from '@hono/node-server'
import plugin from './index.js'

const token = process.env.PLUGIN_TOKEN
if (!token) throw new Error('Set PLUGIN_TOKEN before starting the plugin server.')

serve({
  hostname: '0.0.0.0',
  port: Number(process.env.PORT ?? 8080),
  fetch: request => plugin.fetch(request, { PLUGIN_TOKEN: token }),
})
`

const dockerfile = `FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src/ ./src/
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
`

function readme(name: string, version: string): string {
  return `# Develop this Tool Bridge plugin

Use Node.js 22 or newer. From this directory, install the dependencies and start
a local gateway.

\`\`\`sh
npm install --ignore-scripts
tb plugin dev
\`\`\`

To try an SDK built locally, replace the install command with
\`npm install --ignore-scripts /path/to/tool-bridge-plugin-sdk.tgz\`.

Run the printed \`source\` command in a second terminal. It loads the loopback
URL and session key from a private temporary file. Ctrl-C removes the file.

\`\`\`sh
tb tree dev
tb help dev/actions
tb call dev/actions/greet '{"name":"Ada"}'
\`\`\`

Change the greeting or add a new \`plugin.tools(...)\` or \`plugin.context(...)\`
export in \`src/index.js\`, then save. The dev session mounts ready-to-use tool and Context exports at
\`dev/<export-id>\`. Repeat a help or call command to try the update. When a
reload fails, the previous plugin remains active. Ctrl-C shuts down the session.

The entry is selected by \`package.json#main\` and exports a default object with
\`fetch(request, env)\`. The dev process supplies \`env.PLUGIN_TOKEN\`. Use normal
Node.js module resolution and explicit file extensions for relative imports.
For native TypeScript entries, use Node.js 22.18 or newer and erasable syntax.
Restart after installing or changing dependencies.

Exports that need upstream credentials or required mount fields are registered
for manual mounting. Use \`tb secret set\` and \`tb tool mount\` or \`tb ctx mount\`
with \`--provider dev --export <export-id>\` against the dev gateway. Mounts are
recreated on reload. Keys and secrets live in memory for the whole session.
Event exports use manual binding on a gateway that supports event topics.

Only run plugin code you trust. It runs with your OS permissions in a separate
process with a reduced environment.

## Prepare an installable release

The starter includes release metadata in \`package.json#toolBridgePlugin\` and
the standalone \`tool-bridge-plugin.json\`. Replace the example values with
your plugin ID, version and artifact. Keep the two manifests in sync when
publishing the same release through both channels.

Choose one way to run each release.

- **Hosted service**. Run \`npm start\` with \`PLUGIN_TOKEN\` supplied by your
  host. Set \`endpoint\` to the independent, version-specific HTTPS URL,
  such as \`https://plugins.example.com/${name}/${version}\`. Route the
  version URL to that service and strip any prefix before forwarding. The
  gateway checks \`GET /healthz\`, \`GET /~describe\` and authenticated
  \`HEAD /~auth\`. Use a plugin-sdk release with the \`/~auth\` check.
- **Container image**. Run \`npm install --ignore-scripts\` to create the lockfile,
  then build with the included Dockerfile. Publish the image to your registry
  and replace \`endpoint\` with \`image\` in the manifests. Use the actual full
  OCI digest, for example
  \`registry.example.com/tools/${name}@sha256:${'a'.repeat(64)}\`.
  The deployment administrator approves that digest in the gateway's plugin
  runner. The image listens on port 8080 and receives \`PLUGIN_TOKEN\` from
  the runner.

Publish the metadata through either channel.

- **npm**. Choose a unique public package name and remove \`private: true\`
  before publishing. The package version must equal the exact
  \`toolBridgePlugin.version\`. The gateway reads this field from the registry.
- **GitHub**. Attach \`tool-bridge-plugin.json\` to a public GitHub Release
  with a fixed tag, for example \`v${version}\`.

Use a separate shell targeting your deployment gateway. The same bearer value
that the service or runner receives as \`PLUGIN_TOKEN\` goes into an existing
gateway secret reference. The installing key needs admin access to
\`system/plugin\` and \`system/secret\`.

\`\`\`sh
tb secret set --name plugin-transport < /path/to/plugin-token
\`\`\`

For a hosted release, run one of these install commands.

\`\`\`sh
tb plugin install 'npm:${name}@${version}' --secret-ref plugin-transport --origin 'https://plugins.example.com'
\`\`\`

\`\`\`sh
tb plugin install 'github:example-org/${name}@v${version}' --secret-ref plugin-transport --origin 'https://plugins.example.com'
\`\`\`

For an approved OCI release, use the source containing your pinned image
manifest, for example a separate GitHub Release.

\`\`\`sh
tb plugin install 'github:example-org/${name}@v${version}-oci' --secret-ref plugin-transport
\`\`\`

After installation, mount and call the example.

\`\`\`sh
tb tool mount plugins/${name} --kind tool --provider ${name} --export actions
tb call plugins/${name}/greet '{"name":"Ada"}'
\`\`\`
`
}

export async function initPlugin(dir: string): Promise<string> {
  const destination = resolve(dir)
  // Claim the destination atomically, including when its parent already exists.
  try {
    await mkdir(destination)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new CliError(`plugin directory already exists: ${destination}`)
    }
    throw err
  }

  const name = basename(destination).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 128).replace(/-$/, '') || 'tb-plugin'
  const version = '0.1.0'
  const release = {
    schemaVersion: 'tb-plugin-release/v1',
    id: name,
    version,
    endpoint: `https://plugins.example.com/${name}/${version}`,
    healthPath: '/healthz',
  }
  const manifest = {
    name,
    version,
    private: true,
    type: 'module',
    main: './src/index.js',
    scripts: { start: 'node src/server.js' },
    files: ['src', 'tool-bridge-plugin.json'],
    engines: { node: '>=22' },
    dependencies: { '@hono/node-server': '^1.19.7', '@tool-bridge/plugin-sdk': pluginSdk.version, 'zod': '^4.2.0' },
    toolBridgePlugin: release,
  }
  await mkdir(resolve(destination, 'src'))
  for (const [file, content] of Object.entries({
    'package.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'tool-bridge-plugin.json': `${JSON.stringify(release, null, 2)}\n`,
    '.gitignore': 'node_modules/\n.env\n',
    '.dockerignore': '*\n!package.json\n!package-lock.json\n!src/\n!src/**\n',
    'Dockerfile': dockerfile,
    'README.md': readme(name, version),
    'src/index.js': starter,
    'src/server.js': host,
  })) {
    await writeFile(resolve(destination, file), content, { flag: 'wx' })
  }
  return destination
}

export function pluginInitCommand() {
  return withGlobalOpts(new Command('init'))
    .description('Create a new plugin project without installing dependencies')
    .argument('<dir>', 'New project directory')
    .action(async (dir, opts) => {
      if (opts.baseUrl !== undefined || opts.sk !== undefined || opts.timeout !== undefined) {
        throw new CliError('plugin init is a local command')
      }
      const directory = await initPlugin(dir)
      if (opts.json) printJson({ directory })
      else {
        printLine(`Created plugin project in ${directory}`)
        printLine('In that directory, run npm install --ignore-scripts, then tb plugin dev.')
      }
    })
}

export function pluginDevCommand() {
  return withGlobalOpts(new Command('dev'))
    .description('Run your plugin on an isolated loopback gateway and reload it on save')
    .argument('[dir]', 'Plugin project directory', '.')
    .action(async (dir, opts) => {
      if (opts.baseUrl !== undefined || opts.sk !== undefined || opts.timeout !== undefined) {
        throw new CliError('plugin dev creates its own local gateway')
      }
      const { runPluginDev } = await import('../plugin-dev/session')
      await runPluginDev(dir, opts.json)
    })
}

export function pluginDevWorkerCommand() {
  return new Command('_dev-worker').action(async () => {
    const { runPluginWorker } = await import('../plugin-dev/worker')
    await runPluginWorker()
  })
}
