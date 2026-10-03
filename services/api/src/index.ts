/**
 * Server bootstrap. Deliberately thin: all wiring lives in `app.ts` so the
 * Hono app can be constructed in tests without binding a port.
 *
 * Environment is read once here and passed down explicitly, which keeps the
 * provider chain and decision layer easy to stub in tests.
 */

import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { defaultChain } from '@dsa/provider-chain'
import { createDecisionEngine } from '@dsa/decision-layer'

const VERSION = '0.1.0'
const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.API_HOST ?? '127.0.0.1'

const chain = defaultChain()
const decisions = createDecisionEngine()

const app = createApp({ chain, decisions, version: VERSION })

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`[dsa-api] listening on http://${HOST}:${info.port}`)
  console.log(`[dsa-api] provider tiers: ${chain.map((p) => p.tier).join(' -> ')}`)
  console.log(`[dsa-api] decision layer: ${decisions.isEnabled() ? 'enabled' : 'disabled'}`)
})
