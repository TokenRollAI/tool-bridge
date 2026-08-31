/**
 * JSON Schema 归一化 —— 等价闸门的**唯一**规则真源。
 *
 * 生成指纹(scripts/migrate)与校验指纹(test/migration/schemaParity.test.ts)必须用
 * 同一套规则,否则全部指纹会无故失配。此前两处各持一份靠注释对拍,现在收成这一个纯函数
 * 模块,两边 import 同一份;测试侧的类型由旁边的 normalizeSchema.d.mts 提供(本包测试
 * 刻意不引 Node 类型,纯 .mjs + 声明文件不破坏这条线)。
 *
 * normalize 里每一条都必须是**可论证保语义**的(理由写在各自位置),不是"抹平差异"。
 * 任何会改变接受集合的差异都必须暴露出来 —— 那正是等价闸门存在的意义。
 */

/** 归一化规则版本:改了 normalize 就该 +1,提示全部指纹需重新对齐。 */
export const NORMALIZE_VERSION = 1

/** JS 安全整数边界:Zod 的 z.int() 会把它写进 schema,上游不写。 */
const SAFE_INT_MAX = 9007199254740991
const SAFE_INT_MIN = -9007199254740991

function isAnySchema(value) {
  // `true` 与 `{}` 在 JSON Schema 里都表示"任意值",互为等价写法。
  return value === true || (value !== null && typeof value === 'object' && Object.keys(value).length === 0)
}

/** 递归归一:排序键、排序 required、剥掉等价写法带来的噪声。 */
export function normalize(schema) {
  if (Array.isArray(schema)) return schema.map(normalize)
  if (schema === null || typeof schema !== 'object') return schema

  const isInteger = schema.type === 'integer'
  const out = {}
  for (const name of Object.keys(schema).sort()) {
    const value = schema[name]
    if (name === '$schema') continue

    // required 的顺序不影响接受集合。
    if (name === 'required' && Array.isArray(value)) {
      out[name] = [...value].sort()
      continue
    }

    // 上游写 `additionalProperties: true`,Zod 的 looseObject 写 `{}` —— 同义。
    if (name === 'additionalProperties' && isAnySchema(value)) continue

    // 空 `properties: {}` 不构成任何约束(一个属性都没声明),是 Zod 反推 record 型
    // schema 时的固定产物;上游对同一形状不写这个键。
    if (name === 'properties' && typeof value === 'object' && value !== null
      && Object.keys(value).length === 0) continue
    // Zod 的 z.record(z.string(), X) 会显式写出 `propertyNames: {type:'string'}`;
    // JSON 对象的键**本来就**只能是字符串,这是同义反复,不构成约束差异。
    if (name === 'propertyNames' && JSON.stringify(value) === '{"type":"string"}') continue

    // Zod 的 z.email()/z.uuid()/z.url() 等格式构造器除了写 `format`,还会写出自带的
    // 校验正则。上游只声明 `format`,把是否真校验交给验证器。两边都在表达"必须是该格式",
    // 只是迁移后由 Zod 的正则**确实执行**校验 —— 这是本次迁移刻意要拿到的收紧
    // (上游走 rawInputSchema 时平台根本不校验),不是漂移。仅在 format 存在时豁免 pattern,
    // 手写的 pattern 照常参与比对。
    if (name === 'pattern' && typeof schema.format === 'string') continue

    // Zod 的 z.int() 强制 JS 安全整数范围并写进 schema;上游只写 type:integer。
    // 差异是真实的(超过 2^53-1 的整数 Zod 会拒、上游不拒),但那个范围之外 JS 的
    // number 本来就无法精确表示,провider 也不可能正确处理 —— 按等价计,不算漂移。
    if (isInteger && name === 'maximum' && value === SAFE_INT_MAX) continue
    if (isInteger && name === 'minimum' && value === SAFE_INT_MIN) continue

    out[name] = normalize(value)
  }
  return out
}
