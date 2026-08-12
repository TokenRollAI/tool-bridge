/**
 * 内置插件目录的装配表(参考 open-connector 的 generated registry 形态;
 * 目录规模大了以后由 codegen 从 src/<name>/ 目录生成,现在先手写)。
 *
 * 每个 src/<name>/ 文件夹 = 一个插件(纯源码,不是 workspace 包);loader 用动态
 * import 懒加载——"可用 ≠ 实例化":未被注册/调用的插件连模块都不会加载。
 */

/** 插件模块形状:default export = plugin-sdk 产出的 `{ fetch(request, env) }`。 */
export interface BuiltinPluginModule {
  default: {
    fetch(request: Request, env: never): Promise<Response> | Response
  }
}

export const BUILTIN_PLUGIN_LOADERS: Record<string, () => Promise<BuiltinPluginModule>> = {
  accredible_certificates: () => import('./accredible_certificates/index') as Promise<BuiltinPluginModule>,
  aimfox: () => import('./aimfox/index') as Promise<BuiltinPluginModule>,
  alt_text_generator_ai: () => import('./alt_text_generator_ai/index') as Promise<BuiltinPluginModule>,
  apify: () => import('./apify/index') as Promise<BuiltinPluginModule>,
  appstle_subscriptions: () => import('./appstle_subscriptions/index') as Promise<BuiltinPluginModule>,
  bookingmood: () => import('./bookingmood/index') as Promise<BuiltinPluginModule>,
  brandfetch: () => import('./brandfetch/index') as Promise<BuiltinPluginModule>,
  brave_search: () => import('./brave_search/index') as Promise<BuiltinPluginModule>,
  callerapi: () => import('./callerapi/index') as Promise<BuiltinPluginModule>,
  chatbotkit: () => import('./chatbotkit/index') as Promise<BuiltinPluginModule>,
  chattermill: () => import('./chattermill/index') as Promise<BuiltinPluginModule>,
  chatwork: () => import('./chatwork/index') as Promise<BuiltinPluginModule>,
  chorus: () => import('./chorus/index') as Promise<BuiltinPluginModule>,
  cincopa: () => import('./cincopa/index') as Promise<BuiltinPluginModule>,
  circle: () => import('./circle/index') as Promise<BuiltinPluginModule>,
  clerk: () => import('./clerk/index') as Promise<BuiltinPluginModule>,
  cohere: () => import('./cohere/index') as Promise<BuiltinPluginModule>,
  coinranking: () => import('./coinranking/index') as Promise<BuiltinPluginModule>,
  commpeak: () => import('./commpeak/index') as Promise<BuiltinPluginModule>,
  companycam: () => import('./companycam/index') as Promise<BuiltinPluginModule>,
  convertapi: () => import('./convertapi/index') as Promise<BuiltinPluginModule>,
  coresignal: () => import('./coresignal/index') as Promise<BuiltinPluginModule>,
  crustdata: () => import('./crustdata/index') as Promise<BuiltinPluginModule>,
  currencyapi: () => import('./currencyapi/index') as Promise<BuiltinPluginModule>,
  customgpt: () => import('./customgpt/index') as Promise<BuiltinPluginModule>,
  deck_co: () => import('./deck_co/index') as Promise<BuiltinPluginModule>,
  dub: () => import('./dub/index') as Promise<BuiltinPluginModule>,
  eodhd_apis: () => import('./eodhd_apis/index') as Promise<BuiltinPluginModule>,
  faraday: () => import('./faraday/index') as Promise<BuiltinPluginModule>,
  fathom: () => import('./fathom/index') as Promise<BuiltinPluginModule>,
  feathery: () => import('./feathery/index') as Promise<BuiltinPluginModule>,
  feishu: () => import('./feishu/index') as Promise<BuiltinPluginModule>,
  feishu_custom_bot: () => import('./feishu_custom_bot/index') as Promise<BuiltinPluginModule>,
  ffhub: () => import('./ffhub/index') as Promise<BuiltinPluginModule>,
  fidel_api: () => import('./fidel_api/index') as Promise<BuiltinPluginModule>,
  firehydrant: () => import('./firehydrant/index') as Promise<BuiltinPluginModule>,
  fixer: () => import('./fixer/index') as Promise<BuiltinPluginModule>,
  formcarry: () => import('./formcarry/index') as Promise<BuiltinPluginModule>,
  fraudlabspro: () => import('./fraudlabspro/index') as Promise<BuiltinPluginModule>,
  front: () => import('./front/index') as Promise<BuiltinPluginModule>,
  genderize: () => import('./genderize/index') as Promise<BuiltinPluginModule>,
  geocodio: () => import('./geocodio/index') as Promise<BuiltinPluginModule>,
  geokeo: () => import('./geokeo/index') as Promise<BuiltinPluginModule>,
  getform: () => import('./getform/index') as Promise<BuiltinPluginModule>,
  graphhopper: () => import('./graphhopper/index') as Promise<BuiltinPluginModule>,
  gumroad: () => import('./gumroad/index') as Promise<BuiltinPluginModule>,
  hackerrank_work: () => import('./hackerrank_work/index') as Promise<BuiltinPluginModule>,
  intelliprint: () => import('./intelliprint/index') as Promise<BuiltinPluginModule>,
  ip2proxy: () => import('./ip2proxy/index') as Promise<BuiltinPluginModule>,
  ipgeolocation_io: () => import('./ipgeolocation_io/index') as Promise<BuiltinPluginModule>,
  ipqualityscore: () => import('./ipqualityscore/index') as Promise<BuiltinPluginModule>,
  jobnimbus: () => import('./jobnimbus/index') as Promise<BuiltinPluginModule>,
  kernel: () => import('./kernel/index') as Promise<BuiltinPluginModule>,
  l2s: () => import('./l2s/index') as Promise<BuiltinPluginModule>,
  langbase: () => import('./langbase/index') as Promise<BuiltinPluginModule>,
  laravel_cloud: () => import('./laravel_cloud/index') as Promise<BuiltinPluginModule>,
  latchshot: () => import('./latchshot/index') as Promise<BuiltinPluginModule>,
  leiga: () => import('./leiga/index') as Promise<BuiltinPluginModule>,
  lemlist: () => import('./lemlist/index') as Promise<BuiltinPluginModule>,
  lightfield: () => import('./lightfield/index') as Promise<BuiltinPluginModule>,
  livesession: () => import('./livesession/index') as Promise<BuiltinPluginModule>,
  lob: () => import('./lob/index') as Promise<BuiltinPluginModule>,
  logsnag: () => import('./logsnag/index') as Promise<BuiltinPluginModule>,
  loomio: () => import('./loomio/index') as Promise<BuiltinPluginModule>,
  loyverse: () => import('./loyverse/index') as Promise<BuiltinPluginModule>,
  meituan: () => import('./meituan/index') as Promise<BuiltinPluginModule>,
  mistral_ai: () => import('./mistral_ai/index') as Promise<BuiltinPluginModule>,
  mocean: () => import('./mocean/index') as Promise<BuiltinPluginModule>,
  moosend: () => import('./moosend/index') as Promise<BuiltinPluginModule>,
  mother_duck: () => import('./mother_duck/index') as Promise<BuiltinPluginModule>,
  next_dns: () => import('./next_dns/index') as Promise<BuiltinPluginModule>,
  ngrok: () => import('./ngrok/index') as Promise<BuiltinPluginModule>,
  notes: () => import('./notes/index') as Promise<BuiltinPluginModule>,
  open_exchange_rates: () => import('./open_exchange_rates/index') as Promise<BuiltinPluginModule>,
  openai: () => import('./openai/index') as Promise<BuiltinPluginModule>,
  opengraph_io: () => import('./opengraph_io/index') as Promise<BuiltinPluginModule>,
  opensea: () => import('./opensea/index') as Promise<BuiltinPluginModule>,
  paddle: () => import('./paddle/index') as Promise<BuiltinPluginModule>,
  pivotal_tracker: () => import('./pivotal_tracker/index') as Promise<BuiltinPluginModule>,
  prerender: () => import('./prerender/index') as Promise<BuiltinPluginModule>,
  productboard: () => import('./productboard/index') as Promise<BuiltinPluginModule>,
  readwise: () => import('./readwise/index') as Promise<BuiltinPluginModule>,
  realphonevalidation: () => import('./realphonevalidation/index') as Promise<BuiltinPluginModule>,
  recharge: () => import('./recharge/index') as Promise<BuiltinPluginModule>,
  recruitcrm: () => import('./recruitcrm/index') as Promise<BuiltinPluginModule>,
  render: () => import('./render/index') as Promise<BuiltinPluginModule>,
  resend: () => import('./resend/index') as Promise<BuiltinPluginModule>,
  riveter: () => import('./riveter/index') as Promise<BuiltinPluginModule>,
  rocketlane: () => import('./rocketlane/index') as Promise<BuiltinPluginModule>,
  rootly: () => import('./rootly/index') as Promise<BuiltinPluginModule>,
  runpod: () => import('./runpod/index') as Promise<BuiltinPluginModule>,
  saas_custom_domains: () => import('./saas_custom_domains/index') as Promise<BuiltinPluginModule>,
  satismeter: () => import('./satismeter/index') as Promise<BuiltinPluginModule>,
  scrapfly: () => import('./scrapfly/index') as Promise<BuiltinPluginModule>,
  scrapingbee: () => import('./scrapingbee/index') as Promise<BuiltinPluginModule>,
  screenshot_fyi: () => import('./screenshot_fyi/index') as Promise<BuiltinPluginModule>,
  sendfox: () => import('./sendfox/index') as Promise<BuiltinPluginModule>,
  shodan: () => import('./shodan/index') as Promise<BuiltinPluginModule>,
  slab: () => import('./slab/index') as Promise<BuiltinPluginModule>,
  sling: () => import('./sling/index') as Promise<BuiltinPluginModule>,
  statamic: () => import('./statamic/index') as Promise<BuiltinPluginModule>,
  store_leads: () => import('./store_leads/index') as Promise<BuiltinPluginModule>,
  storecensus: () => import('./storecensus/index') as Promise<BuiltinPluginModule>,
  stormglass_io: () => import('./stormglass_io/index') as Promise<BuiltinPluginModule>,
  stripe: () => import('./stripe/index') as Promise<BuiltinPluginModule>,
  telnyx: () => import('./telnyx/index') as Promise<BuiltinPluginModule>,
  templated: () => import('./templated/index') as Promise<BuiltinPluginModule>,
  tldv: () => import('./tldv/index') as Promise<BuiltinPluginModule>,
  uptimerobot: () => import('./uptimerobot/index') as Promise<BuiltinPluginModule>,
  userflow: () => import('./userflow/index') as Promise<BuiltinPluginModule>,
  whop: () => import('./whop/index') as Promise<BuiltinPluginModule>,
  woodpecker_co: () => import('./woodpecker_co/index') as Promise<BuiltinPluginModule>,
  workos: () => import('./workos/index') as Promise<BuiltinPluginModule>,
  zhihu: () => import('./zhihu/index') as Promise<BuiltinPluginModule>,
  zipcodebase: () => import('./zipcodebase/index') as Promise<BuiltinPluginModule>,
  zorus: () => import('./zorus/index') as Promise<BuiltinPluginModule>,
}

/** 宿主传给插件的 env(Node 宿主常用 process.env;CF 宿主用 Worker env)。 */
export type BuiltinPluginEnv = Record<string, string | undefined>

/**
 * 组装 pluginBindings(binding 名 → fetch handler)。返回 Map 与 gateway 的
 * `PluginBindings` 结构兼容(此包不依赖 gateway,靠结构类型对接)。
 * opts.include 给出时只装配指定子集(CF 宿主按构建体积裁剪集合)。
 */
export function builtinPluginBindings(
  env: BuiltinPluginEnv,
  opts: { include?: readonly string[] } = {},
): Map<string, (request: Request) => Promise<Response>> {
  const names = opts.include ?? Object.keys(BUILTIN_PLUGIN_LOADERS)
  const bindings = new Map<string, (request: Request) => Promise<Response>>()
  for (const name of names) {
    const loader = BUILTIN_PLUGIN_LOADERS[name]
    if (loader === undefined) throw new Error(`unknown builtin plugin '${name}'`)
    let loaded: Promise<BuiltinPluginModule> | undefined
    bindings.set(name, async (request) => {
      loaded ??= loader()
      const mod = await loaded
      return await mod.default.fetch(request, env as never)
    })
  }
  return bindings
}
