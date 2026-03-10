/**
 * Display formatting for LiFi fee balances and withdrawal plans.
 */
import { chainByChainId } from '../sweeper/chainConfig'
import type { LifiChainFees, PlannedWithdrawal } from './types'

export function formatLifiFeesTable(chainFees: LifiChainFees): string {
  const chain = chainByChainId(chainFees.chainId)
  const chainName = chain?.pluginId ?? `chain-${chainFees.chainId}`
  const lines: string[] = [
    `── ${chainName} (${chainFees.chainId}) ──`,
    `  ${'Token'.padEnd(12)} ${'Amount'.padStart(20)} ${'USD'.padStart(12)}`
  ]

  let chainTotal = 0
  for (const tb of chainFees.tokenBalances) {
    const usd = parseFloat(tb.amountUsd)
    chainTotal += isNaN(usd) ? 0 : usd
    lines.push(
      `  ${tb.token.symbol.padEnd(12)} ${tb.amount.padStart(20)} ${`$${usd.toFixed(2)}`.padStart(12)}`
    )
  }
  lines.push(
    `  ${''.padEnd(12)} ${'Total:'.padStart(20)} ${`$${chainTotal.toFixed(2)}`.padStart(12)}`
  )
  return lines.join('\n')
}

export function formatLifiSummary(feeBalances: LifiChainFees[]): string {
  const lines: string[] = ['LiFi Integrator Fee Balances', '═'.repeat(50)]
  let grandTotal = 0

  for (const chainFees of feeBalances) {
    const chain = chainByChainId(chainFees.chainId)
    const chainName = chain?.pluginId ?? `chain-${chainFees.chainId}`
    let chainTotal = 0
    for (const tb of chainFees.tokenBalances) {
      const usd = parseFloat(tb.amountUsd)
      chainTotal += isNaN(usd) ? 0 : usd
    }
    grandTotal += chainTotal
    lines.push(
      `  ${chainName.padEnd(12)} ${chainFees.tokenBalances.length} token(s)  $${chainTotal.toFixed(2)}`
    )
  }
  lines.push('─'.repeat(50))
  lines.push(
    `  ${'Grand Total'.padEnd(12)}              $${grandTotal.toFixed(2)}`
  )

  return lines.join('\n')
}

export function formatWithdrawalAuditReport(
  withdrawals: PlannedWithdrawal[]
): string {
  const lines: string[] = [
    'Audit: Planned Withdrawal Transactions',
    '═'.repeat(50)
  ]
  const total = withdrawals.length
  for (let i = 0; i < withdrawals.length; i++) {
    const w = withdrawals[i]
    const tokenList = w.tokens
      .map(t => `${t.symbol} ($${parseFloat(t.amountUsd).toFixed(2)})`)
      .join(', ')
    const dataStr = w.withdrawTx.data ?? ''
    const dataPreview =
      dataStr.length > 20
        ? `${dataStr.slice(0, 18)}... (${dataStr.length} bytes)`
        : dataStr
    lines.push(
      `── Withdrawal ${i + 1}/${total}: ${w.pluginId} ──`,
      `  Tokens:    ${tokenList}`,
      `  To:        ${w.withdrawTx.to ?? '—'}`,
      `  Data:      ${dataPreview}`,
      ''
    )
  }
  return lines.join('\n')
}
