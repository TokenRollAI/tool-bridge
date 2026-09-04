/**
 * TBError:平台统一错误类型与 TBError↔HTTP 映射。
 *
 * core 是纯逻辑内核,不依赖任何运行时(Workers / Node)——错误的 HTTP 呈现
 * 由网关层读取此处的 `httpStatus` 与 `toJSON()` 完成,core 只定义契约。
 */

/** 7 个规范错误码。 */
export type TBErrorCode
  = | 'not_found'
    | 'permission_denied'
    | 'invalid_argument'
    | 'conflict'
    | 'unavailable'
    | 'rate_limited'
    | 'internal'

/** 7 码的常量表(线上 body 校验用,如 DeviceFrame 的 error 字段)。 */
export const TB_ERROR_CODES: readonly TBErrorCode[] = [
  'not_found',
  'permission_denied',
  'invalid_argument',
  'conflict',
  'unavailable',
  'rate_limited',
  'internal',
]

/** 线上 body 形状:~help、返回值、错误响应统一用它。 */
export interface TBErrorBody {
  code: TBErrorCode
  message: string
  retryable: boolean
}

/** 7 码 → HTTP 状态的规范映射。 */
const CODE_TO_STATUS: Record<TBErrorCode, number> = {
  not_found: 404,
  permission_denied: 403,
  invalid_argument: 400,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
  internal: 500,
}

/** `retryable:true` 仅允许出现在这三个码上。 */
const RETRYABLE_CODES: ReadonlySet<TBErrorCode> = new Set<TBErrorCode>([
  'rate_limited',
  'unavailable',
  'internal',
])

/**
 * httpStatus 覆盖唯一允许偏离规范映射的两组(特例):
 * (permission_denied, 401) 与 (unavailable, 501)。其余偏离构造抛错。
 * 与规范状态相等的传入不算偏离(如 deviceOffline 显式传 503)。
 */
const STATUS_OVERRIDES: ReadonlySet<string> = new Set<string>([
  'permission_denied:401',
  'unavailable:501',
])

/** 给定错误码的规范 HTTP 状态(不含 401/501 特例)。 */
export function statusForCode(code: TBErrorCode): number {
  return CODE_TO_STATUS[code]
}

/**
 * 跨 bundle 品牌。`Symbol.for` 走全局 symbol registry,不同 core 副本得到同一个 symbol;
 * 版本后缀让将来不兼容的形状变更可以刻意断开识别。
 */
const TB_ERROR_BRAND = Symbol.for('tool-bridge.TBError.v1')

export interface TBErrorOptions {
  /**
   * HTTP 状态覆盖:仅用于两个特例——
   * 401(未认证,code 仍为 permission_denied)与 501(未实现,code 仍为 unavailable)。
   * 缺省时按 CODE_TO_STATUS 推导。
   */
  httpStatus?: number
  /** 缺省 false;设为 true 时 code 必须属于可重试三码集,否则构造抛错。 */
  retryable?: boolean
}

/**
 * 平台错误。既是抛掷用的 Error,也承载线上呈现所需的 `httpStatus` 与 body。
 *
 * 实例带不可枚举的 `Symbol.for` 品牌:private core 被 bundle 进每个 public 产物各自一份,同进程里
 * 可能同时存在多个 `TBError` 类(如 `@tool-bridge/sdk` 根入口与 `./store` 子入口分两次构建)。
 * `instanceof` 在跨副本时恒为 false,会把已归一的错误降级成 `internal` 500;识别统一走
 * `isTBError`,它只看品牌与线上形状,不看原型链。
 */
export class TBError extends Error {
  readonly code: TBErrorCode
  readonly retryable: boolean
  readonly httpStatus: number

  constructor(code: TBErrorCode, message: string, options: TBErrorOptions = {}) {
    super(message)
    this.name = 'TBError'
    Object.defineProperty(this, TB_ERROR_BRAND, {
      configurable: false,
      enumerable: false,
      value: true,
      writable: false,
    })
    const retryable = options.retryable ?? false
    if (retryable && !RETRYABLE_CODES.has(code)) {
      throw new Error(`TBError: retryable=true not allowed for code '${code}'`)
    }
    if (
      options.httpStatus !== undefined
      && options.httpStatus !== CODE_TO_STATUS[code]
      && !STATUS_OVERRIDES.has(`${code}:${options.httpStatus}`)
    ) {
      throw new Error(`TBError: httpStatus=${options.httpStatus} not allowed for code '${code}'`)
    }
    this.code = code
    this.retryable = retryable
    this.httpStatus = options.httpStatus ?? CODE_TO_STATUS[code]
  }

  /** 线上 body;httpStatus 由 HTTP 层单独承载,不进 body。 */
  toJSON(): TBErrorBody {
    return { code: this.code, message: this.message, retryable: this.retryable }
  }

  /** 缺失/无法识别的 SK:HTTP 401,code=permission_denied。 */
  static unauthenticated(message = 'missing or unrecognized secret key'): TBError {
    return new TBError('permission_denied', message, { retryable: false, httpStatus: 401 })
  }

  /** 未实现占位:HTTP 501,code=unavailable。 */
  static unimplemented(message = 'not implemented'): TBError {
    return new TBError('unavailable', message, { retryable: false, httpStatus: 501 })
  }

  /** 资源不存在:HTTP 404。 */
  static notFound(message = 'not found'): TBError {
    return new TBError('not_found', message)
  }

  /** 设备离线:HTTP 503,retryable=true。 */
  static deviceOffline(message = 'device offline'): TBError {
    return new TBError('unavailable', message, { retryable: true, httpStatus: 503 })
  }
}

/**
 * 判断任意值是否为 TBError(网关 onError 中区分已知/未知错误)。
 *
 * 不用 `instanceof`:同进程可能载入多份 core(每个 public 产物各 bundle 一份),跨副本
 * `instanceof` 恒为 false。这里按品牌 symbol + 线上形状识别,任何副本构造的 TBError 都算。
 * 返回的类型守卫仍是本副本的 `TBError`,`code/message/retryable/httpStatus/toJSON` 契约一致。
 */
export function isTBError(value: unknown): value is TBError {
  if (typeof value !== 'object' || value === null) return false
  if ((value as { [TB_ERROR_BRAND]?: unknown })[TB_ERROR_BRAND] !== true) return false
  const candidate = value as Partial<TBError>
  return typeof candidate.code === 'string'
    && TB_ERROR_CODES.includes(candidate.code)
    && typeof candidate.message === 'string'
    && typeof candidate.retryable === 'boolean'
    && typeof candidate.httpStatus === 'number'
    && typeof candidate.toJSON === 'function'
}
