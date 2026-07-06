import { hostname } from 'node:os'
import { readConfig, writeConfig } from './config'
import { CliError } from './http'

/** Proto §6.1 实现注记:hostname 小写,非法路径段字符替换为 '-'。 */
export function normalizeDeviceId(input: string): string {
  const id = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!id) throw new CliError('device id is empty after normalization')
  return id
}

/**
 * 取本机稳定 deviceId:
 * - 显式 --device-id 只覆盖本次;
 * - 已有 config.device.id 则复用;
 * - 首次使用 os.hostname() 生成并写回 XDG config。
 */
export function resolveDeviceId(explicit?: string): string {
  if (explicit !== undefined && explicit.trim() !== '') return normalizeDeviceId(explicit)
  const cfg = readConfig()
  if (cfg.device?.id) return cfg.device.id
  const generated = normalizeDeviceId(hostname())
  writeConfig({ ...cfg, device: { ...(cfg.device ?? {}), id: generated } })
  return generated
}
