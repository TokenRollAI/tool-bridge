import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'

/**
 * 等价闸门:每个迁移产物的 Zod schema 反推回 JSON Schema 后,必须与迁移时的**上游快照**
 * 逐 action 等价。
 *
 * 这是让批量迁移可信的东西。1329 个 provider 不可能靠人肉 review 保证契约没漂;这条测试
 * 把"翻译有没有改变接受集合"变成 CI 里的机器判定。有人手改了生成的 schema 想收紧或放宽,
 * 就必须在 handwritten.json 里显式登记 —— **漂移只能是声明过的,不能是意外的**。
 *
 * 收集用 `import.meta.glob` 而非 fs 遍历:本包 tsconfig 刻意不引 Node 类型(插件产物要能
 * 被任意宿主装载),测试也守同一条线。
 */

interface ActionSpec {
  description: string
  inputSchema: z.ZodType
  outputSchema: unknown
}

interface Snapshot {
  actions: Array<{
    description: string
    inputSchema: unknown
    name: string
    outputSchema: unknown
  }>
  service: string
}

const SAFE_INT_MAX = 9007199254740991
const SAFE_INT_MIN = -9007199254740991

const SCHEMAS = import.meta.glob<Record<string, unknown>>('../../src/*/schema.ts', { eager: true })
const SNAPSHOTS = import.meta.glob<Snapshot>('../../src/*/upstream.snapshot.json', { eager: true })
const HANDWRITTEN = import.meta.glob<{ actions: string[] }>('../../src/*/handwritten.json', { eager: true })

/** 有 upstream.snapshot.json 的目录 = 迁移产物。 */
const migrated = Object.keys(SNAPSHOTS)
  .map(path => path.split('/').at(-2)!)
  .sort()

function snapshotOf(service: string): Snapshot {
  return SNAPSHOTS[`../../src/${service}/upstream.snapshot.json`]!
}

function handwrittenOf(service: string): string[] {
  return HANDWRITTEN[`../../src/${service}/handwritten.json`]?.actions ?? []
}

/** service → 该模块导出的 `<service>Actions` 规格表。 */
function actionsOf(service: string): Record<string, ActionSpec> {
  const mod = SCHEMAS[`../../src/${service}/schema.ts`]
  if (mod === undefined) throw new Error(`${service}: 没有 schema.ts`)
  const table = Object.entries(mod).find(([name]) => name.endsWith('Actions'))?.[1]
  if (table === undefined) throw new Error(`${service}: schema.ts 没有导出 <service>Actions 规格表`)
  return table as Record<string, ActionSpec>
}

/** `true` 与 `{}` 在 JSON Schema 里都表示"任意值"。 */
function isAnySchema(value: unknown): boolean {
  return value === true
    || (typeof value === 'object' && value !== null && Object.keys(value).length === 0)
}

function normalize(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(normalize)
  if (schema === null || typeof schema !== 'object') return schema

  const record = schema as Record<string, unknown>
  const isInteger = record.type === 'integer'
  const out: Record<string, unknown> = {}
  for (const name of Object.keys(record).sort()) {
    const value = record[name]
    if (name === '$schema') continue
    // required 的顺序不影响接受集合。
    if (name === 'required' && Array.isArray(value)) {
      out[name] = [...value].sort()
      continue
    }
    // 上游写 additionalProperties:true,Zod 的 looseObject 写 {} —— 同义。
    if (name === 'additionalProperties' && isAnySchema(value)) continue
    // z.record 会显式写 propertyNames:{type:'string'};JSON 对象的键本来只能是字符串。
    if (name === 'propertyNames' && JSON.stringify(value) === '{"type":"string"}') continue
    // z.email()/z.url() 除 format 外还带自校验正则。两边都在表达同一格式约束,差别是
    // 迁移后 Zod 会**真的执行**校验(上游走 rawInputSchema 时平台根本不校验)。
    if (name === 'pattern' && typeof record.format === 'string') continue
    // z.int() 强制 JS 安全整数范围;该范围外 number 本就无法精确表示。
    if (isInteger && name === 'maximum' && value === SAFE_INT_MAX) continue
    if (isInteger && name === 'minimum' && value === SAFE_INT_MIN) continue
    out[name] = normalize(value)
  }
  return out
}

it('至少有一个迁移产物(否则本闸门是空转的绿灯)', () => {
  expect(migrated.length).toBeGreaterThan(0)
})

describe.each(migrated)('%s', (service: string) => {
  const snapshot = snapshotOf(service)
  const handwritten = handwrittenOf(service)

  it('action 集合与上游一致(不多不少)', () => {
    expect(Object.keys(actionsOf(service)).sort())
      .toEqual(snapshot.actions.map(action => action.name).sort())
  })

  for (const action of snapshot.actions) {
    const exempt = handwritten.includes(action.name)
    it(exempt ? `${action.name}(手写豁免,只查存在性与 description)` : action.name, () => {
      const spec = actionsOf(service)[action.name]
      expect(spec, `${service}.${action.name} 不在 schema.ts 的规格表里`).toBeDefined()
      // description 是给 agent 看的,迁移不得悄悄改写。
      expect(spec!.description).toBe(action.description)
      if (exempt) return

      expect(normalize(z.toJSONSchema(spec!.inputSchema, { io: 'input', unrepresentable: 'any' })))
        .toEqual(normalize(action.inputSchema))
      expect(normalize(spec!.outputSchema)).toEqual(normalize(action.outputSchema))
    })
  }
})
