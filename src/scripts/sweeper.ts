#!/usr/bin/env node
/**
 * Multi-chain token sweeper CLI.
 * Usage: node -r sucrase/register src/scripts/sweeper.ts <address> [--chain ethereum|...] [--dust-threshold 1.00] [--slippage 2] [--num-txs 10] [--dry-run] [--bridge]
 */
import { config } from '../config'
import { CHAINS, initRpcUrls } from '../server/bots/sweeper/chainConfig'
import { asSweeperConfig } from '../server/bots/sweeper/config'
import { runSweeper } from '../server/bots/sweeper/runner'

function parseArgs(): {
  address: string
  chainIds?: number[]
  dustThresholdUsd: number
  slippage: number
  numTxs?: number
  dryRun: boolean
  bridge: boolean
} {
  const args = process.argv.slice(2)
  const address = args.find(a => a.startsWith('0x') && a.length === 42)
  if (address == null) {
    console.error(
      'Usage: node -r sucrase/register src/scripts/sweeper.ts <0x address> [--chain ethereum|polygon|arbitrum|optimism|zksync|base] [--dust-threshold 1.00] [--slippage 2] [--num-txs 10] [--dry-run] [--bridge]'
    )
    process.exit(1)
  }
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
  let dustThresholdUsd = 1
  const dustIdx = args.indexOf('--dust-threshold')
  const dustArg = dustIdx >= 0 ? args[dustIdx + 1] : undefined
  if (dustIdx >= 0 && dustArg !== undefined && dustArg !== '') {
    dustThresholdUsd = parseFloat(dustArg)
  }
  let slippage = 1
  const slipIdx = args.indexOf('--slippage')
  const slipArg = slipIdx >= 0 ? args[slipIdx + 1] : undefined
  if (slipIdx >= 0 && slipArg !== undefined && slipArg !== '') {
    slippage = parseInt(slipArg, 10)
  }
  let numTxs: number | undefined
  const maxTxIdx = args.indexOf('--num-txs')
  const maxTxArg = maxTxIdx >= 0 ? args[maxTxIdx + 1] : undefined
  if (maxTxIdx >= 0) {
    const parsed = maxTxArg != null ? parseInt(maxTxArg, 10) : NaN
    if (Number.isNaN(parsed) || parsed <= 0) {
      console.error('Invalid --num-txs value. Expected positive integer.')
      process.exit(1)
    }
    numTxs = parsed
  }
  const dryRun = args.includes('--dry-run')
  const bridge = args.includes('--bridge')
  return {
    address,
    chainIds,
    dustThresholdUsd,
    slippage,
    numTxs,
    dryRun,
    bridge
  }
}

async function main(): Promise<void> {
  const raw = config as Record<string, unknown>
  const sweeperRaw =
    raw?.pluginConfig != null && typeof raw.pluginConfig === 'object'
      ? (raw.pluginConfig as Record<string, unknown>).sweeper
      : undefined
  if (sweeperRaw == null) {
    console.error('Missing pluginConfig.sweeper in serverConfig.json')
    process.exit(1)
  }
  const sweeperConfig = asSweeperConfig(sweeperRaw)
  initRpcUrls(sweeperConfig.infuraProjectId, sweeperConfig.drpcApiKey)

  await runSweeper(sweeperConfig, parseArgs())
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
