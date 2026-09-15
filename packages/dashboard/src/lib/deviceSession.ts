import type { HelpCmd } from './types'

/** A normal tool with similarly named commands must not become a process controller. */
export function sessionCommands(cmds: HelpCmd[]): { list: HelpCmd, observe: HelpCmd, start: HelpCmd, stop: HelpCmd } | null {
  const start = cmds.find(cmd => cmd.name === 'start')
  const list = cmds.find(cmd => cmd.name === 'list')
  const observe = cmds.find(cmd => cmd.name === 'observe')
  const stop = cmds.find(cmd => cmd.name === 'stop')
  const schema = start?.inputSchema
  if (!start || !list || !observe || !stop || !schema || typeof schema !== 'object') return null
  const record = schema as Record<string, unknown>
  const properties = record.properties
  if (!properties || typeof properties !== 'object' || !('expectedRuntimeId' in properties)) return null
  if (!Array.isArray(record.required) || !record.required.includes('expectedRuntimeId')) return null
  return { start, list, observe, stop }
}
