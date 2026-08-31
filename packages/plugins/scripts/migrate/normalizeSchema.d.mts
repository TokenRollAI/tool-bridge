/**
 * `normalizeSchema.mjs` 的类型面 —— 让 test/migration 在不开 allowJs、不引 Node 类型的
 * 前提下按类型 import 同一份实现。改实现须同步这里(形状极小,漂移会被 typecheck 拦)。
 */
export declare const NORMALIZE_VERSION: number
export declare function normalize(schema: unknown): unknown
