import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configPath, readConfig, writeConfig } from '../src/config'
import { resolveTarget } from '../src/args'

let tmp: string
const savedEnv = {
  xdg: process.env.XDG_CONFIG_HOME,
  url: process.env.TB_BASE_URL,
  sk: process.env.TB_SK,
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tb-cfg-'))
  process.env.XDG_CONFIG_HOME = tmp
  delete process.env.TB_BASE_URL
  delete process.env.TB_SK
})

afterEach(() => {
  restore('XDG_CONFIG_HOME', savedEnv.xdg)
  restore('TB_BASE_URL', savedEnv.url)
  restore('TB_SK', savedEnv.sk)
})

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

describe('config 读写', () => {
  it('缺文件 → 空配置', () => {
    expect(readConfig()).toEqual({ profiles: {} })
  })

  it('写入后可回读,current 生效', () => {
    writeConfig({ current: 'prod', profiles: { prod: { baseUrl: 'https://p', sk: 'tbk_p' } } })
    const cfg = readConfig()
    expect(cfg.current).toBe('prod')
    expect(cfg.profiles.prod).toEqual({ baseUrl: 'https://p', sk: 'tbk_p' })
  })

  it('文件权限 0600', () => {
    writeConfig({ current: 'x', profiles: { x: { baseUrl: 'u', sk: 's' } } })
    expect(statSync(configPath()).mode & 0o777).toBe(0o600)
  })
})

describe('resolveTarget 优先级 flag > env > config', () => {
  beforeEach(() => {
    writeConfig({ current: 'c', profiles: { c: { baseUrl: 'https://cfg', sk: 'tbk_cfg' } } })
  })

  it('无 flag / 无 env → 用配置', () => {
    expect(resolveTarget({})).toEqual({ baseUrl: 'https://cfg', sk: 'tbk_cfg' })
  })

  it('env 覆盖配置', () => {
    process.env.TB_BASE_URL = 'https://env'
    process.env.TB_SK = 'tbk_env'
    expect(resolveTarget({})).toEqual({ baseUrl: 'https://env', sk: 'tbk_env' })
  })

  it('flag 覆盖 env 与配置', () => {
    process.env.TB_BASE_URL = 'https://env'
    expect(resolveTarget({ baseUrl: 'https://flag', sk: 'tbk_flag' })).toEqual({
      baseUrl: 'https://flag',
      sk: 'tbk_flag',
    })
  })
})
