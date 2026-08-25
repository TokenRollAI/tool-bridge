const BASE64_CHUNK_BYTES = 0x8000

export interface BoundedResponseOptions {
  /** 设为 false 可保留只按实际流量计数的上游协议语义。 */
  readonly checkContentLength?: boolean
  readonly maxBytes: number
  readonly tooLarge: () => Error
}

/**
 * Read a response without letting an untrusted peer choose unbounded memory use.
 * The stream is cancelled as soon as the limit is crossed and its lock is always released.
 */
export async function readBoundedResponseBytes(
  response: Response,
  options: BoundedResponseOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get('content-length'))
  if (options.checkContentLength !== false && Number.isFinite(declared) && declared > options.maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw options.tooLarge()
  }

  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > options.maxBytes) throw options.tooLarge()
    return bytes
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > options.maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw options.tooLarge()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** Encode large byte arrays without spreading the whole value onto the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES))
  }
  return btoa(binary)
}
