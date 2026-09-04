import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['test/**/*.test.ts'],
  },
})
