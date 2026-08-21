import { defineConfig } from 'tsup'

// 打包为单文件 ESM 库(Workers 目标):core 与宿主中立层 `@tool-bridge/app` 经
// devDependencies bundle 进产物,并把类型内联进 dist/index.d.ts(与 sdk/server 同一
// 发布模式)。**app 必须 noExternal**:core 是 private 包不随发布走,每个发布产物各自
// bundle 一份;若把 app 留 external,运行时会同时加载两份 core 副本,`err instanceof
// TBError` 跨副本恒为 false,错误被静默降级成 internal。
// cloudflare:workers 是 workerd 运行时内置模块,只能 external,由消费方 wrangler 解析。
//
// 双入口:
// - index(库形态,零插件)—— npm 消费者按需装配;
// - full(= deployEntry,内置插件全量装配)—— Deploy Button template 与"要和源码部署
//   一致"的消费者用。plugins/plugin-sdk/zod/@modelcontextprotocol/sdk 只被 full 引用,
//   tsup 按入口 tree-shake,dist/index.js 不因此长胖。
export default defineConfig({
  entry: { index: 'src/index.ts', full: 'src/deployEntry.ts' },
  format: ['esm'],
  target: 'es2022',
  platform: 'neutral',
  tsconfig: 'tsconfig.build.json',
  dts: {
    resolve: [
      '@tool-bridge/core',
      '@tool-bridge/app',
      '@tool-bridge/plugins',
      '@tool-bridge/plugin-sdk',
    ],
  },
  clean: true,
  minify: false,
  // platform neutral 缺省不带 node/browser 条件,而 pkce-challenge(@modelcontextprotocol/sdk
  // 传递依赖)的 exports **只有** browser/node 分支 → 不给条件就解析失败。产物跑在 workerd,
  // 按 wrangler 同款条件序解析(workerd > worker > browser)。
  esbuildOptions(options) {
    options.conditions = ['workerd', 'worker', 'browser']
  },
  noExternal: [
    '@tool-bridge/core',
    '@tool-bridge/app',
    // full 入口的插件闭包:plugins 是 private 包必须 bundle;其余三个只为避免把
    // pkce-challenge 等传递依赖变成 gateway 的运行时 dependencies。
    '@tool-bridge/plugins',
    '@tool-bridge/plugin-sdk',
    '@modelcontextprotocol/sdk',
    'zod',
  ],
  external: ['cloudflare:workers'],
})
