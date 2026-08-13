import { expect, it } from 'vitest'
import { BUILTIN_PLUGIN_LOADERS } from '../../src/registry'

/**
 * 内置插件目录的**漂移闸门**:装配表必须与 `src/` 的磁盘目录一致。
 *
 * 为什么值得一条独立测试:漏一个 loader 的后果是那个插件**挂不上树且零报错** ——
 * 实测在两轮批量迁移里各漏过一次(mattermost、googledocs),都是形状闸门事后抓到的。
 * 表现在由 `scripts/generateRegistry.mjs` 生成,这条测试防的是"改了目录忘了重新生成"。
 *
 * **不用 node:fs 扫目录**:本包的 tsconfig 是宿主中立的(`tsconfig.plugin.json`,
 * 无 Node 全局)—— 插件代码不该依赖 Node,测试也一样。用 vite 的 `import.meta.glob`
 * 拿磁盘事实,它在编译期展开成静态清单,与运行时环境无关。
 */

/**
 * 磁盘上每个 `src/<name>/index.ts` —— 这就是"一个插件"的定义。
 *
 * `eager: true` 是本仓 glob 类型声明支持的唯一形态(见 `test/vite-env.d.ts`)。
 * 这里只取键名,值被不被 eager 加载都不影响结果;而形状闸门本来也会加载全部产物。
 */
const ON_DISK = Object.keys(
  import.meta.glob<unknown>('../../src/*/index.ts', { eager: true }),
)
  .map(path => path.replace('../../src/', '').replace('/index.ts', ''))
  .sort()

it('装配表 === 磁盘上的插件目录(加删插件后要重跑 generate:registry)', () => {
  expect(Object.keys(BUILTIN_PLUGIN_LOADERS).sort()).toEqual(ON_DISK)
})

it('磁盘目录非空,且不含 _runtime(共享代码不是插件)', () => {
  // 防呆:上面那条在"两边都空"时也会绿。
  expect(ON_DISK.length).toBeGreaterThan(0)
  expect(ON_DISK).not.toContain('_runtime')
})
