/**
 * 工具虚拟化(Virtualize,mcp/http 适用)。
 *
 * 对外只暴露虚拟名,请求时反查上游真名。这是 **core 纯逻辑**:输入
 * `(Virtualize, ToolSpec[])`,输出 `{exposed, reverse}`,无 I/O、可 100% 分支覆盖。
 *
 * 应用顺序(定型):
 *   1. hide:`hide` 列表中的**原名**从 exposed 剔除,且不进 reverse(不可见、不可调用)。
 *   2. rename:`rename[原名]` → 虚拟名。
 *   3. prefix:再套前缀——**纯字符串拼接**,平台不注入分隔符(分隔符由配置者自带,惯例 "ns__")。
 *   4. describe:`describe[原名]` override 上游 description。
 */

import type { Virtualize } from '../types'
import type { ToolSpec } from './types'
import { TBError } from '../errors'

export interface VirtualizeResult {
  /** 对外暴露的工具(虚拟名 + override 后的 description)。 */
  exposed: ToolSpec[]
  /** 虚拟名 → 上游原名;调用侧反查。hidden 工具不在其中。 */
  reverse: Map<string, string>
}

/** 计算虚拟名:先 rename 再 prefix(纯拼接)。 */
function virtualName(v: Virtualize, upstreamName: string): string {
  const renamed = v.rename?.[upstreamName] ?? upstreamName
  return v.prefix !== undefined ? `${v.prefix}${renamed}` : renamed
}

/**
 * 应用 Virtualize 到上游工具集,产出对外 `exposed` 与反查 `reverse`。
 * `v` 缺省(无虚拟化)时原样暴露、reverse 为恒等映射。
 */
export function virtualizeTools(v: Virtualize | undefined, upstream: ToolSpec[]): VirtualizeResult {
  const exposed: ToolSpec[] = []
  const reverse = new Map<string, string>()
  const hidden = new Set(v?.hide ?? [])

  for (const tool of upstream) {
    if (hidden.has(tool.name)) continue
    const name = v ? virtualName(v, tool.name) : tool.name
    const description = v?.describe?.[tool.name] ?? tool.description
    exposed.push({ ...tool, name, description })
    reverse.set(name, tool.name)
  }

  return { exposed, reverse }
}

/**
 * 由虚拟名反查上游原名。`source` 可传上游 `ToolSpec[]`(内部现算虚拟化)或已算好的
 * `reverse` Map。查不到(含 hidden / rename 后原名已失效)→ TBError not_found
 * (deny==not_found:不泄露隐藏工具的存在性)。
 */
export function resolveUpstreamTool(
  v: Virtualize | undefined,
  source: ToolSpec[] | Map<string, string>,
  virtualName: string,
): string {
  const reverse = source instanceof Map ? source : virtualizeTools(v, source).reverse
  const upstream = reverse.get(virtualName)
  if (upstream === undefined) {
    throw TBError.notFound(`未知工具:'${virtualName}'`)
  }
  return upstream
}
