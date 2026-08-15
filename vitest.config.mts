import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // PGlite runs in-process, so each worker gets its own in-memory database and
    // migrates it on first use. Running files sequentially keeps that predictable
    // and the suite is fast enough not to miss the parallelism.
    fileParallelism: false,
  },
})
