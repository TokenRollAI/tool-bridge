import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'

/**
 * 等价闸门:每个迁移产物的 Zod schema 反推回 JSON Schema、归一、取指纹后,必须与迁移时
 * 记下的**上游指纹**逐 action 相等。
 *
 * 这是让批量迁移可信的东西。1329 个 provider 不可能靠人肉 review 保证契约没漂;这条测试
 * 把"翻译有没有改变接受集合"变成 CI 里的机器判定。有人手改了生成的 schema 想收紧或放宽,
 * 就必须在 handwritten.json 里显式登记 —— **漂移只能是声明过的,不能是意外的**。
 *
 * 比对前过 normalize,每条规则都是可论证保语义的(理由见各自位置)。normalize 与
 * `scripts/migrate/parity.mjs` 必须保持一致 —— 生成指纹与校验指纹用的是同一套规则,
 * 两边漂了会让全部指纹无故失配(此时 `normalizeVersion` 该 +1 并重新生成)。
 *
 * 收集用 `import.meta.glob` 而非 fs 遍历:本包 tsconfig 刻意不引 Node 类型(插件产物要能
 * 被任意宿主装载),测试也守同一条线。
 */

interface ActionSpec {
  description: string
  inputSchema: z.ZodType
  outputSchema: unknown
}

interface Fingerprints {
  actions: Record<string, { description: string, inputSchema?: string, outputSchema?: string }>
  normalizeVersion: number
  service: string
}

const SAFE_INT_MAX = 9007199254740991
const SAFE_INT_MIN = -9007199254740991

/** 与 scripts/migrate/fingerprint.mjs 生成指纹时的 normalize 规则版本对齐。 */
const NORMALIZE_VERSION = 1

const SCHEMAS = import.meta.glob<Record<string, unknown>>('../../src/*/schema.ts', { eager: true })
const SNAPSHOTS = import.meta.glob<Fingerprints>('../../src/*/upstream.snapshot.json', { eager: true })
const HANDWRITTEN = import.meta.glob<{ actions: string[] }>('../../src/*/handwritten.json', { eager: true })

const migrated = Object.keys(SNAPSHOTS).map(path => path.split('/').at(-2)!).sort()

function snapshotOf(service: string): Fingerprints {
  return SNAPSHOTS[`../../src/${service}/upstream.snapshot.json`]!
}

function handwrittenOf(service: string): string[] {
  return HANDWRITTEN[`../../src/${service}/handwritten.json`]?.actions ?? []
}

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
    // 空 `properties: {}` 一个属性都没声明,不构成约束;是 Zod 反推 record 型的固定产物。
    if (name === 'properties' && typeof value === 'object' && value !== null
      && Object.keys(value).length === 0) continue
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

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function fingerprint(schema: unknown): Promise<string> {
  return sha256(JSON.stringify(normalize(schema)))
}

it('至少有一个迁移产物(否则本闸门是空转的绿灯)', () => {
  expect(migrated.length).toBeGreaterThan(0)
})

describe.each(migrated)('%s', (service: string) => {
  const snapshot = snapshotOf(service)
  const handwritten = handwrittenOf(service)
  const names = Object.keys(snapshot.actions).sort()

  it('指纹的归一化规则版本与本测试一致(改了 normalize 须重新生成指纹)', () => {
    expect(snapshot.normalizeVersion).toBe(NORMALIZE_VERSION)
  })

  it('action 集合与上游一致(不多不少)', () => {
    expect(Object.keys(actionsOf(service)).sort()).toEqual(names)
  })

  for (const name of names) {
    const expected = snapshot.actions[name]!
    const exempt = handwritten.includes(name)
    it(exempt ? `${name}(手写豁免,只查存在性与 description)` : name, async () => {
      const spec = actionsOf(service)[name]
      expect(spec, `${service}.${name} 不在 schema.ts 的规格表里`).toBeDefined()
      // description 是给 agent 看的,迁移不得悄悄改写。
      await expect(sha256(spec!.description)).resolves.toBe(expected.description)
      if (exempt) return

      await expect(fingerprint(z.toJSONSchema(spec!.inputSchema, { io: 'input', unrepresentable: 'any' })))
        .resolves.toBe(expected.inputSchema)
      await expect(fingerprint(spec!.outputSchema)).resolves.toBe(expected.outputSchema)
    })
  }
})
