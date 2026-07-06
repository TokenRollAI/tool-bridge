/**
 * TBError:平台统一错误类型与 TBError↔HTTP 映射(Proto §0.2)。
 *
 * core 是纯逻辑内核,不依赖任何运行时(Workers / Node)——错误的 HTTP 呈现
 * 由网关层读取此处的 `httpStatus` 与 `toJSON()` 完成,core 只定义契约。
 */

/** 7 个规范错误码(Proto §0.2)。 */
export type TBErrorCode =
  | 'not_found'
  | 'permission_denied'
  | 'invalid_argument'
  | 'conflict'
  | 'unavailable'
  | 'rate_limited'
  | 'internal'

/** 线上 body 形状(Proto §0.2):~help、返回值、错误响应统一用它。 */
export interface TBErrorBody {
  code: TBErrorCode
  message: string
  retryable: boolean
}

/** 7 码 → HTTP 状态的规范映射(Proto §0.2)。 */
const CODE_TO_STATUS: Record<TBErrorCode, number> = {
  not_found: 404,
  permission_denied: 403,
  invalid_argument: 400,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
  internal: 500,
}

/** `retryable:true` 仅允许出现在这三个码上(Proto §0.2)。 */
const RETRYABLE_CODES: ReadonlySet<TBErrorCode> = new Set<TBErrorCode>([
  'rate_limited',
  'unavailable',
  'internal',
])

/** 给定错误码的规范 HTTP 状态(不含 401/501 特例)。 */
export function statusForCode(code: TBErrorCode): number {
  return CODE_TO_STATUS[code]
}

export interface TBErrorOptions {
  /** 缺省 false;设为 true 时 code 必须属于可重试三码集,否则构造抛错。 */
  retryable?: boolean
  /**
   * HTTP 状态覆盖:仅用于 Proto §0.2 的两个特例——
   * 401(未认证,code 仍为 permission_denied)与 501(未实现,code 仍为 unavailable)。
   * 缺省时按 CODE_TO_STATUS 推导。
   */
  httpStatus?: number
}

/**
 * 平台错误。既是抛掷用的 Error,也承载线上呈现所需的 `httpStatus` 与 body。
 */
export class TBError extends Error {
  readonly code: TBErrorCode
  readonly retryable: boolean
  readonly httpStatus: number

  constructor(code: TBErrorCode, message: string, options: TBErrorOptions = {}) {
    super(message)
    this.name = 'TBError'
    const retryable = options.retryable ?? false
    if (retryable && !RETRYABLE_CODES.has(code)) {
      throw new Error(`TBError: retryable=true not allowed for code '${code}' (Proto §0.2)`)
    }
    this.code = code
    this.retryable = retryable
    this.httpStatus = options.httpStatus ?? CODE_TO_STATUS[code]
  }

  /** 线上 body(Proto §0.2);httpStatus 由 HTTP 层单独承载,不进 body。 */
  toJSON(): TBErrorBody {
    return { code: this.code, message: this.message, retryable: this.retryable }
  }

  /** 缺失/无法识别的 SK:HTTP 401,code=permission_denied(Proto §0.2)。 */
  static unauthenticated(message = 'missing or unrecognized secret key'): TBError {
    return new TBError('permission_denied', message, { retryable: false, httpStatus: 401 })
  }

  /** 未实现占位:HTTP 501,code=unavailable(Proto §0.2)。 */
  static unimplemented(message = 'not implemented'): TBError {
    return new TBError('unavailable', message, { retryable: false, httpStatus: 501 })
  }

  /** 资源不存在:HTTP 404(Proto §0.2)。 */
  static notFound(message = 'not found'): TBError {
    return new TBError('not_found', message)
  }

  /** 设备离线:HTTP 503,retryable=true(Proto §0.2)。 */
  static deviceOffline(message = 'device offline'): TBError {
    return new TBError('unavailable', message, { retryable: true, httpStatus: 503 })
  }
}

/** 判断任意值是否为 TBError 实例(网关 onError 中区分已知/未知错误)。 */
export function isTBError(value: unknown): value is TBError {
  return value instanceof TBError
}
