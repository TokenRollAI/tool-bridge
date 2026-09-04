import { defineConfig } from 'vitest/config'

/** Host-neutral Hono tests; Node socket and infrastructure contracts live in server tests. */
export default defineConfig({
  test: {
    environment: 'node',
  },
})
