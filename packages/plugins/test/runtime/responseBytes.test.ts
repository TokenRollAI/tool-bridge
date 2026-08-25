import { describe, expect, it, vi } from 'vitest'
import {
  bytesToBase64,
  readBoundedResponseBytes,
} from '../../src/_runtime/responseBytes'

describe('bounded response bytes', () => {
  it('合并分块并在成功后释放 reader lock', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3, 4, 5]))
        controller.close()
      },
    }))

    await expect(readBoundedResponseBytes(response, {
      maxBytes: 5,
      tooLarge: () => new Error('too large'),
    })).resolves.toEqual(new Uint8Array([1, 2, 3, 4, 5]))
    expect(response.body?.locked).toBe(false)
  })

  it('声明长度超限时立即 cancel、不锁流，并抛出调用方提供的领域错误', async () => {
    const tooLarge = new Error('provider-specific limit')
    const cancel = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new Uint8Array([1]))
      },
    }), { headers: { 'content-length': '6' } })

    await expect(readBoundedResponseBytes(response, {
      maxBytes: 5,
      tooLarge: () => tooLarge,
    })).rejects.toBe(tooLarge)
    expect(cancel).toHaveBeenCalledOnce()
    expect(response.body?.locked).toBe(false)
  })

  it('实际流超限时立即 cancel，并始终释放 reader lock', async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.enqueue(new Uint8Array([4, 5, 6]))
      },
    }))

    await expect(readBoundedResponseBytes(response, {
      maxBytes: 5,
      tooLarge: () => new Error('stream limit'),
    })).rejects.toThrow('stream limit')
    expect(cancel).toHaveBeenCalledOnce()
    expect(response.body?.locked).toBe(false)
  })

  it('可显式忽略不可信的声明长度，仍按实际流量执行上限', async () => {
    const response = new Response(new Uint8Array([1, 2]), {
      headers: { 'content-length': '100' },
    })
    await expect(readBoundedResponseBytes(response, {
      checkContentLength: false,
      maxBytes: 2,
      tooLarge: () => new Error('too large'),
    })).resolves.toEqual(new Uint8Array([1, 2]))
  })

  it('空响应体返回独立的空字节数组', async () => {
    const bytes = await readBoundedResponseBytes(new Response(null), {
      maxBytes: 1,
      tooLarge: () => new Error('too large'),
    })
    expect(bytes).toEqual(new Uint8Array())
    expect(bytes.buffer).toBeInstanceOf(ArrayBuffer)
  })
})

describe('base64 bytes', () => {
  it('大于单次参数展开上限的字节仍可无损编码', () => {
    const bytes = Uint8Array.from({ length: 0x8000 + 17 }, (_, index) => index % 251)
    const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), char => char.charCodeAt(0))
    expect(decoded).toEqual(bytes)
  })
})
