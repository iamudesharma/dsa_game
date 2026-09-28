import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@dsa/game-schema': fileURLToPath(new URL('./packages/game-schema/src/index.ts', import.meta.url)),
      '@dsa/game-engine': fileURLToPath(new URL('./packages/game-engine/src/index.ts', import.meta.url)),
      '@dsa/dsa-oracles': fileURLToPath(new URL('./packages/dsa-oracles/src/index.ts', import.meta.url)),
      '@dsa/provider-chain': fileURLToPath(new URL('./packages/provider-chain/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'services/**/*.test.ts', 'apps/web/**/*.test.ts'],
    environment: 'node',
  },
})
