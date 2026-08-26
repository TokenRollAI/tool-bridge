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

describe('configFromEnv 联邦搜索', () => {
  it('把共享 runtime env 解析结果完整注入 remote 配置', () => {
    expect(configFromEnv({
      ...base,
      TB_INSTANCE_ID: 'node-a',
      TB_SEARCH_FEDERATION_CONCURRENCY: '3',
      TB_SEARCH_FEDERATION_DEADLINE_MS: '1800',
      TB_SEARCH_FEDERATION_MAX_RESPONSE_BYTES: '262144',
      TB_SEARCH_FEDERATION_MAX_SOURCES: '9',
      TB_SEARCH_FEDERATION_MIN_CHILD_WORK_MS: '150',
      TB_SEARCH_FEDERATION_RETURN_RESERVE_MS: '80',
      TB_SEARCH_FEDERATION_SESSION_TTL_SEC: '90',
    }).remote).toMatchObject({
      federatedSearch: {
        maxConcurrency: 3,
        maxResponseBodyBytes: 262_144,
        maxSources: 9,
        minChildWorkMs: 150,
        perHopReturnReserveMs: 80,
        sessionTtlMs: 90_000,
        totalDeadlineMs: 1_800,
      },
      instanceId: 'node-a',
    })
  })
})

describe('configFromEnv presign TTL', () => {
  it('下载与上传分别解析，并钳制到 SigV4 七天上限', () => {
    const config = configFromEnv({
      ...base,
      TB_REF_TTL_SEC: '86400',
      TB_UPLOAD_GRANT_TTL_SEC: '999999',
    })
    expect(config.refTtlSec).toBe(86_400)
    expect(config.uploadGrantTtlSec).toBe(604_800)
  })

  it('非法上传 TTL 视为未配置，由应用使用安全缺省', () => {
    expect(configFromEnv({
      ...base,
      TB_UPLOAD_GRANT_TTL_SEC: 'not-a-number',
    }).uploadGrantTtlSec).toBeUndefined()
  })
})

describe('configFromEnv 默认 Store', () => {
  it('新部署默认启用 15 分钟周期清理，其他容量使用应用安全缺省', () => {
    const config = configFromEnv({ ...base })
    expect(config.storeCleanupIntervalSec).toBe(900)
    expect(config.storeMaxObjectBytes).toBeUndefined()
    expect(config.storeRelayMaxBytes).toBeUndefined()
    expect(config.storeTokenSecret).toBeUndefined()
  })

  it('解析容量、TTL、调用 capability 与清理配置', () => {
    const config = configFromEnv({
      ...base,
      TB_STORE_CALL_ALLOWED_CONTENT_TYPES: 'image/*, video/* ,application/pdf',
      TB_STORE_CALL_MAX_BYTES: '2000',
      TB_STORE_CALL_MAX_OBJECT_BYTES: '1500',
      TB_STORE_CALL_MAX_OBJECTS: '3',
      TB_STORE_CLEANUP_INTERVAL_SEC: '60',
      TB_STORE_MAX_OBJECT_BYTES: '4096',
      TB_STORE_READ_TTL_SEC: '120',
      TB_STORE_RELAY_MAX_BYTES: '2048',
      TB_STORE_SHARE_TTL_SEC: '180',
      TB_STORE_UPLOAD_TTL_SEC: '240',
    })
    expect(config).toMatchObject({
      storeCallAllowedContentTypes: ['image/*', 'video/*', 'application/pdf'],
      storeCallMaxBytes: 2000,
      storeCallMaxObjectBytes: 1500,
      storeCallMaxObjects: 3,
      storeCleanupIntervalSec: 60,
      storeMaxObjectBytes: 4096,
      storeReadTtlSec: 120,
      storeRelayMaxBytes: 2048,
      storeShareTtlSec: 180,
      storeUploadTtlSec: 240,
    })
  })

  it('显式 token secret 太短时 fail closed', () => {
    expect(() => configFromEnv({
      ...base,
      TB_STORE_TOKEN_SECRET: 'too-short',
    })).toThrow(/TB_STORE_TOKEN_SECRET/)
  })

  it('显式 token secret 原样注入但不要求新部署手工配置', () => {
    expect(configFromEnv({
      ...base,
      TB_STORE_TOKEN_SECRET: '0123456789abcdef',
    }).storeTokenSecret).toBe('0123456789abcdef')
  })
})
