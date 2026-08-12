/* eslint-disable @typescript-eslint/no-use-before-define --
 * objectExpr/arrayExpr 与 toZod 是互递归(JSON Schema 本身是递归结构),无论怎么排都有
 * 一方"先用后定义"。排成 helper 在前、递归入口 toZod 在后,读起来是"零件 → 装配"。
 */

/**
 * JSON Schema → Zod v4 源码。
 *
 * 这是迁移流水线里唯一"聪明"的一步,也是决定产物是不是**真 tool-bridge 代码**的一步:
 * 上游 provider 的 schema 是用它自家的 `s.*` builder 手写的 JSON Schema,而 tool-bridge 的
 * 作者面是 Zod(`OperationRegistry` 用 `z.toJSONSchema` 反推 JSON Schema、并**真正校验入参**)。
 * 不做这步就只能走 `rawInputSchema` 逃生阀 —— 那条路平台不校验入参,等于把 1300 个
 * provider 的入参防线整体拆掉。
 *
 * 覆盖面不是猜的:上游 `core/json-schema.ts` 的 builder 能产出的关键字是**有限集合**,
 * 这里逐条对着它写。遇到表外关键字**直接抛** —— 静默降级成 `z.unknown()` 会让契约悄悄
 * 变宽,而这正是本流程要防的事。
 *
 * 产物是**源码字符串**,不是运行时对象:迁移的目的就是让仓库里躺着可读、可改、可 review
 * 的 Zod 声明,而不是又一层运行时转换。
 */

/** JSON Schema `format` → Zod v4 的专用构造器。 */
const STRING_FORMATS = {
  'date': 'z.iso.date()',
  'date-time': 'z.iso.datetime({ offset: true })',
  'email': 'z.email()',
  'ipv4': 'z.ipv4()',
  'ipv6': 'z.ipv6()',
  'uri': 'z.url()',
  'uuid': 'z.uuid()',
}

/** 这些关键字由下面的逻辑显式处理,不参与"未知关键字"判定。 */
const HANDLED = new Set([
  '$defs', '$ref', 'additionalProperties', 'anyOf', 'const', 'default', 'description',
  'enum', 'exclusiveMinimum', 'format', 'items', 'maxItems', 'maxLength', 'maximum',
  'minItems', 'minLength', 'minimum', 'oneOf', 'prefixItems', 'properties', 'required',
  'type', 'uniqueItems',
])

function quote(value) {
  return JSON.stringify(value)
}

/** 合法 JS 标识符可以裸写做对象键,否则加引号。 */
function propertyKey(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : quote(name)
}

function indent(text, depth) {
  const pad = '  '.repeat(depth)
  return text.split('\n').map(line => (line === '' ? line : pad + line)).join('\n')
}

/** `anyOf: [X, {type:'null'}]` 是上游 `s.nullable()` 的固定形状,还原成 `.nullable()`。 */
function splitNullable(schemas) {
  const rest = schemas.filter(schema => schema.type !== 'null')
  return rest.length > 0 && rest.length < schemas.length ? rest : null
}

function assertKnownKeywords(schema, path) {
  for (const name of Object.keys(schema)) {
    if (!HANDLED.has(name)) {
      throw new Error(
        `${path}: 未支持的 JSON Schema 关键字 '${name}' —— 请在 jsonSchemaToZod.mjs 里显式处理,`
        + ' 不要让它静默丢失(契约会悄悄变宽)',
      )
    }
  }
}

/** 把 description/default 挂到已生成的表达式上。 */
function decorate(expr, schema) {
  let out = expr
  if (schema.default !== undefined) out += `.default(${quote(schema.default)})`
  if (typeof schema.description === 'string' && schema.description !== '') {
    out += `.describe(${quote(schema.description)})`
  }
  return out
}

function objectExpr(schema, path, depth) {
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const names = Object.keys(properties)
  const additional = schema.additionalProperties

  // 无 properties 的 `additionalProperties: <schema>` 就是 record(上游 s.record)。
  if (names.length === 0 && additional !== undefined && typeof additional === 'object') {
    return `z.record(z.string(), ${toZod(additional, `${path}.additionalProperties`, depth)})`
  }
  if (names.length === 0 && additional === true) return 'z.looseObject({})'
  if (names.length === 0) return 'z.strictObject({})'

  const entries = names.map((name) => {
    const expr = toZod(properties[name], `${path}.${name}`, depth + 1)
    return `${propertyKey(name)}: ${required.has(name) ? expr : `${expr}.optional()`},`
  })
  const body = `{\n${indent(entries.join('\n'), 1)}\n}`

  // additionalProperties 三态直译:true=loose、schema=catchall、false 或缺省=strict
  // (上游 object() 的缺省就是 false)。三者经 z.toJSONSchema 分别还原,等价闸门能判。
  if (additional === true) return `z.looseObject(${body})`
  if (typeof additional === 'object' && additional !== null) {
    return `z.object(${body}).catchall(${toZod(additional, `${path}.additionalProperties`, depth)})`
  }
  return `z.strictObject(${body})`
}

function stringExpr(schema, path) {
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.every(value => typeof value === 'string')) {
      throw new Error(`${path}: enum 含非字符串值,请显式处理`)
    }
    return `z.enum([${schema.enum.map(quote).join(', ')}])`
  }
  if (schema.format !== undefined && STRING_FORMATS[schema.format] === undefined) {
    throw new Error(`${path}: 未支持的 string format '${schema.format}'`)
  }
  let expr = schema.format !== undefined ? STRING_FORMATS[schema.format] : 'z.string()'
  if (typeof schema.minLength === 'number') expr += `.min(${schema.minLength})`
  if (typeof schema.maxLength === 'number') expr += `.max(${schema.maxLength})`
  if (typeof schema.pattern === 'string') expr += `.regex(new RegExp(${quote(schema.pattern)}))`
  return expr
}

function numberExpr(schema, isInteger) {
  let expr = isInteger ? 'z.int()' : 'z.number()'
  if (typeof schema.minimum === 'number') expr += `.min(${schema.minimum})`
  if (typeof schema.maximum === 'number') expr += `.max(${schema.maximum})`
  if (typeof schema.exclusiveMinimum === 'number') expr += `.gt(${schema.exclusiveMinimum})`
  return expr
}

function arrayExpr(schema, path, depth) {
  if (Array.isArray(schema.prefixItems)) {
    const items = schema.prefixItems.map((item, i) => toZod(item, `${path}[${i}]`, depth + 1))
    return `z.tuple([${items.join(', ')}])`
  }
  const items = schema.items === undefined
    ? 'z.unknown()'
    : toZod(schema.items, `${path}[]`, depth + 1)
  let expr = `z.array(${items})`
  if (typeof schema.minItems === 'number') expr += `.min(${schema.minItems})`
  if (typeof schema.maxItems === 'number') expr += `.max(${schema.maxItems})`
  return expr
}

/**
 * 单个 JSON Schema → Zod 表达式源码。`path` 只用于报错定位,`depth` 用于缩进。
 */
export function toZod(schema, path = '$', depth = 0) {
  if (schema === true) return 'z.unknown()'
  if (schema === false) return 'z.never()'
  if (typeof schema !== 'object' || schema === null) {
    throw new Error(`${path}: 不是合法 JSON Schema`)
  }
  assertKnownKeywords(schema, path)

  if (typeof schema.$ref === 'string') {
    throw new Error(
      `${path}: 出现 $ref(${schema.$ref})。$defs/$ref 需要先决定 Zod 侧的复用形态`
      + '(提取成共享常量),当前批次的 provider 都没有,故不臆造实现',
    )
  }

  const union = schema.anyOf ?? schema.oneOf
  if (Array.isArray(union)) {
    // anyOf/oneOf **与 type/properties 同级共存**时,组合子只是在基础对象上再加一层约束
    // (典型:`anyOf: [{required:['html']},{required:['text']}]` = 二选一必填)。Zod 侧要写成
    // `.refine()`,而 refine 无法反推进 JSON Schema —— 生成出来等价闸门判不了,契约会悄悄变宽。
    // 故这里硬失败,交由人工写这一个 schema(见 MIGRATION.md 的"已知需要手写的形状")。
    const siblings = Object.keys(schema).filter(
      name => !['anyOf', 'default', 'description', 'oneOf'].includes(name),
    )
    if (siblings.length > 0) {
      throw new Error(
        `${path}: anyOf/oneOf 与 ${siblings.join('/')} 同级共存,组合约束无法由 Zod 反推回`
        + ' JSON Schema。这个 schema 需要手写(并在 handwritten.json 里登记豁免)',
      )
    }
    const nonNull = splitNullable(union)
    if (nonNull !== null) {
      const inner = nonNull.length === 1
        ? toZod(nonNull[0], path, depth)
        : `z.union([${nonNull.map((s, i) => toZod(s, `${path}|${i}`, depth + 1)).join(', ')}])`
      return decorate(`${inner}.nullable()`, schema)
    }
    const members = union.map((s, i) => toZod(s, `${path}|${i}`, depth + 1))
    return decorate(`z.union([${members.join(', ')}])`, schema)
  }

  if (schema.const !== undefined) return decorate(`z.literal(${quote(schema.const)})`, schema)
  // 只有 description、没有 type(上游 s.unknown()):任意值。
  if (schema.type === undefined) return decorate('z.unknown()', schema)
  if (Array.isArray(schema.type)) {
    throw new Error(`${path}: 未支持的联合 type ${JSON.stringify(schema.type)}`)
  }

  switch (schema.type) {
    case 'object': return decorate(objectExpr(schema, path, depth), schema)
    case 'array': return decorate(arrayExpr(schema, path, depth), schema)
    case 'string': return decorate(stringExpr(schema, path), schema)
    case 'integer': return decorate(numberExpr(schema, true), schema)
    case 'number': return decorate(numberExpr(schema, false), schema)
    case 'boolean': return decorate('z.boolean()', schema)
    case 'null': return decorate('z.null()', schema)
    default: throw new Error(`${path}: 未支持的 type '${schema.type}'`)
  }
}
