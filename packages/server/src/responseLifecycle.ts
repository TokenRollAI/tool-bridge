/** Keep an admitted request alive while its response still owns an upstream stream. */
export function trackResponseBody(response: Response, release: () => void): Response {
  if (!response.body) {
    release()
    return response
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>
  try {
    reader = response.body.getReader()
  } catch (error) {
    release()
    throw error
  }
  let finished = false
  let cancelled = false
  const finish = () => {
    if (finished) return
    finished = true
    try {
      reader.releaseLock()
    } finally {
      release()
    }
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // Upstream errors must release even while the consumer is applying backpressure.
      void reader.closed.catch((error: unknown) => {
        if (finished || cancelled) return
        controller.error(error)
        finish()
      })
    },
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (finished || cancelled) return
        if (chunk.done) {
          controller.close()
          finish()
        } else {
          controller.enqueue(chunk.value)
        }
      } catch (error) {
        if (finished || cancelled) return
        controller.error(error)
        finish()
      }
    },
    async cancel(reason: unknown) {
      cancelled = true
      try {
        await reader.cancel(reason)
      } finally {
        finish()
      }
    },
  }, { highWaterMark: 0 })
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
