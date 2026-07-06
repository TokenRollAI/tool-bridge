/**
 * shell 命令白名单匹配器(Proto §6.2「shell 命令白名单」,规范性)。
 *
 * 规则:allow 缺省/空数组 = 拒绝一切(默认拒);单值 ['*'] = 放行全部;其余对 command
 * 做 shell-word 切分取 argv[0] 的 basename,与条目精确匹配;白名单非 ['*'] 时 command
 * 含 shell 元字符(; | & $( 反引号 > <)→ 直接拒——不封元字符则 `echo hi; rm -rf`
 * 可绕过任何 argv[0] 判定。判定在设备侧执行前完成(shellExecutor 调用本函数)。
 */

/** 单字符元字符;`$(` 是双字符序列,单独判。 */
const SHELL_METACHARS = [';', '|', '&', '`', '>', '<'] as const

function hasShellMetachar(command: string): boolean {
  if (command.includes('$(')) return true
  return SHELL_METACHARS.some((c) => command.includes(c))
}

/** 全放行仅限单值 ['*'];`['*','echo']` 中的 '*' 是普通条目(匹配不到任何 basename)。 */
function isAllowAll(allow: readonly string[]): boolean {
  return allow.length === 1 && allow[0] === '*'
}

/**
 * shell-word 切分取 argv[0]:引号包裹(' / ")取引号内整词,否则取首个空白分隔词;
 * 空命令 / 未闭合引号 → null(拒)。
 */
function argv0(command: string): string | null {
  const trimmed = command.trimStart()
  if (trimmed === '') return null
  const quote = trimmed[0]
  if (quote === "'" || quote === '"') {
    const end = trimmed.indexOf(quote, 1)
    if (end < 0) return null
    return trimmed.slice(1, end)
  }
  const match = /^\S+/.exec(trimmed)
  return match ? match[0] : null
}

/** 取路径 basename('/bin/echo' → 'echo');尾 '/'(目录形态)→ null(拒)。 */
function basename(word: string): string | null {
  const name = word.slice(word.lastIndexOf('/') + 1)
  return name === '' ? null : name
}

/** command 是否被白名单放行(语义见模块头注释)。 */
export function isCommandAllowed(command: string, allow: readonly string[] | undefined): boolean {
  if (!allow || allow.length === 0) return false
  if (isAllowAll(allow)) return true
  if (hasShellMetachar(command)) return false
  const word = argv0(command)
  if (word === null) return false
  const name = basename(word)
  if (name === null) return false
  return allow.includes(name)
}

/** allow 的人读描述(进 shell 节点 ~help 的 exec cmd `h` 行,Proto §6.3)。 */
export function describeAllow(allow: readonly string[] | undefined): string {
  if (!allow || allow.length === 0) return '允许命令: 无(默认拒绝一切)'
  if (isAllowAll(allow)) return '允许命令: *'
  return `允许命令: ${allow.join(', ')};其余拒绝`
}
