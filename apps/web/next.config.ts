import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The shared packages ship TypeScript sources rather than built output, so
  // they are transpiled by the app rather than imported from dist.
  transpilePackages: ['@dsa/game-schema', '@dsa/game-engine', '@dsa/dsa-oracles'],

  // Those sources use `.js` specifiers internally (`export * from './state.js'`),
  // which is the correct convention for ESM/NodeNext TypeScript. webpack has no
  // idea that the target file is actually `state.ts`, so without this alias any
  // *value* import from the shared packages fails the build. Type-only imports
  // are erased and never reach the bundler, which is why this went unnoticed
  // until something needed a runtime constant.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    }
    return config
  },
}

export default nextConfig
