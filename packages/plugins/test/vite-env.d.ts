/**
 * `import.meta.glob` 的最小类型声明。
 *
 * 本包的 tsconfig 刻意 `types: []`(插件产物不得依赖任何宿主专属类型),而 glob 是 vite/
 * vitest 的构建期特性,只在**测试**里用来批量收集迁移产物。为它整包引入 `vite/client`
 * 会把一堆浏览器/构建期全局塞进插件源码的可见范围,得不偿失,故只声明用到的这一个。
 */
interface ImportMeta {
  glob: <T>(pattern: string, options: { eager: true, import?: string, query?: string }) => Record<string, T>
}
