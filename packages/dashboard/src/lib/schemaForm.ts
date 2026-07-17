/**
 * inputSchema 的表单友好性检测与 JSON 骨架生成(CmdPanel 的 rjsf 兜底判定)。
 * rjsf 对缺 items 的 array 等形状渲染 "Unsupported field" 错误——这类 cmd 直接落
 * JSON 编辑模式,并按 schema 生成参数骨架作为起点。
 */

interface SchemaObj {
  additionalProperties?: unknown
  allOf?: unknown
  anyOf?: unknown
  default?: unknown
  enum?: unknown
  items?: unknown
  oneOf?: unknown
  properties?: Record<string, unknown>
  required?: unknown
  type?: unknown
}

function asObj(v: unknown): SchemaObj | null {
  return typeof v === 'object' && v !== null ? (v as SchemaObj) : null
}

/** rjsf 能否无错渲染该 schema(保守判定:发现一处不友好即 false)。 */
export function isFormFriendly(schema: unknown, depth = 0): boolean {
  const s = asObj(schema)
  if (!s) return false
  if (depth > 6) return true
  // 组合子:rjsf 支持但复杂度高;anyOf/oneOf 常见于 mcp 派生 schema,保守放行 rjsf 处理。
  if (s.type === 'array' && s.items === undefined) return false
  if (s.items !== undefined && !isFormFriendly(s.items, depth + 1)) return false
  if (s.properties) {
    for (const v of Object.values(s.properties)) {
      if (!isFormFriendly(v, depth + 1)) return false
    }
  }
  return true
}

/** 按 schema 生成参数骨架(JSON 编辑模式的起点;只展开 required 之外的一层 properties)。 */
export function skeletonFromSchema(schema: unknown, depth = 0): unknown {
  const s = asObj(schema)
  if (!s) return {}
  if (s.default !== undefined) return s.default
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0]
  switch (s.type) {
    case 'string':
      return ''
    case 'number':
    case 'integer':
      return 0
    case 'boolean':
      return false
    case 'array':
      return []
    case 'object': {
      if (depth > 3 || !s.properties) return {}
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(s.properties)) {
        out[k] = skeletonFromSchema(v, depth + 1)
      }
      return out
    }
    default:
      return {}
  }
}
