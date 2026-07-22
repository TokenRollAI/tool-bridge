import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { Command } from 'commander'
import type { Node, NodeConfig, NodeInput, Page } from '../types'
import { parsePageOpts, resolveTarget, withGlobalOpts, withPageOpts } from '../args'
import { guard, printJson, printLine, table } from '../output'
import { deleteNode, registerNode } from '../registry'
import { callTool, CliError } from '../http'

/**
 * `tb skill *` —— skillhub 命令族(与 device 并列的一等 kind:Agent Skill 仓库)。
 * 数据面 List/Get/Search + Publish/Remove 走 `POST /<hub>` `{tool,arguments}`;
 * mount/unmount 与 ctx.ts 同通道(`~register` / 管理面 `system/registry` delete)。
 * 每个 skill = 一个目录 <id>/SKILL.md(+ 文本文件),SKILL.md frontmatter 需含 name/description。
 */

const SKILL_DOC = 'SKILL.md'

/** 数据面 URI:去首尾斜杠后加前导 `/`。 */
function hubUri(hub: string): string {
  return `/${hub.replace(/^\/+|\/+$/g, '')}`
}

interface SkillSummary {
  description: string
  id: string
  name: string
  updatedAt?: string
  version?: string
}

interface SkillFileMeta {
  contentType: string
  path: string
  size?: number
  version: string
}

interface SkillDetail extends SkillSummary {
  content: string
  files: SkillFileMeta[]
}

interface SkillFile extends SkillFileMeta {
  content: string | unknown
}

interface GlobalOpts {
  baseUrl?: string
  json?: boolean
  sk?: string
}

function parsePositiveInt(value: unknown, flag: string): number | undefined {
  if (value === undefined || value === '') return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) {
    throw new CliError(`${flag} must be a positive integer`)
  }
  return n
}

/** 人类模式:skill 目录按行列出(id / name / description)。 */
function printSkills(page: Page<SkillSummary>): void {
  const items = page.items ?? []
  if (items.length === 0) {
    printLine('(no skills)')
    return
  }
  const rows = items.map(s => [s.id, s.name ?? '', s.description ?? ''])
  printLine(table(['ID', 'NAME', 'DESCRIPTION'], rows))
  if (page.cursor) printLine(`next cursor: ${page.cursor}`)
}

/** 递归读取本地目录下的全部文本文件为发布负载(跳过 dotfile 与 node_modules)。 */
function readSkillDir(dir: string): { content: string, path: string }[] {
  const out: { content: string, path: string }[] = []
  const readEntries = (cur: string) => {
    try {
      return readdirSync(cur, { withFileTypes: true })
    } catch (err) {
      throw new CliError(`cannot read directory "${cur}": ${(err as Error).message}`)
    }
  }
  const walk = (cur: string): void => {
    for (const ent of readEntries(cur)) {
      if (ent.name.startsWith('.')) continue // .git / .DS_Store / dotfiles
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules') continue
        walk(join(cur, ent.name))
        continue
      }
      if (!ent.isFile()) continue
      const abs = join(cur, ent.name)
      let content: string
      try {
        content = readFileSync(abs, 'utf8')
      } catch (err) {
        throw new CliError(
          `cannot read text file "${abs}" (binary not supported): ${(err as Error).message}`,
        )
      }
      out.push({ path: relative(dir, abs).split(sep).join('/'), content })
    }
  }
  walk(dir)
  return out
}

/** `tb skill ls <hub>` —— 列出已发布 skill(目录 name/description)。 */
export function skillLsCommand(): Command {
  return withPageOpts(withGlobalOpts(new Command('ls')))
    .description('List published skills in a skillhub')
    .argument('<hub>', 'Skillhub tree path')
    .action(async (hubArg: string, opts: GlobalOpts & { cursor?: string, limit?: string }) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const hub = String(hubArg ?? '').trim()
        if (!hub) throw new CliError('skillhub path is required')
        const callOpts = parsePageOpts(opts)
        const page = await callTool<Page<SkillSummary>>(resolveTarget(opts), hubUri(hub), 'List', {
          ...(Object.keys(callOpts).length ? { opts: callOpts } : {}),
        })
        if (asJson) printJson(page)
        else printSkills(page)
      })
    })
}

/** `tb skill get <hub> <id>` —— 读取 skill(SKILL.md + 清单);--out 拉到本地目录;--file 取单文件。 */
export function skillGetCommand(): Command {
  return withGlobalOpts(new Command('get'))
    .description('Read a skill (SKILL.md + file list); --out to download into a local dir')
    .argument('<hub>', 'Skillhub tree path')
    .argument('<id>', 'Skill id')
    .option('--file <path>', 'Fetch one bundled file; mutually exclusive with --out')
    .option('--out <dir>', 'Download the whole skill; mutually exclusive with --file')
    .action(
      async (hubArg: string, idArg: string, opts: GlobalOpts & { file?: string, out?: string }) => {
        const asJson = Boolean(opts.json)
        await guard(asJson, async () => {
          const hub = String(hubArg ?? '').trim()
          if (!hub) throw new CliError('skillhub path is required')
          const id = String(idArg ?? '').trim()
          if (!id) throw new CliError('skill id is required')
          if (opts.file && opts.out) throw new CliError('--file and --out are mutually exclusive')
          const target = resolveTarget(opts)

          // --file:取单个 bundled 文件。
          if (opts.file) {
            const file = await callTool<SkillFile>(target, hubUri(hub), 'Get', {
              id,
              file: String(opts.file),
            })
            if (asJson) {
              printJson(file)
              return
            }
            const content = file.content
            if (typeof content === 'string') printLine(content.replace(/\n$/, ''))
            else if (content && typeof content === 'object' && '$ref' in content) {
              process.stderr.write('large object, download via URL\n')
              printLine(String((content as { $ref: unknown }).$ref))
            } else printJson(content)
            return
          }

          const detail = await callTool<SkillDetail>(target, hubUri(hub), 'Get', { id })

          // --out:把整包写到本地目录(SKILL.md 用 detail.content,其余逐文件取)。
          if (opts.out) {
            const outDir = String(opts.out)
            let written = 0
            for (const f of detail.files) {
              const dest = join(outDir, f.path.split('/').join(sep))
              mkdirSync(dirname(dest), { recursive: true })
              if (f.path === SKILL_DOC) {
                writeFileSync(dest, detail.content, 'utf8')
                written++
                continue
              }
              const one = await callTool<SkillFile>(target, hubUri(hub), 'Get', {
                id,
                file: f.path,
              })
              if (typeof one.content === 'string') {
                writeFileSync(dest, one.content, 'utf8')
                written++
              } else {
                process.stderr.write(`skipped non-text file (served as $ref): ${f.path}\n`)
              }
            }
            if (asJson) printJson({ ok: true, id, out: outDir, files: written })
            else printLine(`pulled skill '${id}' → ${outDir} (${written} files)`)
            return
          }

          if (asJson) {
            printJson(detail)
            return
          }
          printLine(detail.content.replace(/\n$/, ''))
          if (detail.files.length > 0) {
            process.stderr.write(`\nfiles: ${detail.files.map(f => f.path).join(', ')}\n`)
          }
        })
      },
    )
}

/** `tb skill search <hub> <query>` —— 按 id/name/description 检索 skill。 */
export function skillSearchCommand(): Command {
  return withPageOpts(withGlobalOpts(new Command('search')))
    .description('Search skills by id / name / description')
    .argument('<hub>', 'Skillhub tree path')
    .argument('<query>', 'Search query')
    .action(
      async (
        hubArg: string,
        queryArg: string,
        opts: GlobalOpts & { cursor?: string, limit?: string },
      ) => {
        const asJson = Boolean(opts.json)
        await guard(asJson, async () => {
          const hub = String(hubArg ?? '').trim()
          if (!hub) throw new CliError('skillhub path is required')
          const query = String(queryArg ?? '').trim()
          if (!query) throw new CliError('query is required')
          const callOpts = parsePageOpts(opts)
          const page = await callTool<Page<SkillSummary>>(
            resolveTarget(opts),
            hubUri(hub),
            'Search',
            {
              query,
              ...(Object.keys(callOpts).length ? { opts: callOpts } : {}),
            },
          )
          if (asJson) printJson(page)
          else printSkills(page)
        })
      },
    )
}

/** `tb skill publish <hub> <dir>` —— 从本地目录发布/替换一个 skill(须含 SKILL.md)。 */
export function skillPublishCommand(): Command {
  return withGlobalOpts(new Command('publish'))
    .description('Publish/replace a skill from a local directory (must contain SKILL.md)')
    .argument('<hub>', 'Skillhub tree path')
    .argument('<dir>', 'Local skill directory')
    .option('--id <id>', 'Skill id (default: slug from SKILL.md frontmatter name)')
    .action(async (hubArg: string, dirArg: string, opts: GlobalOpts & { id?: string }) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const hub = String(hubArg ?? '').trim()
        if (!hub) throw new CliError('skillhub path is required')
        const dir = String(dirArg ?? '').trim()
        if (!dir) throw new CliError('skill directory is required')
        const files = readSkillDir(dir)
        if (!files.some(f => f.path === SKILL_DOC)) {
          throw new CliError(`directory "${dir}" has no ${SKILL_DOC} at its root`)
        }
        const result = await callTool<{ fileCount: number, id: string, name: string }>(
          resolveTarget(opts),
          hubUri(hub),
          'Publish',
          { ...(opts.id ? { id: String(opts.id) } : {}), files },
        )
        if (asJson) printJson(result)
        else printLine(`published skill '${result.id}' (${result.fileCount} files)`)
      })
    })
}

/** `tb skill rm <hub> <id>` —— 删除一个 skill 及其全部文件。 */
export function skillRmCommand(): Command {
  return withGlobalOpts(new Command('rm'))
    .description('Delete a skill and all its files')
    .argument('<hub>', 'Skillhub tree path')
    .argument('<id>', 'Skill id')
    .action(async (hubArg: string, idArg: string, opts: GlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const hub = String(hubArg ?? '').trim()
        if (!hub) throw new CliError('skillhub path is required')
        const id = String(idArg ?? '').trim()
        if (!id) throw new CliError('skill id is required')
        await callTool(resolveTarget(opts), hubUri(hub), 'Remove', { id })
        if (asJson) printJson({ ok: true, id })
        else printLine(`removed skill '${id}'`)
      })
    })
}

/**
 * `tb skill mount <path>` —— 挂载一个 skillhub(NodeRegistry.Write{kind:'skillhub'} via ~register)。
 * provider 缺省 r2(平台自带桶,无需外部凭证);s3 需 --endpoint/--bucket/--auth-ref。
 */
export function skillMountCommand(): Command {
  return withGlobalOpts(new Command('mount'))
    .description('Mount a skillhub (r2 by default; s3 optional)')
    .argument('<path>', 'Tree path to mount at')
    .option('--provider <provider>', 'Storage provider: r2 | s3 (default r2)')
    .option('--description <desc>', 'One-line node description (default: auto-generated)')
    .option('--auth-ref <ref>', 'SecretStore ref for credentials ([s3] required)')
    .option('--read-only', 'Reject write verbs (Publish/Remove)')
    .option('--ttl <seconds>', 'Node TTL in seconds (expired node is reclaimed)')
    .option('--prefix <prefix>', 'Key prefix inside the bucket')
    .option('--endpoint <url>', '[s3] S3-compatible endpoint URL')
    .option('--bucket <bucket>', '[s3] bucket name')
    .option('--region <region>', '[s3] region')
    .action(
      async (
        pathArg: string,
        opts: GlobalOpts & {
          authRef?: string
          bucket?: string
          description?: string
          endpoint?: string
          prefix?: string
          provider?: string
          readOnly?: boolean
          region?: string
          ttl?: string
        },
      ) => {
        const asJson = Boolean(opts.json)
        await guard(asJson, async () => {
          const path = String(pathArg ?? '').trim()
          if (!path) throw new CliError('tree path is required')
          const provider = String(opts.provider ?? 'r2').trim()
          const authRef = opts.authRef ? String(opts.authRef) : undefined
          const prefix = opts.prefix ? String(opts.prefix) : undefined
          const ttl = parsePositiveInt(opts.ttl, '--ttl')

          let providerConfig: Record<string, unknown> | undefined
          if (provider === 'r2') {
            if (opts.endpoint || opts.bucket || opts.region || authRef) {
              throw new CliError('--endpoint/--bucket/--region/--auth-ref only apply to s3')
            }
            if (prefix) providerConfig = { prefix }
          } else if (provider === 's3') {
            const endpoint = String(opts.endpoint ?? '').trim()
            if (!endpoint) throw new CliError('--endpoint is required for --provider s3')
            const bucket = String(opts.bucket ?? '').trim()
            if (!bucket) throw new CliError('--bucket is required for --provider s3')
            if (!authRef) throw new CliError('--auth-ref is required for --provider s3')
            providerConfig = {
              endpoint,
              bucket,
              ...(opts.region ? { region: String(opts.region) } : {}),
              ...(prefix ? { prefix } : {}),
            }
          } else {
            throw new CliError(`invalid --provider "${provider}"; valid: r2, s3`)
          }

          const config: NodeConfig = {
            kind: 'skillhub',
            provider,
            ...(providerConfig ? { providerConfig } : {}),
            ...(authRef ? { authRef } : {}),
            ...(opts.readOnly ? { readOnly: true } : {}),
            ...(ttl !== undefined ? { ttl } : {}),
          }
          const input: NodeInput = {
            path,
            kind: 'skillhub',
            // 网关要求 description 非空;缺省派生一条,免得挂载即被拒。
            description: opts.description ? String(opts.description) : `skillhub at ${path}`,
            config,
          }
          const node = await registerNode(resolveTarget(opts), input)
          if (asJson) printJson(node as Node)
          else printLine(`mounted skillhub at ${path} (provider ${provider})`)
        })
      },
    )
}

/** `tb skill unmount <path>` —— 卸载 skillhub 节点(管理面 system/registry delete)。 */
export function skillUnmountCommand(): Command {
  return withGlobalOpts(new Command('unmount'))
    .description('Unmount a skillhub')
    .argument('<path>', 'Tree path to remove')
    .action(async (pathArg: string, opts: GlobalOpts) => {
      const asJson = Boolean(opts.json)
      await guard(asJson, async () => {
        const path = String(pathArg ?? '').trim()
        if (!path) throw new CliError('tree path is required')
        await deleteNode(resolveTarget(opts), path, ['skillhub'])
        if (asJson) printJson({ ok: true, path })
        else printLine(`unmounted skillhub: ${path}`)
      })
    })
}

export function skillCommand(): Command {
  return new Command('skill')
    .description('Skillhub: publish & fetch Agent Skills (mount a hub, then publish/get skills)')
    .addHelpText(
      'after',
      `
Examples:
  tb skill mount skills/team                       # r2, no external credentials
  tb skill publish skills/team ./my-skill-dir      # dir must contain SKILL.md
  tb skill ls skills/team
  tb skill get skills/team my-skill --out ~/.claude/skills/my-skill
  tb skill search skills/team "pdf"`,
    )
    .addCommand(skillLsCommand())
    .addCommand(skillGetCommand())
    .addCommand(skillSearchCommand())
    .addCommand(skillPublishCommand())
    .addCommand(skillRmCommand())
    .addCommand(skillMountCommand())
    .addCommand(skillUnmountCommand())
}
