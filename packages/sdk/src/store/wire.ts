import { TBError } from '@tool-bridge/core/device'
import { z } from 'zod'

export type StoreUri = `store://default/${string}`

const STORE_URI_PATTERN = /^store:\/\/default\/[A-Za-z0-9_-]{22,64}$/

const timestampSchema = z.string().check(z.refine(
  value => Number.isFinite(Date.parse(value)),
  { message: 'expected an ISO-compatible timestamp' },
))

const nonEmptyStringSchema = z.string().check(z.refine(
  value => value.trim() !== '',
  { message: 'expected a non-empty string' },
))

const byteCountSchema = z.number().check(
  z.refine(Number.isSafeInteger, { message: 'expected a safe integer' }),
  z.nonnegative(),
)

const httpUrlSchema = z.pipe(
  z.string().check(z.refine((value) => {
    try {
      const url = new URL(value)
      return (url.protocol === 'http:' || url.protocol === 'https:')
        && url.username === ''
        && url.password === ''
    } catch {
      return false
    }
  }, { message: 'expected an HTTP(S) URL without userinfo' })),
  z.transform((value: string) => new URL(value).toString()),
)

const headerValueSchema = z.string().check(z.refine((value) => {
  try {
    new Headers({ 'x-tb-header-check': value })
    return true
  } catch {
    return false
  }
}, { message: 'expected a valid HTTP header value' }))

const headersSchema = z.record(z.string(), z.string()).check(z.refine((value) => {
  try {
    new Headers(value)
    return true
  } catch {
    return false
  }
}, { message: 'expected valid HTTP headers' }))

function platformCredentialHeader(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === 'authorization'
    || lower === 'cookie'
    || lower === 'cookie2'
    || lower === 'proxy-authorization'
    || lower.startsWith('x-tb-')
}

export const storeUriSchema = z.custom<StoreUri>(
  value => typeof value === 'string' && STORE_URI_PATTERN.test(value),
  { message: 'expected store://default/<22..64 base64url characters>' },
)

export interface StoreChecksum {
  algorithm: 'sha256'
  value: string
}

export const storeChecksumSchema: z.ZodType<StoreChecksum> = z.object({
  algorithm: z.literal('sha256'),
  value: nonEmptyStringSchema,
})

/** Stable descriptor safe to return from a device call or upload helper. */
export interface StoreObjectDescriptor {
  checksum?: StoreChecksum
  contentType: string
  createdAt: string
  etag?: string
  filename?: string
  readyAt: string
  size: number
  uri: StoreUri
}

export const storeObjectDescriptorSchema: z.ZodType<StoreObjectDescriptor> = z.object({
  checksum: z.optional(storeChecksumSchema),
  contentType: nonEmptyStringSchema,
  createdAt: timestampSchema,
  etag: z.optional(z.string()),
  filename: z.optional(z.string()),
  readyAt: timestampSchema,
  size: byteCountSchema,
  uri: storeUriSchema,
})

/** Full public descriptor returned by the authenticated Store management API. */
export interface StoreClientObjectDescriptor extends StoreObjectDescriptor {
  expiresAt?: string
  originCallId?: string
  owner: string
  producer?: string
  status: 'ready'
  updatedAt: string
}

export const storeClientObjectDescriptorSchema: z.ZodType<StoreClientObjectDescriptor>
  = z.object({
    checksum: z.optional(storeChecksumSchema),
    contentType: nonEmptyStringSchema,
    createdAt: timestampSchema,
    etag: z.optional(z.string()),
    expiresAt: z.optional(timestampSchema),
    filename: z.optional(z.string()),
    originCallId: z.optional(nonEmptyStringSchema),
    owner: nonEmptyStringSchema,
    producer: z.optional(nonEmptyStringSchema),
    readyAt: timestampSchema,
    size: byteCountSchema,
    status: z.literal('ready'),
    updatedAt: timestampSchema,
    uri: storeUriSchema,
  })

export interface StoreUploadGrant {
  alreadyCompleted?: true
  descriptor?: StoreObjectDescriptor
  expiresAt: string
  headers: Record<string, string>
  maxBytes: number
  method: 'PUT'
  objectUri: StoreUri
  transport: 'presigned-put' | 'relay'
  uploadId: string
  uploadToken: string
  url: string
}

export const storeUploadGrantSchema: z.ZodType<StoreUploadGrant> = z.object({
  alreadyCompleted: z.optional(z.literal(true)),
  descriptor: z.optional(storeObjectDescriptorSchema),
  expiresAt: timestampSchema,
  headers: headersSchema,
  maxBytes: byteCountSchema.check(z.positive()),
  method: z.literal('PUT'),
  objectUri: storeUriSchema,
  transport: z.enum(['presigned-put', 'relay']),
  uploadId: nonEmptyStringSchema,
  uploadToken: nonEmptyStringSchema.check(z.refine(
    value => headerValueSchema.safeParse(value).success,
    { message: 'expected a valid HTTP header value' },
  )),
  url: httpUrlSchema,
}).check(z.superRefine((grant, ctx) => {
  if (grant.alreadyCompleted === true && grant.descriptor === undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'completed grants require a descriptor',
      path: ['descriptor'],
    })
  }
  if (grant.alreadyCompleted === undefined && grant.descriptor !== undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'active grants must not include a descriptor',
      path: ['descriptor'],
    })
  }
  const headerNames = [...new Headers(grant.headers).keys()]
  const forbidden = headerNames.filter(name => platformCredentialHeader(name)
    && !(grant.transport === 'relay' && name.toLowerCase() === 'x-tb-store-upload'))
  if (forbidden.length > 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'upload grants must not contain platform credential headers',
      path: ['headers'],
    })
  }
}))

export interface StoreReadGrant {
  /** Short-lived bearer URL. Keep it out of logs/history and fetch it immediately. */
  $ref: string
  contentType: string
  expiresAt: string
  size: number
  uri: StoreUri
}

export const storeReadGrantSchema: z.ZodType<StoreReadGrant> = z.object({
  $ref: httpUrlSchema,
  contentType: nonEmptyStringSchema,
  expiresAt: timestampSchema,
  size: byteCountSchema,
  uri: storeUriSchema,
})

export interface StoreShareGrant {
  /** Short-lived, revocable bearer URL. */
  $ref: string
  expiresAt: string
  shareId: string
  uri: StoreUri
}

export const storeShareGrantSchema: z.ZodType<StoreShareGrant> = z.object({
  $ref: httpUrlSchema,
  expiresAt: timestampSchema,
  shareId: nonEmptyStringSchema,
  uri: storeUriSchema,
})

export interface StoreListPage {
  cursor?: string
  items: StoreClientObjectDescriptor[]
}

export const storeListPageSchema: z.ZodType<StoreListPage> = z.object({
  cursor: z.optional(z.string()),
  items: z.array(storeClientObjectDescriptorSchema),
})

function invalidWire(message: string): TBError {
  return new TBError('internal', message, { retryable: true })
}

function parseWire<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw invalidWire(message)
  return parsed.data
}

function requireExpectedUri(actual: StoreUri, expected: StoreUri, message: string): void {
  if (actual !== expected) throw invalidWire(message)
}

/** Parse a caller-supplied Store URI. Wire response parsers use `internal` instead. */
export function parseStoreUri(value: unknown): StoreUri {
  const parsed = storeUriSchema.safeParse(value)
  if (!parsed.success) {
    throw new TBError(
      'invalid_argument',
      'Store URI must match store://default/<22..64 base64url characters>',
    )
  }
  return parsed.data
}

export function parseStoreObjectDescriptor(
  value: unknown,
  expectedUri: StoreUri,
): StoreObjectDescriptor {
  const message = 'gateway returned an invalid Store object descriptor'
  const descriptor = parseWire(storeObjectDescriptorSchema, value, message)
  requireExpectedUri(descriptor.uri, expectedUri, message)
  return descriptor
}

export function parseStoreClientObjectDescriptor(
  value: unknown,
  expectedUri: StoreUri,
): StoreClientObjectDescriptor {
  const message = 'gateway returned an invalid Store object descriptor'
  const descriptor = parseWire(storeClientObjectDescriptorSchema, value, message)
  requireExpectedUri(descriptor.uri, expectedUri, message)
  return descriptor
}

export function parseStoreUploadGrant(value: unknown): StoreUploadGrant {
  const message = 'gateway returned an invalid Store upload grant'
  const grant = parseWire(storeUploadGrantSchema, value, message)
  if (grant.descriptor !== undefined) {
    requireExpectedUri(grant.descriptor.uri, grant.objectUri, message)
  }
  return grant
}

export function parseStoreReadGrant(value: unknown, expectedUri: StoreUri): StoreReadGrant {
  const message = 'gateway returned an invalid Store read grant'
  const grant = parseWire(storeReadGrantSchema, value, message)
  requireExpectedUri(grant.uri, expectedUri, message)
  return grant
}

export function parseStoreShareGrant(value: unknown, expectedUri: StoreUri): StoreShareGrant {
  const message = 'gateway returned an invalid Store share grant'
  const grant = parseWire(storeShareGrantSchema, value, message)
  requireExpectedUri(grant.uri, expectedUri, message)
  return grant
}

export function parseStoreListPage(value: unknown): StoreListPage {
  return parseWire(storeListPageSchema, value, 'gateway returned an invalid Store list page')
}
