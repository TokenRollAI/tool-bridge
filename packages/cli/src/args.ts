import type { ArgsDef } from 'citty'

/**
 * 全局开关(每个子命令共享):
 * - `--json`:输出可解析 JSON(DOD.md:35 CLI 骨架义务)。
 * - `--base-url` / `--sk`:覆盖环境变量 TB_BASE_URL / TB_SK。
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
    description: 'Gateway base URL (default: $TB_BASE_URL)',
  },
  sk: {
    type: 'string',
    description: 'Secret Key (default: $TB_SK)',
  },
} satisfies ArgsDef

/** 解析 base URL / SK:显式 flag 优先,回退到环境变量。 */
export function resolveTarget(args: { 'base-url'?: string; sk?: string }): {
  baseUrl?: string
  sk?: string
} {
  return {
    baseUrl: args['base-url'] ?? process.env.TB_BASE_URL,
    sk: args.sk ?? process.env.TB_SK,
  }
}
