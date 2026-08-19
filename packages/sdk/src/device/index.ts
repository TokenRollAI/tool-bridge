/** @tool-bridge/sdk/device —— React Native / Hermes-safe 设备客户端入口。 */

export {
  connectDevice,
  createReactNativeWebSocketFactory,
  DEVICE_HEARTBEAT_INTERVAL_MS,
  deviceWsUrl,
} from './connection'
export type {
  ConnectDeviceOptions,
  DeviceCallContext,
  DeviceCallHandler,
  DeviceClientExpose,
  DeviceConnection,
  DeviceConnectionState,
  DeviceCredentialProvider,
  DeviceNodeDefinition,
  DeviceWebSocketFactory,
  DeviceWebSocketFactoryInput,
  PreparedDeviceCredential,
  ReactNativeWebSocketConstructor,
} from './connection'

export {
  decodeDeviceFrame,
  deviceErrorFrame,
  encodeDeviceFrame,
  PING_FRAME_JSON,
  PONG_FRAME_JSON,
  TBError,
} from '@tool-bridge/core/device'
export type {
  CallFrame,
  CancelFrame,
  DeviceFrame,
  DeviceNodeCmd,
  ErrorFrame,
  HelloFrame,
  PingFrame,
  PongFrame,
  ReadyFrame,
  ResultFrame,
  TBErrorBody,
  TBErrorCode,
} from '@tool-bridge/core/device'
