/** Keep an admitted request alive while its response still owns an upstream stream. */
export function trackResponseBody(response: Response, release: () => void, signal?: AbortSignal): Response {
  // The Node adapter materializes its lightweight Response when body is read.
  // Capture middleware-added headers before that transition.
  const headers = response.headers
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
  let abort: (() => void) | undefined
  const finish = () => {
    if (finished) return
    finished = true
    if (abort) signal?.removeEventListener('abort', abort)
    try {
      reader.releaseLock()
    } finally {
      release()
    }
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // A client may disconnect before the HTTP adapter starts pulling this response.
      abort = () => {
        if (finished || cancelled) return
        cancelled = true
        controller.close()
        void reader.cancel(signal?.reason).catch(() => {}).finally(finish)
      }
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })
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
    headers,
  })
}
