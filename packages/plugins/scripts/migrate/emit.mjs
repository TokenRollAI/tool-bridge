/**
 * 生成 `src/<service>/schema.ts`:该 provider 全部 action 的 Zod 声明 + 语义标注。
 *
 * 产物是**我们自己的源码**,进仓库、可读、可改、可 review —— 迁移的目的就是这个。
 * 生成后可以随便手改(改 description、收紧 schema、修 effect);改过的 action 登记进
 * `handwritten.json` 即可豁免等价闸门的自动比对,重新生成时也会被跳过。
 */

import { toZod } from './jsonSchemaToZod.mjs'

/** 明确的只读前缀。effect 上游没有这个轴,这里只是**播种**,生成后由人校正。 */
const READ_PREFIXES = [
  'check_', 'count_', 'describe_', 'download_', 'export_', 'fetch_', 'find_',
  'generate_', 'get_', 'identify_', 'list_', 'read_', 'retrieve_', 'search_',
]
const DESTRUCTIVE_PREFIXES = ['cancel_', 'delete_', 'destroy_', 'purge_', 'remove_', 'revoke_']

function seedEffect(name) {
  if (DESTRUCTIVE_PREFIXES.some(p => name.startsWith(p))) return 'destructive'
  if (READ_PREFIXES.some(p => name.startsWith(p))) return 'read'
  return 'write'
}

/** snake_case → camelCase(导出的 schema 常量名)。 */
function camel(name) {
  return name.replace(/_([a-z0-9])/g, (_m, c) => c.toUpperCase())
}

function block(text, indentDepth) {
  const pad = '  '.repeat(indentDepth)
  return text.split('\n').map(l => (l === '' ? l : pad + l)).join('\n')
}

/**
 * @param {{service: string, displayName: string, actions: object[]}} provider
 * @param {Set<string>} handwritten 已手写、不再自动生成的 action 名
 */
export function emitSchemaModule(provider, handwritten = new Set()) {
  const skipped = provider.actions.filter(a => handwritten.has(a.name))

  const lines = [
    '/**',
    ` * ${provider.displayName} 各 action 的入参/出参 Zod schema 与语义标注。`,
    ' *',
    ' * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:',
    ' * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的',
    ' * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。',
    ' *',
    ' * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀',
    ' * destructive、其余 write),保守取值,以人工校正为准。',
    ' */',
    '',
    'import { z } from \'zod/v4\'',
    '',
  ]

  if (skipped.length > 0) {
    lines.push(
      `// 手写豁免(见 handwritten.json):${skipped.map(a => a.name).join(', ')}`,
      '',
    )
  }

  const specEntries = []
  for (const action of provider.actions) {
    const base = camel(action.name)
    if (handwritten.has(action.name)) {
      specEntries.push({ name: action.name, base, handwritten: true, action })
      continue
    }
    lines.push(
      `export const ${base}Input = ${toZod(action.inputSchema, `${action.id}.input`)}`,
      '',
      `export const ${base}Output = ${toZod(action.outputSchema, `${action.id}.output`)}`,
      '',
    )
    specEntries.push({ name: action.name, base, handwritten: false, action })
  }

  const handwrittenNames = specEntries.filter(e => e.handwritten)
  if (handwrittenNames.length > 0) {
    lines.push(
      `import { ${handwrittenNames.map(e => `${e.base}Input, ${e.base}Output`).join(', ')} } from './schema.handwritten'`,
      '',
    )
  }

  lines.push(
    '/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */',
    `export const ${camel(provider.service)}Actions = {`,
  )
  for (const entry of specEntries) {
    lines.push(block([
      `${JSON.stringify(entry.name)}: {`,
      `  description: ${JSON.stringify(entry.action.description)},`,
      `  effect: ${JSON.stringify(seedEffect(entry.name))},`,
      `  inputSchema: ${entry.base}Input,`,
      `  outputSchema: z.toJSONSchema(${entry.base}Output, { io: 'output', unrepresentable: 'any' }),`,
      '},',
    ].join('\n'), 1))
  }
  lines.push('} as const', '')

  return lines.join('\n')
}
