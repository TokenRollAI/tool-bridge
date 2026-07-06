import { defineConfig } from 'vitest/config'

// 仅收敛本包 test/ 下的单测;命令级测试用注入 fetch mock,不起真实网关。
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
})
