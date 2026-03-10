/**
 * Format sweeper results as ASCII tables per chain.
 */
import type { SweeperChainResult } from './types'

function pad(s: string, width: number): string {
  return s.slice(0, width).padEnd(width)
}

export function formatChainTable(result: SweeperChainResult): string {
  const lines: string[] = []
  const chainHeader = `${result.pluginId} (chainId ${result.chainId}) — target: ${result.target.type.toUpperCase()}`
  lines.push(chainHeader)
  lines.push('─'.repeat(60))
  lines.push(pad('Token', 12) + pad('Balance', 24) + pad('USD', 14))
  lines.push('─'.repeat(60))

  for (const t of result.tokens) {
    const balance = t.balance
    const balanceShort =
      balance.length > 20 ? balance.slice(0, 8) + '…' : balance
    lines.push(
      pad(t.symbol, 12) + pad(balanceShort, 24) + pad(t.usdValue.toFixed(2), 14)
    )
  }
  const nativeShort =
    result.nativeBalance.length > 18
      ? result.nativeBalance.slice(0, 14) + '…'
      : result.nativeBalance
  lines.push(
    pad('Native', 12) +
      pad(nativeShort, 24) +
      pad(result.nativeUsdValue.toFixed(2), 14)
  )
  lines.push('')
  lines.push(
    `Target: ${result.target.type} ($${result.target.usdValue.toFixed(2)}). Tokens to swap: ${result.tokensToSwap.length}`
  )
  return lines.join('\n')
}

export function formatSummary(results: SweeperChainResult[]): string {
  const lines: string[] = ['Summary', '═'.repeat(40)]
  let totalUsd = 0
  for (const r of results) {
    const chainUsd =
      r.tokens.reduce((s, t) => s + t.usdValue, 0) + r.nativeUsdValue
    totalUsd += chainUsd
    lines.push(
      `${r.pluginId}: $${chainUsd.toFixed(2)} (target: ${r.target.type}, ${r.tokensToSwap.length} swaps)`
    )
  }
  lines.push('─'.repeat(40))
  lines.push(`Total (all chains): $${totalUsd.toFixed(2)}`)
  return lines.join('\n')
}
