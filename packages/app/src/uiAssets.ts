/** Mount the same static bundle during installation and business operation. */
export async function serveUiAssets(request: Request, assets: (request: Request) => Promise<Response>): Promise<Response> {
  const url = new URL(request.url)
  const headers = new Headers()
  for (const name of ['accept-encoding', 'if-none-match']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  const path = url.pathname.slice('/ui'.length) || '/'
  const result = await assets(new Request(new URL(path, url.origin), { headers }))
  if (result.status !== 404) return result
  return assets(new Request(new URL('/', url.origin), { headers }))
}
