/**
 * 高德地图(AMap)—— 从 open-connector 迁移的 provider(15 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 凭证是单个 API key,但它走的是 **URL 上的 `key` query 参数**而不是请求头
 * (高德 Web 服务 API 的设计)。部署侧要对日志脱敏,详见 `api.ts` 顶部注释。
 *
 * **没有 credentialProbe**:探针要求"已注册、effect 为 read、无必填入参"三条同时成立,
 * 15 个 action 里凑不出一个 ——
 * - 上游 `credentialValidators` 打的是 `/v3/weather/weatherInfo?city=110000`,对应 `weather`
 *   这个 action,但它的 `city` 是必填,不满足"无必填入参";
 * - 唯一入参全 optional 的是 `ip_locate`,可它在本层把 `ip` 变成了实质必填
 *   (拿不到调用方来源 IP,见 `api.ts`),空参调必报 invalid_argument;
 * - 不为了当探针硬造一个 schema 之外的工具。
 * 代价:配错的 key 要等第一次业务调用才暴露,那时高德会回 200 + `INVALID_USER_KEY`,
 * 已被 `api.ts` 归一成 permission_denied,消息里带得到 infocode。
 */

import {
  districtSearch,
  geocode,
  getPlaceDetail,
  inputTips,
  ipLocate,
  reverseGeocode,
  routeBicycling,
  routeDriving,
  routeElectrobike,
  routeTransit,
  routeWalking,
  searchPlaces,
  searchPlacesAround,
  searchPlacesPolygon,
  weather,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { amapActions } from './schema'

export type { ProviderEnv as Env }

export function createAmapPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'AMap (高德地图)',
    actions: amapActions,
    handlers: {
      geocode,
      reverse_geocode: reverseGeocode,
      search_places: searchPlaces,
      search_places_around: searchPlacesAround,
      search_places_polygon: searchPlacesPolygon,
      get_place_detail: getPlaceDetail,
      input_tips: inputTips,
      ip_locate: ipLocate,
      district_search: districtSearch,
      weather,
      route_driving: routeDriving,
      route_walking: routeWalking,
      route_bicycling: routeBicycling,
      route_electrobike: routeElectrobike,
      route_transit: routeTransit,
    },
  })
}

export default createAmapPlugin()
