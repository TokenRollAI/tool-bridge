import { type PreparePluginImage, TBError } from '@tool-bridge/core'
import { request } from 'node:http'

export function pluginRunnerClient(socketPath: string): PreparePluginImage {
  return (id, image) => new Promise((resolve, reject) => {
    const req = request({
      socketPath, path: '/prepare', method: 'POST', headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(450_000),
    }, (res) => {
      res.resume()
      const endpoint = res.headers['x-tb-plugin-endpoint']
      if (res.statusCode === 204 && typeof endpoint === 'string') return resolve(endpoint)
      if (res.statusCode === 403) return reject(new TBError('permission_denied', 'plugin image is not approved by the local runner'))
      reject(new TBError('unavailable', 'isolated plugin runner could not start the candidate'))
    })
    req.on('error', () => reject(new TBError('unavailable', 'isolated plugin runner is unreachable')))
    req.end(JSON.stringify({ id, image }))
  })
}
