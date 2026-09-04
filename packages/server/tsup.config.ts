import { defineConfig } from 'tsup'

// 打包为 ESM 库 + bin(node22 目标):core 与宿主中立层 `@tool-bridge/app` 经
// devDependencies bundle 进产物(与 SDK 同一发布模式);运行时依赖留 external
// (better-sqlite3 是 native 模块绝不可 bundle)。**app 必须 noExternal**:private 的
// core 由每个发布产物各自 bundle,若 app 留 external 则运行时两份 core 副本并存,
// `err instanceof TBError` 跨副本恒为 false。
// `@tool-bridge/plugins` 同理 noExternal(private 包,且 `main.ts` 装配全量内置目录 ——
// Node/Docker 宿主的 catalog 从此与 Workers 对等,不再因部署形态归零)。
// dts.resolve 必须是数组而非 true:true 会把 node 内置模块也内联,曾把
// `http.Server` 降级成 undefined(2026-07-08 反思)。
//
// external 清单的铁律:**留 external 的每个 specifier 都必须出现在本包 `dependencies`**,
// 否则 `pnpm --prod deploy` 出来的 Docker 镜像与 `npm install` 到的产物在首次 import 时
// 才 MODULE_NOT_FOUND。曾经的事故:`@modelcontextprotocol/sdk`(v1)在 app 迁到 v2 后从
// dependencies 删掉,但 external 没同步删;三天后 plugins 进 noExternal,feishu provider
// 把 v1 import 重新带回闭包 —— 源码 tsx 能从 plugins 的 node_modules 解析,构建产物不能。
// 现在 v1 sdk 随 feishu 一起 bundle(与 gateway/full 同形),并由
// scripts/pack-and-verify-package.mjs 对全部 public 包做"裸 import ⊆ 声明依赖 ∪ Node 内建"闸门。
export default defineConfig({
  entry: { index: 'src/index.ts', main: 'src/main.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  tsconfig: 'tsconfig.build.json',
  dts: {
    entry: { index: 'src/index.ts' },
    // app/core 的公开类型包含 Zod 推导；一起内联，避免 packed declarations
    // 指向未声明的传递依赖。
    resolve: ['@tool-bridge/core', '@tool-bridge/app', 'zod'],
  },
  clean: true,
  minify: false,
  noExternal: ['@tool-bridge/core', '@tool-bridge/app', '@tool-bridge/plugins'],
  external: [
    'better-sqlite3',
    'ws',
    'hono',
    '@hono/node-server',
    'aws4fetch',
    '@cfworker/json-schema',
    '@tool-bridge/dashboard',
  ],
})
