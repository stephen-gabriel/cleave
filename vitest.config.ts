import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { include: ['frontend-tests/**/*.test.ts'], maxWorkers: 1, fileParallelism: false },
})
