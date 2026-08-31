/**
 * 等价闸门:生成的 Zod 反推回 JSON Schema,与上游逐 action 比对。
 *
 * 这是让批量迁移可信的东西 —— 契约有没有在翻译中漂移是**机器判定**的,不靠人肉 review
 * 1329 个 provider。比对前两边过同一个 normalize(规则住在 normalizeSchema.mjs,
 * 与校验侧 test/migration/schemaParity.test.ts 共用同一份):JSON Schema 有多种等价写法,
 * 不归一就会被噪声淹没,看不见真分歧。
 */

import { z } from 'zod/v4'

/** 生成的 Zod 源码 → JSON Schema(受控作用域求值,z 是唯一自由变量)。 */
export function evalZod(source) {
  const factory = new Function('z', `return (${source})`)
  return factory(z)
}

export function toJsonSchema(source, io) {
  return z.toJSONSchema(evalZod(source), { io, unrepresentable: 'any' })
}
