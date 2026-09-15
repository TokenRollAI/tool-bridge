import type { HelpCmd } from './types'
import { useToolHelp } from './queries'

/** Node help is an index. Only plausible session tools hydrate their start schema. */
export function useProcessSessionCommands(path: string, cmds: HelpCmd[]): HelpCmd[] {
  const start = cmds.find(cmd => cmd.name === 'start')
  const quartet = ['start', 'list', 'observe', 'stop'].every(name => cmds.some(cmd => cmd.name === name))
  const needsSchema = quartet && start?.inputSchema === undefined
  const help = useToolHelp(path, 'start', needsSchema)
  const detail = needsSchema && !help.isError
    ? help.data?.cmds.find(cmd => cmd.name === 'start' && cmd.path === start?.path)
    : undefined
  // Keep the authorized index authoritative for identity, effect and confirmation.
  // A failed/missing detail must never turn a similarly named tool into a controller.
  if (detail?.inputSchema === undefined) return cmds
  return cmds.map(cmd => cmd.name === 'start' ? { ...cmd, inputSchema: detail.inputSchema } : cmd)
}
