/** Node 根入口的设备连接薄适配：ws + Bearer，状态机与重连在 neutral supervisor。 */

import {
  type DeviceCallHandler,
  type DeviceClientState,
  type DeviceExpose,
} from '@tool-bridge/core'
import WS from 'ws'
import type { SdkConnection } from './types'
import {
  DEVICE_HEARTBEAT_INTERVAL_MS,
  type DeviceWebSocketFactory,
  deviceWsUrl,
  openPortableDeviceConnection,
} from './device/connection'

export { deviceWsUrl }
export const HEARTBEAT_INTERVAL_MS = DEVICE_HEARTBEAT_INTERVAL_MS

function nodeWebSocketFactory(): DeviceWebSocketFactory {
  return {
    open({ url, protocols, headers }) {
      const options = headers === undefined ? undefined : { headers: { ...headers } }
      const socket = protocols === undefined
        ? new WS(url, options)
        : new WS(url, typeof protocols === 'string' ? protocols : [...protocols], options)
      return socket as unknown as WebSocket
    },
  }
}

export interface OpenConnectionConfig {
  baseUrl: string
  deviceId: string
  /** 建连前解析(工具表收集可能异步);失败 → ready reject + closed。 */
  expose: () => Promise<DeviceExpose>
  handler: DeviceCallHandler
  mountPath?: string
  sk: string
}

export function openConnection(cfg: OpenConnectionConfig): SdkConnection {
  const connection = openPortableDeviceConnection({
    baseUrl: cfg.baseUrl,
    credentialProvider: {
      prepare: () => ({ headers: { authorization: `Bearer ${cfg.sk}` } }),
    },
    deviceId: cfg.deviceId,
    expose: cfg.expose,
    handler: cfg.handler,
    webSocketFactory: nodeWebSocketFactory(),
    ...(cfg.mountPath === undefined ? {} : { mountPath: cfg.mountPath }),
  })
  return {
    get state() {
      // Node 根入口不公开 suspend/resume，运行时不会出现 suspended。
      return connection.state as DeviceClientState
    },
    ready: connection.ready,
    closed: connection.closed,
    close: () => connection.close(),
  }
}
