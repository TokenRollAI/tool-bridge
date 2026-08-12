/**
 * Stormglass —— 从 open-connector 迁移的 provider(api_key,3 个只读海洋气象 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 不设 credentialProbe:三个 action 都必填 lat/lng,没有可"空转"的调用
 * (上游 credentialValidators 是拿一组写死的坐标去探,本仓库不做这种造数)。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { getTideExtremes, getTideSeaLevel, getWeatherPoint } from './api'
import { stormglassIoActions } from './schema'

export type { ProviderEnv as Env }

export function createStormglassIoPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Stormglass',
    actions: stormglassIoActions,
    handlers: {
      get_weather_point: getWeatherPoint,
      get_tide_extremes: getTideExtremes,
      get_tide_sea_level: getTideSeaLevel,
    },
  })
}

export default createStormglassIoPlugin()
