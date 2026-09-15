import {
  createShellSessionBinding,
  createStructuredCommandRuntime,
  type ProcessSessionBinding,
  processSessionCommands,
  type StructuredCommandProfile,
} from '@tool-bridge/core/node'
import { type DeviceExpose, normalizePath, validatePath } from '@tool-bridge/core'
import { CliError } from './http'

export function deviceSessionBindings(
  profiles: readonly StructuredCommandProfile[],
  shellSessionPath?: string,
  shell?: DeviceExpose['shell'],
): ProcessSessionBinding[] {
  const bindings = profiles.flatMap(profile => createStructuredCommandRuntime(profile).sessionBindings)
  if (shellSessionPath !== undefined) {
    if (shell === undefined) throw new CliError('--shell-session-path requires shell exposure')
    const path = normalizePath(shellSessionPath)
    if (path === '') throw new CliError('shell session path must not be root')
    bindings.push(createShellSessionBinding(path, shell.allow))
  }
  return bindings
}

/** Reused by installation and live runtime so frozen profiles cannot bypass collisions. */
export function assertDeviceSessionPaths(
  profiles: readonly StructuredCommandProfile[],
  bindings: readonly ProcessSessionBinding[],
  extraPaths: readonly string[] = [],
): void {
  const paths = ['shell', 'fs', ...profiles.map(profile => profile.path), ...bindings.map(binding => binding.path), ...extraPaths]
  for (const [index, path] of paths.entries()) {
    if (validatePath(path) !== null || normalizePath(path) !== path || path === '') throw new CliError(`invalid device path '${path}'`)
    for (const other of paths.slice(0, index)) {
      if (path === other || path.startsWith(`${other}/`) || other.startsWith(`${path}/`)) {
        throw new CliError(`device path '${path}' conflicts with '${other}'`)
      }
    }
  }
}

export function sessionExposeNodes(bindings: readonly ProcessSessionBinding[]): NonNullable<DeviceExpose['nodes']> {
  return bindings.map(binding => ({
    path: binding.path,
    kind: 'tool',
    description: binding.description ?? 'Device process sessions',
    cmds: processSessionCommands(binding),
  }))
}
