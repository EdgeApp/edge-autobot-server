/**
 * Transaction audit display.
 */
import type {
  PlannedBridge,
  PlannedSwap,
  TransactionRequestLike
} from './types'

export function buildTenderlySimUrl(
  tx: TransactionRequestLike,
  chainId: number
): string {
  const params = new URLSearchParams({
    rawFunctionInput: tx.data ?? '',
    from: tx.from ?? '',
    to: tx.to ?? '',
    value: String(tx.value ?? 0),
    network: String(chainId),
    gas: String(tx.gasLimit ?? 0)
  })
  return `https://dashboard.tenderly.co/simulator/new?${params.toString()}`
}

export function formatTxAudit(
  index: number,
  total: number,
  planned: PlannedSwap
): string {
  const swapTx = planned.swapTx
  const dataStr = swapTx.data ?? ''
  const dataPreview =
    dataStr.length > 20
      ? `${dataStr.slice(0, 18)}... (${dataStr.length} bytes)`
      : dataStr
  const authorizationLabel =
    planned.authorization === 'permit'
      ? 'permit (off-chain signature)'
      : planned.authorization === 'approve'
        ? 'approve'
        : 'none'
  const lines: string[] = [
    `── Swap ${index + 1}/${total}: ${planned.tokenSymbol} → ${planned.targetSymbol} (${planned.pluginId}) ──`,
    `  Auth:      ${authorizationLabel}`,
    `  To:        ${swapTx.to ?? '—'}`,
    `  Value:     ${swapTx.value != null ? `${swapTx.value} wei` : '0'}`,
    `  Data:      ${dataPreview}`,
    `  Gas Limit: ${swapTx.gasLimit ?? '—'}`
  ]
  if (planned.approvalTx != null) {
    lines.unshift(`  Approval:  to ${planned.approvalTx.to} (approve router)`)
  }
  return lines.join('\n')
}

export function formatAuditReport(planned: PlannedSwap[]): string {
  const lines: string[] = ['Audit: Planned transactions', '═'.repeat(50)]
  const total = planned.length
  for (let i = 0; i < planned.length; i++) {
    lines.push(formatTxAudit(i, total, planned[i]))
    lines.push('')
  }
  return lines.join('\n')
}

export function formatBridgeAuditReport(planned: PlannedBridge[]): string {
  const lines: string[] = [
    'Audit: Cross-Chain Bridge Transactions',
    '═'.repeat(50)
  ]
  const total = planned.length
  for (let i = 0; i < planned.length; i++) {
    const p = planned[i]
    const dataStr = p.bridgeTx.data ?? ''
    const dataPreview =
      dataStr.length > 20
        ? `${dataStr.slice(0, 18)}... (${dataStr.length} bytes)`
        : dataStr
    const authorizationLabel =
      p.authorization === 'permit'
        ? 'permit (off-chain signature)'
        : p.authorization === 'approve'
          ? 'approve'
          : 'none'
    const bridgeLines: string[] = [
      `── Bridge ${i + 1}/${total}: ${p.sourceSymbol} (${p.sourcePluginId}) → ${p.targetSymbol} ──`,
      `  Auth:      ${authorizationLabel}`,
      `  To:        ${p.bridgeTx.to ?? '—'}`,
      `  Value:     ${p.bridgeTx.value != null ? `${p.bridgeTx.value} wei` : '0'}`,
      `  Data:      ${dataPreview}`,
      `  Gas Limit: ${p.bridgeTx.gasLimit ?? '—'}`
    ]
    if (p.approvalTx != null) {
      bridgeLines.unshift(
        `  Approval:  to ${p.approvalTx.to} (approve bridge router)`
      )
    }
    lines.push(bridgeLines.join('\n'))
    lines.push('')
  }
  return lines.join('\n')
}
