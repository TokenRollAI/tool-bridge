import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const sdkAliases = {
  '@tool-bridge/sdk/client': fileURLToPath(new URL('../sdk/src/client/index.ts', import.meta.url)),
  '@tool-bridge/sdk/store': fileURLToPath(new URL('../sdk/src/store/index.ts', import.meta.url)),
}

/**
 * 两个 project,因为这个包有两类断言对象:
 *
 * - **node**:纯 builder / plan 逻辑(wire payload 形状、校验判据)。不碰 DOM,跑得最快,
 *   是主力;`@/` 别名不需要,因为那些模块只 import 类型与同目录纯函数。
 * - **dom**:组件行为(对话框生命周期、按 descriptor 生成的输入、调用顺序)。用 jsdom ——
 *   纯逻辑测不出"先写凭证再挂载"这类**顺序**性质,而那正是挂载探针能否通过的前提。
 *
 * 真实浏览器证据仍不可替代(横向溢出、console、焦点),那条在 gateway 的 ui.integration
 * 与人工核对里;这里补的是可重跑的组件级回归。
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: sdkAliases },
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.test.ts'],
        },
      },
      {
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            ...sdkAliases,
          },
        },
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['test/**/*.dom.test.tsx'],
          setupFiles: ['./test/dom-setup.ts'],
        },
      },
    ],
  },
})
