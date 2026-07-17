import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * CLI 本地凭据配置(`tb login`/`use` 维护;纯本地,无服务端接口)。
 *
 * 落盘位置:`$XDG_CONFIG_HOME/tool-bridge/config.json`(缺省 `~/.config/tool-bridge/config.json`)。
 * 目录 0700、文件 0600(凭据不出网关之外,亦不宽权落盘)。
 *
 * 采用 XDG 路径 + 多 profile 结构(而非单文件 credentials)。
 */
export interface Profile {
  baseUrl: string
  sk: string
}

export interface DeviceConfig {
  id?: string
}

export interface CliConfig {
  current?: string
  /** 本机稳定设备身份(tb connect 缺省 deviceId)。 */
  device?: DeviceConfig
  profiles: Record<string, Profile>
}

/** 配置目录:尊重 `XDG_CONFIG_HOME`(便于测试注入临时目录)。 */
export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(base, 'tool-bridge')
}

export function configPath(): string {
  return join(configDir(), 'config.json')
}

/** 读配置;文件缺失或损坏 → 视作空配置(不抛)。 */
export function readConfig(): CliConfig {
  const p = configPath()
  if (!existsSync(p)) return { profiles: {} }
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<CliConfig>
    if (parsed && typeof parsed === 'object') {
      return {
        current: parsed.current,
        profiles: parsed.profiles ?? {},
        device:
          parsed.device && typeof parsed.device === 'object'
            ? (parsed.device as DeviceConfig)
            : undefined,
      }
    }
  } catch {
    // 损坏配置按空处理,避免 CLI 因手改坏文件而完全不可用
  }
  return { profiles: {} }
}

/** 写配置:确保目录 0700、文件 0600(即使文件此前已存在也强制收紧权限)。 */
export function writeConfig(config: CliConfig): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 })
  const p = configPath()
  writeFileSync(p, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  chmodSync(p, 0o600)
}

/** 当前生效 profile(无 current 或不存在时返回 undefined)。 */
export function currentProfile(config: CliConfig): Profile | undefined {
  if (!config.current) return undefined
  return config.profiles[config.current]
}
