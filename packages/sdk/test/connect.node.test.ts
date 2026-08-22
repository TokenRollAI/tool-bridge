import type { IncomingMessage } from 'node:http'
import { decodeDeviceFrame, encodeDeviceFrame, type ResultFrame } from '@tool-bridge/core/device'
import { type WebSocket, WebSocketServer } from 'ws'
import { describe, expect, it } from 'vitest'
import { openConnection } from '../src/connect'

function listen(server: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
}

function closeServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  })
}

describe('SDK Node 根入口设备连接', () => {
  it('继续使用 ws Authorization adapter，并复用 neutral 状态机', async () => {
    const server = new WebSocketServer({ port: 0 })
    await listen(server)
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('unexpected server address')

    let request: IncomingMessage | undefined
    let peer: WebSocket | undefined
    const result = new Promise<ResultFrame>((resolve, reject) => {
      server.once('connection', (socket, incoming) => {
        request = incoming
        peer = socket
        socket.on('error', reject)
        socket.on('message', (raw) => {
          const frame = decodeDeviceFrame(String(raw))
          if (frame.type === 'hello') {
            socket.send(encodeDeviceFrame({ type: 'ready', mountPath: 'device/node-sdk' }))
            socket.send(encodeDeviceFrame({
              type: 'call',
              id: 'node-call',
              path: 'tools/echo/echo',
              arguments: { text: 'hello' },
            }))
          } else if (frame.type === 'result') {
            resolve(frame)
          }
        })
      })
    })

    const connection = openConnection({
      baseUrl: `http://127.0.0.1:${address.port}`,
      deviceId: 'node-sdk',
      sk: 'node-device-sk',
      expose: async () => ({
        nodes: [{ path: 'tools/echo', kind: 'tool', description: 'echo' }],
      }),
      handler: async ({ arguments: args }) => ({ echoed: args.text }),
    })

    await expect(connection.ready).resolves.toBe('device/node-sdk')
    await expect(result).resolves.toEqual({
      type: 'result',
      id: 'node-call',
      ok: true,
      value: { echoed: 'hello' },
    })
    expect(request?.url).toBe('/system/device/ws?deviceId=node-sdk')
    expect(request?.headers.authorization).toBe('Bearer node-device-sk')

    connection.close()
    await connection.closed
    peer?.terminate()
    await closeServer(server)
  })
})
