/**
 * LiFi integrator fee claimer orchestration.
 * Called by src/scripts/claimLifi.ts after arg parsing and config loading.
 */
import { ethers } from 'ethers'

import {
  formatNetImpact,
  getTenderlyConfig,
  simulateBundleTxs,
  type TenderlySimulationResult,
  type ValidationTx
} from '../common/tenderly'
import { getProvider, promptPrivateKey, signAndSend } from '../sweeper/executor'
import type { LifiConfig } from './config'
import { fetchLifiFees, filterFeeBalances } from './discovery'
import {
  formatLifiFeesTable,
  formatLifiSummary,
  formatWithdrawalAuditReport
} from './reporter'
import type { PlannedWithdrawal } from './types'
import { buildWithdrawals } from './withdrawBuilder'

export interface LifiRunOptions {
  chainIds?: number[]
  dustThresholdUsd?: number
  dryRun: boolean
}

function buildWithdrawalValidationTxs(
  withdrawals: PlannedWithdrawal[]
): ValidationTx[] {
  return withdrawals.map(w => ({
    label: `${w.pluginId} fee withdrawal (${w.tokens.map(t => t.symbol).join(', ')})`,
    chainId: w.chainId,
    fromAddress: w.fromAddress,
    tx: {
      to: w.withdrawTx.to,
      data: w.withdrawTx.data,
      value: w.withdrawTx.value,
      gasLimit: w.withdrawTx.gasLimit,
      chainId: w.chainId
    }
  }))
}

async function validateWithdrawals(
  config: LifiConfig,
  withdrawals: PlannedWithdrawal[]
): Promise<void> {
  const tenderly = getTenderlyConfig(
    config as unknown as Record<string, unknown>,
    'lifi'
  )

  if (withdrawals.length === 0) {
    console.log('No withdrawal transactions to validate.')
    return
  }

  const walletAddress = withdrawals[0].fromAddress.toLowerCase()

  console.log('')
  console.log(`Validating ${withdrawals.length} withdrawal(s) with Tenderly...`)
  console.log('')

  const allResults: TenderlySimulationResult[] = []

  // Group by chainId for bundle simulation
  const byChain = new Map<number, PlannedWithdrawal[]>()
  for (const w of withdrawals) {
    const group = byChain.get(w.chainId) ?? []
    group.push(w)
    byChain.set(w.chainId, group)
  }

  for (const [chainId, chainWithdrawals] of Array.from(byChain.entries())) {
    const chainTxs = buildWithdrawalValidationTxs(chainWithdrawals)
    const bundleResults = await simulateBundleTxs(tenderly, chainTxs)

    for (const result of bundleResults) {
      allResults.push(result)
      console.log(
        `Simulation ${allResults.length}/${withdrawals.length}: ${result.txLabel} [chain ${chainId}]`
      )
      console.log(JSON.stringify(result.values, null, 2))
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
      `Tenderly validation finished with ${failed.length} failed transaction${failed.length === 1 ? '' : 's'} out of ${allResults.length}.`
    )
    process.exitCode = 1
  } else {
    console.log(
      `Tenderly validation succeeded for ${allResults.length} transaction${allResults.length === 1 ? '' : 's'}.`
    )
  }

  if (walletAddress !== '') {
    const totalImpact = formatNetImpact(walletAddress, allResults)
    if (totalImpact !== '') {
      console.log('')
      console.log('Total net balance impact on wallet:')
      const lines = totalImpact.split('\n').slice(1)
      console.log(lines.join('\n'))
    }
  }
}

export async function runClaimLifi(
  lifiConfig: LifiConfig,
  opts: LifiRunOptions
): Promise<void> {
  const { chainIds, dustThresholdUsd: dustOverride, dryRun } = opts
  const dustThresholdUsd = dustOverride ?? lifiConfig.dustThresholdUsd
  const address = lifiConfig.evmAddress

  if (dryRun) {
    console.log(
      '[DRY RUN] Will display fee balances and withdrawal plans only. No transactions will be broadcast.'
    )
  }
  console.log('')

  // 1. Discover fees
  console.log(
    `Fetching LiFi integrator fees for "${lifiConfig.integrator}"`,
    chainIds != null ? `(chain filter: ${chainIds.join(',')})` : '(all chains)'
  )
  console.log('')

  const feesResponse = await fetchLifiFees(lifiConfig)
  const filteredFees = filterFeeBalances(
    feesResponse.feeBalances,
    dustThresholdUsd,
    chainIds
  )

  if (filteredFees.length === 0) {
    console.log(
      `No claimable fees above $${dustThresholdUsd.toFixed(2)} threshold.`
    )
    return
  }

  // 2. Display fee report
  console.log(formatLifiSummary(filteredFees))
  console.log('')
  for (const chainFees of filteredFees) {
    console.log(formatLifiFeesTable(chainFees))
    console.log('')
  }

  // 3. Build withdrawal transactions
  console.log('Building withdrawal transactions...')
  const { planned, skipped } = await buildWithdrawals(
    lifiConfig,
    filteredFees,
    address
  )

  if (skipped.length > 0) {
    console.log(
      'Skipped:',
      skipped.map(s => `chain ${s.chainId} [${s.reason}]`).join(', ')
    )
  }
  console.log('')

  if (planned.length > 0) {
    console.log(formatWithdrawalAuditReport(planned))
  } else {
    console.log('No withdrawal transactions generated.')
  }

  // 4. Tenderly validation
  if (planned.length > 0) {
    await validateWithdrawals(lifiConfig, planned)
  }

  // 5. Broadcast (non-dry-run)
  if (!dryRun && planned.length > 0) {
    const privateKey = await promptPrivateKey()
    if (privateKey === '') {
      console.error('No private key provided. Exiting.')
      process.exit(1)
    }
    const wallet = new ethers.Wallet(privateKey)

    const nonceByChain = new Map<number, number>()
    for (const w of planned) {
      if (!nonceByChain.has(w.chainId)) {
        const provider = getProvider(w.chainId)
        const nonce = await provider.getTransactionCount(
          wallet.address,
          'pending'
        )
        nonceByChain.set(w.chainId, nonce)
      }
    }

    console.log('')
    console.log(`Broadcasting ${planned.length} withdrawal transaction(s)...`)

    for (const w of planned) {
      const nonce = nonceByChain.get(w.chainId)!
      nonceByChain.set(w.chainId, nonce + 1)
      const tokenList = w.tokens.map(t => t.symbol).join(', ')
      try {
        if (w.withdrawTx.gasLimit == null) {
          const provider = getProvider(w.chainId)
          const estimated = await provider.estimateGas({
            from: w.fromAddress,
            to: w.withdrawTx.to,
            data: w.withdrawTx.data,
            value: w.withdrawTx.value ?? BigInt(0)
          })
          // Add 20% buffer for safety
          w.withdrawTx.gasLimit = (estimated * BigInt(120)) / BigInt(100)
        }
        const hash = await signAndSend(wallet, w.withdrawTx, nonce)
        console.log(`  [${w.pluginId}] ${tokenList}: ${hash}`)
      } catch (err) {
        console.error(
          `  [${w.pluginId}] Failed to send tx (${tokenList}):`,
          err
        )
      }
    }

    console.log('')
    console.log('Done.')
  } else if (dryRun) {
    console.log('')
    console.log('[DRY RUN] Complete. No transactions were signed or broadcast.')
  }
}
