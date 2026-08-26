/**
 * Linux 设备的结构化命令 profile：固定 executable + argv 模板，显式 effect，
 * 使用 spawn(shell:false) 执行。它不读取/解析 shell 字符串，也不改变 shell/exec 的危险等级。
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { z } from 'zod/v4'
import type { DeviceAbortSignal } from '../device/client'
import type { ToolSpec } from '../tool/types'
import {
  SHELL_EXEC_DEFAULT_TIMEOUT_MS,
  SHELL_OUTPUT_LIMIT_BYTES,
  SHELL_TIMEOUT_EXIT_CODE,
} from './shellExecutor'
import {
  executeProcess,
  type ProcessExecutionResult,
  type SpawnedProcess,
} from './processExecution'
import { canonicalizePath, canonicalizeSegment } from '../tree/path'
import { OperationRegistry } from '../operation/registry'
import { TBError } from '../errors'

export const STRUCTURED_COMMAND_PROFILE_VERSION = 1
export const STRUCTURED_COMMAND_MAX_OUTPUT_BYTES = 10 * 1024 * 1024

export type StructuredCommandEffect = 'read' | 'write' | 'destructive'
export type StructuredCommandArgumentType = 'string' | 'number' | 'boolean'

export interface StructuredCommandArgument {
  /** string 参数允许的精确值集合。 */
  choices?: string[]
  description?: string
  /** 非 boolean 参数存在时先追加该固定 flag；boolean=true 时只追加 flag。 */
  flag?: string
  /** 调用 body 的字段名。 */
  input: string
  /** true 时输入必须是同类型数组，并按模板位置依次展开。 */
  multiple?: boolean
  required?: boolean
  type?: StructuredCommandArgumentType
}

export type StructuredCommandArgvItem = string | StructuredCommandArgument

export interface StructuredCommandDefinition {
  argv?: StructuredCommandArgvItem[]
  confirm?: boolean
  cwd?: string
  description: string
  effect: StructuredCommandEffect
  executable: string
  /** 仅按名称继承设备进程环境；profile 不持久化值。 */
  inheritEnv?: string[]
  maxOutputBytes?: number
  name: string
  timeoutMs?: number
}

export interface StructuredCommandProfile {
  commands: StructuredCommandDefinition[]
  description: string
  path: string
  version: 1
}

export type StructuredCommandSpawnFn = (
  executable: string,
  argv: string[],
  opts: { cwd?: string, env: NodeJS.ProcessEnv, shell: false },
) => SpawnedProcess

export interface StructuredCommandRuntime {
  cmds: ToolSpec[]
  description: string
  invoke(
    command: string,
    args: Record<string, unknown>,
    opts?: { signal?: DeviceAbortSignal },
  ): Promise<ProcessExecutionResult>
  path: string
  profile: StructuredCommandProfile
}

export interface StructuredCommandRuntimeOptions {
  env?: NodeJS.ProcessEnv
  spawn?: StructuredCommandSpawnFn
}

const PROCESS_EXECUTION_OUTPUT_SCHEMA = {
  type: 'object',
  required: [
    'startedAt',
    'completedAt',
    'stdout',
    'stderr',
    'exitCode',
    'outcome',
    'stdoutTruncated',
    'stderrTruncated',
  ],
  properties: {
    startedAt: { type: 'string', format: 'date-time' },
    completedAt: { type: 'string', format: 'date-time' },
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    exitCode: { type: 'integer' },
    outcome: { type: 'string', enum: ['exited', 'signaled', 'timed_out'] },
    signal: { type: 'string' },
    stdoutTruncated: { type: 'boolean' },
    stderrTruncated: { type: 'boolean' },
  },
  additionalProperties: false,
} as const

const envNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
const argumentSchema = z.strictObject({
  input: z.string().min(1),
  description: z.string().min(1).optional(),
  flag: z.string().min(1).optional(),
  choices: z.array(z.string()).min(1).optional(),
  multiple: z.boolean().optional(),
  required: z.boolean().optional(),
  type: z.enum(['string', 'number', 'boolean']).optional(),
})
const commandSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  executable: z.string().min(1),
  argv: z.array(z.union([z.string(), argumentSchema])).optional(),
  cwd: z.string().min(1).optional(),
  effect: z.enum(['read', 'write', 'destructive']),
  confirm: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(SHELL_EXEC_DEFAULT_TIMEOUT_MS).optional(),
  maxOutputBytes: z.number().int().positive().max(STRUCTURED_COMMAND_MAX_OUTPUT_BYTES).optional(),
  inheritEnv: z.array(envNameSchema).optional(),
})
const profileSchema = z.strictObject({
  version: z.literal(STRUCTURED_COMMAND_PROFILE_VERSION),
  path: z.string().min(1),
  description: z.string().min(1),
  commands: z.array(commandSchema).min(1),
})

function invalidProfile(message: string): TBError {
  return new TBError('invalid_argument', `invalid structured command profile: ${message}`)
}

function noNul(value: string, label: string): void {
  if (value.includes('\0')) throw invalidProfile(`${label} contains NUL`)
}

/** 未知字段拒绝；标识符统一 canonicalize，破坏性命令强制 confirm。 */
export function parseStructuredCommandProfile(value: unknown): StructuredCommandProfile {
  const parsed = profileSchema.safeParse(value)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ')
    throw invalidProfile(detail)
  }
  let path: string
  try {
    path = canonicalizePath(parsed.data.path)
  } catch (error) {
    throw invalidProfile(error instanceof Error ? error.message : String(error))
  }
  if (path === '') throw invalidProfile('path must not be root')

  const commandNames = new Set<string>()
  const commands = parsed.data.commands.map((raw, commandIndex): StructuredCommandDefinition => {
    if (raw.name.includes('/')) throw invalidProfile(`command name '${raw.name}' contains '/'`)
    let name: string
    try {
      name = canonicalizeSegment(raw.name)
    } catch (error) {
      throw invalidProfile(error instanceof Error ? error.message : String(error))
    }
    if (commandNames.has(name)) throw invalidProfile(`duplicate command '${name}'`)
    commandNames.add(name)
    noNul(raw.executable, `commands.${commandIndex}.executable`)
    if (raw.cwd !== undefined) noNul(raw.cwd, `commands.${commandIndex}.cwd`)

    const inputs = new Set<string>()
    const argv = (raw.argv ?? []).map((item, itemIndex): StructuredCommandArgvItem => {
      if (typeof item === 'string') {
        noNul(item, `commands.${commandIndex}.argv.${itemIndex}`)
        return item
      }
      noNul(item.input, `commands.${commandIndex}.argv.${itemIndex}.input`)
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(item.input)) {
        throw invalidProfile(`argument input '${item.input}' is not a safe JSON field name`)
      }
      if (inputs.has(item.input)) throw invalidProfile(`duplicate argument input '${item.input}'`)
      inputs.add(item.input)
      if (item.flag !== undefined) noNul(item.flag, `commands.${commandIndex}.argv.${itemIndex}.flag`)
      const type = item.type ?? 'string'
      if (type === 'boolean' && item.flag === undefined) {
        throw invalidProfile(`boolean argument '${item.input}' requires flag`)
      }
      if (type !== 'string' && item.choices !== undefined) {
        throw invalidProfile(`choices are only valid for string argument '${item.input}'`)
      }
      for (const [choiceIndex, choice] of (item.choices ?? []).entries()) {
        noNul(choice, `commands.${commandIndex}.argv.${itemIndex}.choices.${choiceIndex}`)
      }
      return { ...item, type }
    })
    if (raw.effect === 'destructive' && raw.confirm === false) {
      throw invalidProfile(`destructive command '${name}' cannot set confirm:false`)
    }
    return {
      ...raw,
      name,
      argv,
      ...(raw.effect === 'destructive' ? { confirm: true } : {}),
    }
  })
  return {
    version: STRUCTURED_COMMAND_PROFILE_VERSION,
    path,
    description: parsed.data.description,
    commands,
  }
}

function valueSchema(argument: StructuredCommandArgument): z.ZodType {
  let schema: z.ZodType
  const type = argument.type ?? 'string'
  if (type === 'boolean') schema = z.boolean()
  else if (type === 'number') schema = z.number().finite()
  else if (argument.choices !== undefined) schema = z.enum(argument.choices as [string, ...string[]])
  else schema = z.string()
  if (type === 'string') {
    schema = schema.refine(value => !(value as string).includes('\0'), 'must not contain NUL')
  }
  if (argument.multiple === true) schema = z.array(schema).min(argument.required === true ? 1 : 0)
  if (argument.description !== undefined) schema = schema.describe(argument.description)
  return argument.required === true ? schema : schema.optional()
}

function inputSchema(definition: StructuredCommandDefinition): z.ZodType {
  const shape: Record<string, z.ZodType> = {}
  for (const item of definition.argv ?? []) {
    if (typeof item !== 'string') shape[item.input] = valueSchema(item)
  }
  return z.strictObject(shape)
}

function appendArgument(argv: string[], argument: StructuredCommandArgument, raw: unknown): void {
  if (raw === undefined || raw === false) return
  const values = argument.multiple === true ? raw as unknown[] : [raw]
  for (const value of values) {
    if (argument.type === 'boolean') {
      if (value === true) argv.push(argument.flag!)
      continue
    }
    if (argument.flag !== undefined) argv.push(argument.flag)
    argv.push(String(value))
  }
}

function argvFor(
  definition: StructuredCommandDefinition,
  args: Record<string, unknown>,
): string[] {
  const argv: string[] = []
  for (const item of definition.argv ?? []) {
    if (typeof item === 'string') argv.push(item)
    else appendArgument(argv, item, args[item.input])
  }
  return argv
}

/** 缺省环境白名单刻意不含 TB_SK、token 或云凭证。 */
const DEFAULT_INHERITED_ENV = [
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'PATH',
  'TMPDIR',
  'TZ',
  'USER',
] as const

function environmentFor(
  definition: StructuredCommandDefinition,
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const name of new Set([...DEFAULT_INHERITED_ENV, ...(definition.inheritEnv ?? [])])) {
    const value = source[name]
    if (value !== undefined) result[name] = value
  }
  return result
}

export function createStructuredCommandRuntime(
  value: StructuredCommandProfile | unknown,
  opts: StructuredCommandRuntimeOptions = {},
): StructuredCommandRuntime {
  const profile = parseStructuredCommandProfile(value)
  const spawn: StructuredCommandSpawnFn = opts.spawn
    ?? ((executable, argv, spawnOpts) => nodeSpawn(executable, argv, spawnOpts))
  const sourceEnv = opts.env ?? process.env
  const registry = new OperationRegistry<{ signal?: DeviceAbortSignal }>()
  for (const definition of profile.commands) {
    registry.register(
      definition.name,
      {
        description: definition.description,
        effect: definition.effect,
        ...(definition.confirm !== undefined ? { confirm: definition.confirm } : {}),
        inputSchema: inputSchema(definition),
        outputSchema: PROCESS_EXECUTION_OUTPUT_SCHEMA,
      },
      async (args, context) => {
        const commandArgs = args as Record<string, unknown>
        return await executeProcess(
          () => spawn(
            definition.executable,
            argvFor(definition, commandArgs),
            {
              shell: false,
              ...(definition.cwd !== undefined ? { cwd: definition.cwd } : {}),
              env: environmentFor(definition, sourceEnv),
            },
          ),
          {
            timeoutMs: definition.timeoutMs ?? SHELL_EXEC_DEFAULT_TIMEOUT_MS,
            maxOutputBytes: definition.maxOutputBytes ?? SHELL_OUTPUT_LIMIT_BYTES,
            timeoutExitCode: SHELL_TIMEOUT_EXIT_CODE,
            ...(context.signal !== undefined
              ? { signal: context.signal }
              : {}),
          },
        )
      },
    )
  }

  return {
    profile,
    path: profile.path,
    description: profile.description,
    cmds: registry.list(),
    async invoke(command, args, invokeOpts = {}) {
      const name = canonicalizeSegment(command)
      return await registry.invoke(name, args, invokeOpts) as ProcessExecutionResult
    },
  }
}
