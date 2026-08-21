/**
 * configFromEnv 的端口与后端选择解析。
 *
 * 端口优先级是部署可用性问题:PaaS(Railway / Fly / Cloud Run / CF Container)只注入
 * PORT,不认识 TB_PORT。不兜底 PORT 的话容器监听 8787 而平台探活另一个端口,
 * 部署静默失败(健康检查超时,日志里看不出原因)。
 */

import { describe, expect, it } from 'vitest'
import { configFromEnv } from '../src/config'

const base = { TB_BOOTSTRAP_ADMIN_SK: 'tbk_test_admin_key_0000000000' }

describe('configFromEnv 端口解析', () => {
  it('缺省 8787', () => {
    expect(configFromEnv({ ...base }).port).toBe(8787)
  })

  it('TB_PORT 生效', () => {
    expect(configFromEnv({ ...base, TB_PORT: '9001' }).port).toBe(9001)
  })

  it('平台注入的 PORT 生效(PaaS 兜底)', () => {
    expect(configFromEnv({ ...base, PORT: '3000' }).port).toBe(3000)
  })

  it('两者同时存在时 TB_PORT 优先', () => {
    expect(configFromEnv({ ...base, PORT: '3000', TB_PORT: '9001' }).port).toBe(9001)
  })

  it('非法 PORT 落回缺省而不是崩溃', () => {
    expect(configFromEnv({ ...base, PORT: 'not-a-port' }).port).toBe(8787)
    expect(configFromEnv({ ...base, PORT: '70000' }).port).toBe(8787)
  })

  it('port 0 合法(系统分配临时端口)', () => {
    expect(configFromEnv({ ...base, TB_PORT: '0' }).port).toBe(0)
  })
})

const S3_ENV = {
  TB_OBJECT_STORE_ACCESS_KEY_ID: 'ak',
  TB_OBJECT_STORE_BUCKET: 'tb-objects',
  TB_OBJECT_STORE_ENDPOINT: 'https://s3.example.com',
  TB_OBJECT_STORE_SECRET_ACCESS_KEY: 'sk',
}

describe('configFromEnv 平台对象存储', () => {
  it('缺省不带 objectStore(走本地 FS)', () => {
    expect(configFromEnv({ ...base }).objectStore).toBeUndefined()
  })

  it('四项齐全时解析出配置', () => {
    expect(configFromEnv({ ...base, ...S3_ENV }).objectStore).toEqual({
      accessKeyId: 'ak',
      bucket: 'tb-objects',
      endpoint: 'https://s3.example.com',
      secretAccessKey: 'sk',
    })
  })

  it('region 可选,给了就带上', () => {
    const config = configFromEnv({ ...base, ...S3_ENV, TB_OBJECT_STORE_REGION: 'us-east-1' })
    expect(config.objectStore?.region).toBe('us-east-1')
  })

  /**
   * 半套凭证必须 fail closed。静默回退本地 FS 的话运维以为对象在 S3、实际写进容器层,
   * 容器重建即丢且多副本互不可见 —— 这类错误在故障时才暴露,代价远高于启动即拒。
   */
  it.each(Object.keys(S3_ENV))('缺 %s 时拒绝启动而不是静默回退', (omitted) => {
    const partial = Object.fromEntries(
      Object.entries(S3_ENV).filter(([key]) => key !== omitted),
    )
    expect(() => configFromEnv({ ...base, ...partial })).toThrow(/对象存储配置不完整/)
  })

  it('报错点明缺哪一项', () => {
    expect(() => configFromEnv({
      ...base,
      TB_OBJECT_STORE_ENDPOINT: 'https://s3.example.com',
    })).toThrow(/TB_OBJECT_STORE_BUCKET/)
  })
})

describe('configFromEnv 后端选择', () => {
  it('缺省不带 databaseUrl(走 SQLite)', () => {
    expect(configFromEnv({ ...base }).databaseUrl).toBeUndefined()
  })

  it('TB_DATABASE_URL 透传', () => {
    const url = 'postgres://u:p@db:5432/tb'
    expect(configFromEnv({ ...base, TB_DATABASE_URL: url }).databaseUrl).toBe(url)
  })

  it('空 TB_DATABASE_URL 视为未配置(不产出空连接串)', () => {
    expect(configFromEnv({ ...base, TB_DATABASE_URL: '' }).databaseUrl).toBeUndefined()
  })
})
