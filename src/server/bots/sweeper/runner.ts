/**
 * Multi-chain token sweeper orchestration.
 * Called by src/scripts/sweeper.ts after arg parsing and config loading.
 */
import { ethers } from 'ethers'

import {
  formatNetImpact,
  getTenderlyConfig,
  simulateBundleTxs,
  type TenderlySimulationResult,
  type ValidationTx
} from '../common/tenderly'
import { formatAuditReport, formatBridgeAuditReport } from './auditor'
import type { SweeperConfig } from './config'
import { buildBridgePlans } from './crossChainBridge'
import { discoverAllChains } from './discovery'
import { getProvider, promptPrivateKey, signAndSend } from './executor'
import { destroyProviders } from './permit'
import { applyRates, fetchRates } from './rates'
import { formatChainTable, formatSummary } from './reporter'
import { buildPlannedSwap, sortTokensNativeLast } from './swapBuilder'
import { selectTargetsPerChain } from './targetSelection'
import type { PlannedBridge, PlannedSwap } from './types'

export interface SweeperRunOptions {
  address: string
  chainIds?: number[]
  dustThresholdUsd: number
  slippage: number
  numTxs?: number
  dryRun: boolean
  bridge: boolean
}

function countSwapPlanTxs(swaps: PlannedSwap[]): number {
  return swaps.reduce((sum, swap) => {
    let n = 1
    if (swap.resetApprovalTx != null) n++
    if (swap.approvalTx != null) n++
    return sum + n
  }, 0)
}

function getSwapValidationTxs(swap: PlannedSwap): ValidationTx[] {
  const txs: ValidationTx[] = []
  if (swap.resetApprovalTx != null) {
    txs.push({
      label: `${swap.pluginId} ${swap.tokenSymbol} reset approval`,
      chainId: swap.chainId,
      fromAddress: swap.fromAddress,
      tx: swap.resetApprovalTx,
      authorization: swap.authorization
    })
  }
  if (swap.approvalTx != null) {
    txs.push({
      label: `${swap.pluginId} ${swap.tokenSymbol} approval`,
      chainId: swap.chainId,
      fromAddress: swap.fromAddress,
      tx: swap.approvalTx,
      authorization: swap.authorization
    })
  }
  txs.push({
    label: `${swap.pluginId} ${swap.tokenSymbol} -> ${swap.targetSymbol} swap`,
    chainId: swap.chainId,
    fromAddress: swap.fromAddress,
    tx: swap.swapTx,
    authorization: swap.authorization
  })
  return txs
}

function getBridgeValidationTxs(bridges: PlannedBridge[]): ValidationTx[] {
  const txs: ValidationTx[] = []
  for (const bridge of bridges) {
    if (bridge.resetApprovalTx != null) {
      txs.push({
        label: `${bridge.sourcePluginId} ${bridge.sourceSymbol} bridge reset approval`,
        chainId: bridge.sourceChainId,
        fromAddress: bridge.fromAddress,
        tx: bridge.resetApprovalTx,
        authorization: bridge.authorization
      })
    }
    if (bridge.approvalTx != null) {
      txs.push({
        label: `${bridge.sourcePluginId} ${bridge.sourceSymbol} bridge approval`,
        chainId: bridge.sourceChainId,
        fromAddress: bridge.fromAddress,
        tx: bridge.approvalTx,
        authorization: bridge.authorization
      })
    }
    txs.push({
      label: `${bridge.sourcePluginId} ${bridge.sourceSymbol} bridge`,
      chainId: bridge.sourceChainId,
      fromAddress: bridge.fromAddress,
      tx: bridge.bridgeTx,
      authorization: bridge.authorization
    })
  }
  return txs
}

async function validateBridgeTxs(
  config: SweeperConfig,
  bridges: PlannedBridge[],
  walletAddress: string
): Promise<void> {
  const tenderly = getTenderlyConfig(
    config as unknown as Record<string, unknown>,
    'sweeper'
  )
  const txs = getBridgeValidationTxs(bridges)

  if (txs.length === 0) {
    console.log('No bridge transactions to validate.')
    return
  }

  console.log('')
  console.log(`Validating ${txs.length} bridge transactions with Tenderly...`)
  console.log('')

  const allResults: TenderlySimulationResult[] = []

  // Group by chain since bridge txs may span multiple source chains
  const byChain = new Map<number, ValidationTx[]>()
  for (const tx of txs) {
    const group = byChain.get(tx.chainId) ?? []
    group.push(tx)
    byChain.set(tx.chainId, group)
  }

  for (const [chainId, chainTxs] of Array.from(byChain.entries())) {
    const bundleResults = await simulateBundleTxs(tenderly, chainTxs)
    for (const result of bundleResults) {
      allResults.push(result)
      const { simulationId: _, ...valuesNoUrl } = result.values
      console.log(`Simulation: ${result.txLabel} [chain ${chainId}]`)
      console.log(JSON.stringify(valuesNoUrl, null, 2))
      if (result.assetChanges.length > 0 && walletAddress !== '') {
        const impact = formatNetImpact(walletAddress, [result])
        if (impact !== '') console.log(impact)
      }
      console.log('')
    }
  }

  const failed = allResults.filter(r => !r.ok)
  if (failed.length > 0) {
    console.log(
      `Bridge validation finished with ${failed.length} failed transaction${failed.length === 1 ? '' : 's'} out of ${allResults.length}.`
    )
    process.exitCode = 1
  } else {
    console.log(
      `Bridge validation succeeded for ${allResults.length} transaction${allResults.length === 1 ? '' : 's'}.`
    )
  }
}

export async function runSweeper(
  sweeperConfig: SweeperConfig,
  opts: SweeperRunOptions
): Promise<void> {
  const {
    address,
    chainIds,
    dustThresholdUsd,
    slippage,
    numTxs,
    dryRun,
    bridge
  } = opts

  if (dryRun) {
    console.log('[DRY RUN] No transactions will be broadcast or signed.')
  } else {
    console.log('[PRODUCTION] Transactions will be signed and broadcast.')
  }
  console.log('')

  let privateKey = ''
  if (!dryRun) {
    privateKey = await promptPrivateKey()
    if (privateKey === '') {
      console.error('No private key provided. Exiting.')
      process.exit(1)
    }
  }

  console.log(
    'Discovering tokens for',
    address,
    chainIds != null ? `(chain filter: ${chainIds.join(',')})` : '(all chains)'
  )
  console.log('')

  const chainData = await discoverAllChains(sweeperConfig, address, chainIds)
  const rateByKey = await fetchRates(sweeperConfig, chainData)
  const withRates = applyRates(chainData, rateByKey, dustThresholdUsd)
  const results = selectTargetsPerChain(withRates, dustThresholdUsd)

  console.log(formatSummary(results))
  console.log('')
  for (const r of results) {
    console.log(formatChainTable(r))
    console.log('')
  }

  if (numTxs != null) {
    console.log(`Limiting crafted transactions to ${numTxs} via --num-txs.`)
    console.log('')
  }

  const swapPlanned: PlannedSwap[] = []
  let bridgePlanned: PlannedBridge[] = []

  if (bridge) {
    // --bridge: only create bridge transactions (L2 USDC → Ethereum)
    const hasL2Chains = results.some(r => r.chainId !== 1)
    if (hasL2Chains) {
      console.log(
        'Building cross-chain bridge payloads (L2 USDC → Ethereum)...'
      )
      const { planned, skipped: bridgeSkipped } = await buildBridgePlans(
        sweeperConfig,
        results,
        address,
        slippage,
        numTxs
      )
      bridgePlanned = planned
      if (bridgeSkipped.length > 0) {
        console.log(
          'Bridge skipped (no route):',
          bridgeSkipped.map(s => `${s.symbol} on ${s.chainId}`).join(', ')
        )
      }
      if (bridgePlanned.length > 0) {
        console.log('')
        console.log(formatBridgeAuditReport(bridgePlanned))
      } else {
        console.log('No L2 bridge transactions needed.')
      }
    } else {
      console.log('No L2 chains to bridge from.')
    }
  } else {
    // Default: swap all tokens into USDC per chain
    // Quote and simulate each asset immediately to avoid stale quotes
    const tenderly = getTenderlyConfig(
      sweeperConfig as unknown as Record<string, unknown>,
      'sweeper'
    )
    const walletAddress = address.toLowerCase()
    const allSimResults: TenderlySimulationResult[] = []
    let craftedTxs = 0

    // Track nonces per chain so simulation logs and execution use correct values
    const nonceByChain = new Map<number, number>()
    for (const chainResult of results) {
      if (!nonceByChain.has(chainResult.chainId)) {
        const provider = getProvider(chainResult.chainId)
        const nonce = await provider.getTransactionCount(address, 'pending')
        nonceByChain.set(chainResult.chainId, nonce)
      }
    }

    console.log('Quoting and simulating intra-chain swaps (Rango/LiFi)...')
    console.log('')

    for (const chainResult of results) {
      const sortedTokens = sortTokensNativeLast(chainResult.tokensToSwap)
      for (const token of sortedTokens) {
        if (numTxs != null && craftedTxs >= numTxs) break

        const { planned, skipped: skipInfo } = await buildPlannedSwap(
          sweeperConfig,
          chainResult,
          token,
          address,
          slippage
        )

        if (skipInfo != null) {
          console.log(
            `Skipped ${skipInfo.symbol} on chain ${skipInfo.chainId} [${skipInfo.reason}]`
          )
          continue
        }
        if (planned == null) continue

        const planTxCount = countSwapPlanTxs([planned])
        if (numTxs != null && craftedTxs + planTxCount > numTxs) break
        craftedTxs += planTxCount
        swapPlanned.push(planned)

        console.log(formatAuditReport([planned]))

        // Simulate this asset's txs immediately
        if (tenderly != null) {
          const assetTxs = getSwapValidationTxs(planned)
          const simResults = await simulateBundleTxs(tenderly, assetTxs)
          for (const result of simResults) {
            allSimResults.push(result)
            const n = nonceByChain.get(planned.chainId) ?? 0
            const nonceStr = ` [nonce ${n}]`
            // Only advance nonce here if dry-run (no broadcast will follow)
            if (dryRun) {
              nonceByChain.set(planned.chainId, n + 1)
            }
            console.log(
              `  Simulation: ${result.txLabel} [chain ${planned.chainId}]${nonceStr}`
            )
            const { simulationId: _, ...valuesNoUrl } = result.values
            console.log(`  ${JSON.stringify(valuesNoUrl, null, 2)}`)
            if (result.assetChanges.length > 0) {
              const impact = formatNetImpact(walletAddress, [result])
              if (impact !== '') console.log(impact)
            }
          }
        }

        // Broadcast this asset's txs immediately (skip in dry-run)
        if (!dryRun) {
          const txWallet = new ethers.Wallet(privateKey)
          const nextNonce = (): number => {
            const n = nonceByChain.get(planned.chainId) ?? 0
            nonceByChain.set(planned.chainId, n + 1)
            return n
          }
          if (planned.resetApprovalTx != null) {
            try {
              const nonce = nextNonce()
              const hash = await signAndSend(
                txWallet,
                planned.resetApprovalTx,
                nonce
              )
              console.log(
                `  Sent ${planned.tokenSymbol} reset-approve [nonce ${nonce}]: ${hash}`
              )
            } catch (err) {
              console.error(
                `Failed to send ${planned.tokenSymbol} reset-approve:`,
                err
              )
              continue
            }
          }
          if (planned.approvalTx != null) {
            try {
              const nonce = nextNonce()
              const hash = await signAndSend(
                txWallet,
                planned.approvalTx,
                nonce
              )
              console.log(
                `  Sent ${planned.tokenSymbol} approve [nonce ${nonce}]: ${hash}`
              )
            } catch (err) {
              console.error(
                `Failed to send ${planned.tokenSymbol} approve:`,
                err
              )
              continue
            }
          }
          try {
            const nonce = nextNonce()
            const hash = await signAndSend(txWallet, planned.swapTx, nonce)
            console.log(
              `  Sent ${planned.tokenSymbol} swap [nonce ${nonce}]: ${hash}`
            )
          } catch (err) {
            console.error(`Failed to send ${planned.tokenSymbol} swap:`, err)
            continue
          }
        }
        console.log('')
      }
    }

    if (numTxs != null) {
      console.log(
        `Crafted ${craftedTxs} planned transaction${craftedTxs === 1 ? '' : 's'} (limit ${numTxs}).`
      )
    }

    if (dryRun) {
      console.log('')
      console.log(
        '[DRY RUN] Complete. No on-chain transactions will be broadcast.'
      )
    }

    const failed = allSimResults.filter(r => !r.ok)
    console.log('')
    if (failed.length > 0) {
      console.log(
        `Simulation finished with ${failed.length} failed transaction${failed.length === 1 ? '' : 's'} out of ${allSimResults.length}.`
      )
      process.exitCode = 1
    } else {
      console.log(
        `Simulation succeeded for ${allSimResults.length} transaction${allSimResults.length === 1 ? '' : 's'}.`
      )
    }
    if (walletAddress !== '') {
      const totalImpact = formatNetImpact(walletAddress, allSimResults)
      if (totalImpact !== '') {
        console.log('')
        console.log('Total net balance impact on wallet:')
        const lines = totalImpact.split('\n').slice(1)
        console.log(lines.join('\n'))
      }
    }
  }

  if (bridge && bridgePlanned.length > 0) {
    await validateBridgeTxs(sweeperConfig, bridgePlanned, address.toLowerCase())
  }

  destroyProviders()
}
