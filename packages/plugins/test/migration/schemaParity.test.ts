import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { normalize, NORMALIZE_VERSION } from '../../scripts/migrate/normalizeSchema.mjs'
import RAW_FINGERPRINTS from '../../migration-fingerprints.json'

/**
 * 等价闸门:每个迁移产物的 Zod schema 反推回 JSON Schema、归一、取指纹后,必须与迁移时
 * 记下的**上游指纹**逐 action 相等。
 *
 * 这是让批量迁移可信的东西。1329 个 provider 不可能靠人肉 review 保证契约没漂;这条测试
 * 把"翻译有没有改变接受集合"变成 CI 里的机器判定。有人手改了生成的 schema 想收紧或放宽,
 * 就必须在 handwritten.json 里显式登记 —— **漂移只能是声明过的,不能是意外的**。
 *
 * 比对前过 normalize,规则与生成指纹的 scripts/migrate 共用同一份
 * `normalizeSchema.mjs`(纯 .mjs + 声明文件,不引 Node 类型);改了规则该
 * `NORMALIZE_VERSION` +1 并重新生成全部指纹。
 *
 * 指纹存在**一份** `migration-fingerprints.json`(不是每个 provider 目录各一个):后者会让
 * 每次迁移都在 `src/<service>/` 里多出一个与业务代码无关的文件。"哪些 provider 是迁移产物"
 * 现在由这份清单的 key 列表判定。
 *
 * schema 模块用 `import.meta.glob` 而非 fs 遍历:本包 tsconfig 刻意不引 Node 类型
 * (插件产物要能被任意宿主装载),测试也守同一条线。
 */

interface ActionSpec {
  description: string
  inputSchema: z.ZodType
  outputSchema: unknown
}

interface ActionFingerprint {
  description: string
  inputSchema?: string
  outputSchema?: string
}

/**
 * `migration-fingerprints.json` 的形状:全部已迁 provider 的指纹存在一份文件里。
 * 显式标注而不是直接吃 JSON 的推断类型 —— 推断出来的是每个 key 的字面量联合,
 * 加一个 provider 就会让下面的索引访问在类型上变化,读代码时看不出契约是什么。
 */
const FINGERPRINTS: {
  normalizeVersion: number
  providers: Record<string, { actions: Record<string, ActionFingerprint> }>
} = RAW_FINGERPRINTS

const SCHEMAS = import.meta.glob<Record<string, unknown>>('../../src/*/schema.ts', { eager: true })
const HANDWRITTEN = import.meta.glob<{ actions: string[] }>('../../src/*/handwritten.json', { eager: true })

const migrated = Object.keys(FINGERPRINTS.providers).sort()

function actionFingerprintsOf(service: string): Record<string, ActionFingerprint> {
  return FINGERPRINTS.providers[service]!.actions
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

it('指纹清单的归一化规则版本与 normalize 模块一致(改了 normalize 须 +1 并重新生成全部指纹)', () => {
  expect(FINGERPRINTS.normalizeVersion).toBe(NORMALIZE_VERSION)
})

describe.each(migrated)('%s', (service: string) => {
  const fingerprints = actionFingerprintsOf(service)
  const handwritten = handwrittenOf(service)
  const names = Object.keys(fingerprints).sort()

  it('action 集合与上游一致(不多不少)', () => {
    expect(Object.keys(actionsOf(service)).sort()).toEqual(names)
  })

  for (const name of names) {
    const expected = fingerprints[name]!
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
