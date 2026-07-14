#!/usr/bin/env node
/**
 * LiFi integrator fee claimer CLI.
 * Usage: node -r sucrase/register src/scripts/claimLifi.ts [--chain ethereum|...] [--dust-threshold 1.00] [--validate] [--dry-run]
 */
import { config } from '../config'
import { asLifiConfig } from '../server/bots/lifi/config'
import { runClaimLifi } from '../server/bots/lifi/runner'
import { CHAINS, initRpcUrls } from '../server/bots/sweeper/chainConfig'

function parseArgs(): {
  chainIds?: number[]
  dustThresholdUsd?: number
  dryRun: boolean
} {
  const args = process.argv.slice(2)
  let chainIds: number[] | undefined
  const chainIdx = args.indexOf('--chain')
  const chainArg = chainIdx >= 0 ? args[chainIdx + 1] : undefined
  if (chainIdx >= 0 && chainArg !== undefined && chainArg !== '') {
    const pluginId = chainArg.toLowerCase()
    const chain = CHAINS.find(c => c.pluginId === pluginId)
    if (chain != null) chainIds = [chain.chainId]
    else {
      console.error('Unknown chain:', args[chainIdx + 1])
      process.exit(1)
    }
  }
  let dustThresholdUsd: number | undefined
  const dustIdx = args.indexOf('--dust-threshold')
  const dustArg = dustIdx >= 0 ? args[dustIdx + 1] : undefined
  if (dustIdx >= 0 && dustArg !== undefined && dustArg !== '') {
    dustThresholdUsd = parseFloat(dustArg)
  }
  const dryRun = args.includes('--dry-run')
  return { chainIds, dustThresholdUsd, dryRun }
}

async function main(): Promise<void> {
  const raw = config as Record<string, unknown>
  const lifiRaw =
    raw?.pluginConfig != null && typeof raw.pluginConfig === 'object'
      ? (raw.pluginConfig as Record<string, unknown>).lifi
      : undefined
  if (lifiRaw == null) {
    console.error('Missing pluginConfig.lifi in serverConfig.json')
    process.exit(1)
  }
  const lifiConfig = asLifiConfig(lifiRaw)

  if (lifiConfig.evmAddress === '') {
    console.error('Missing pluginConfig.lifi.evmAddress in serverConfig.json')
    process.exit(1)
  }

  initRpcUrls(lifiConfig.infuraProjectId, lifiConfig.drpcApiKey)

  await runClaimLifi(lifiConfig, parseArgs())
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
