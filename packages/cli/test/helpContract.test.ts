import type { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import { buildProgram } from '../src/program'

function commandAt(...names: string[]): Command {
  let command = buildProgram()
  for (const name of names) {
    const child = command.commands.find(candidate => candidate.name() === name)
    if (!child) throw new Error(`command not found: ${names.join(' ')}`)
    command = child
  }
  command.configureHelp({ ...command.configureHelp(), helpWidth: 200 })
  return command
}

function fullHelpAt(...names: string[]): string {
  const command = commandAt(...names)
  let output = ''
  command.configureOutput({ writeOut: value => (output += value) })
  command.outputHelp()
  return output
}

describe('CLI help 参数契约', () => {
  it('组级 help 展示祖先全局参数', () => {
    const help = fullHelpAt('sk')
    expect(help).toContain('Global Options:')
    expect(help).toContain('--base-url <url>')
    expect(help).toContain('--json')
  })

  it.each([
    ['connect', ['connect']],
    ['mount fs', ['mount', 'fs']],
  ] as const)('%s 明确长驻命令拒绝 --timeout，且 URL 两种来源互斥', (_label, path) => {
    const help = commandAt(...path).helpInformation()
    expect(help).toContain('Not supported for this long-running command; rejected if passed')
    expect(help).toContain('Gateway base URL (mutually exclusive with positional [url])')
    expect(help).toContain('mutually exclusive with --base-url')
  })

  it('connect 标明 shell/fs 参数依赖与互斥关系', () => {
    const help = commandAt('connect').helpInformation()
    expect(help).toContain('mutually exclusive with --no-shell')
    expect(help).toContain('mutually exclusive with --allow')
    expect(help).toContain('requires at least one --fs')
  })

  it('tool/ctx mount 标明认证依赖、provider 边界与自动描述', () => {
    const toolHelp = commandAt('tool', 'mount').helpInformation()
    expect(toolHelp.match(/requires --auth-ref/g)).toHaveLength(2)
    expect(toolHelp).toContain('One-line node description (default: auto-generated)')

    const ctxHelp = commandAt('ctx', 'mount').helpInformation()
    expect(ctxHelp).toContain('[s3] required; [plugin] optional')
    expect(ctxHelp).toContain('[r2/s3] key prefix')
    expect(ctxHelp).toContain('One-line node description (default: auto-generated)')

    const serverHelp = fullHelpAt('server', 'add')
    expect(serverHelp).toContain('Required remote HTBP server URL')
    expect(serverHelp).toContain('One-line node description (default: derived from remote URL)')
    expect(serverHelp).toContain('Migration: remote URL uses --remote-url')

    const serverLsHelp = fullHelpAt('server', 'ls')
    expect(serverLsHelp).toContain(
      '--limit/--cursor require system/registry visibility',
    )
    expect(serverLsHelp.match(/--base-url <url>/g)).toHaveLength(1)
  })

  it('tree/skill/sk help 标明取值范围与互斥关系', () => {
    expect(commandAt('tree').helpInformation()).toContain('1-8 (default: 2)')

    const skillGetHelp = commandAt('skill', 'get').helpInformation()
    expect(skillGetHelp).toContain('mutually exclusive with --out')
    expect(skillGetHelp).toContain('mutually exclusive with --file')

    expect(commandAt('skill', 'mount').helpInformation()).toContain(
      'One-line node description (default: auto-generated)',
    )

    const skUpdateHelp = commandAt('sk', 'update').helpInformation()
    expect(skUpdateHelp).toContain('mutually exclusive with --enable')
    expect(skUpdateHelp).toContain('mutually exclusive with --disable')
  })
})
