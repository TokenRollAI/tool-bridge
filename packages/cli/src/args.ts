import type { ArgsDef } from 'citty'
import { currentProfile, readConfig } from './config'
import type { Target } from './http'

/**
 * 全局开关(每个子命令共享):
 * - `--json`:输出可解析 JSON(DOD.md:35 CLI 骨架义务)。
 * - `--base-url` / `--sk`:覆盖环境变量与配置文件。
 *
 * citty 的父命令 args 不会自动下发到子命令,故以共享对象在各子命令 spread。
 */
export const globalArgs = {
  json: {
    type: 'boolean',
    description: 'Output parseable JSON',
    default: false,
  },
  'base-url': {
    type: 'string',
    description: 'Gateway base URL (default: $TB_BASE_URL or config profile)',
  },
  sk: {
    type: 'string',
    description: 'Secret Key (default: $TB_SK or config profile)',
  },
} satisfies ArgsDef

/**
 * 解析 base URL / SK,优先级(高→低):
 * 1. 显式 flag `--base-url`/`--sk`
 * 2. 环境变量 `TB_BASE_URL`/`TB_SK`
 * 3. `tb login`/`use` 落盘的当前 profile
 *
 * env 高于配置文件是刻意约定(便于 CI/临时覆盖);保持 status.ts 既有读取语义兼容。
 */
export function resolveTarget(args: { 'base-url'?: string; sk?: string }): Target {
  const profile = currentProfile(readConfig())
  return {
    baseUrl: args['base-url'] ?? process.env.TB_BASE_URL ?? profile?.baseUrl,
    sk: args.sk ?? process.env.TB_SK ?? profile?.sk,
  }
}
