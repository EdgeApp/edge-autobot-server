/**
 * Shared Tenderly simulation utilities used by multiple bots.
 */
import { retryFetch } from '../../../common/utils'

// Minimal transaction shape needed for simulation (avoids coupling to sweeper types)
export interface TxLike {
  to?: string | null
  from?: string
  data?: string
  value?: bigint
  gasLimit?: bigint
  chainId?: number
}

export interface TenderlyConfigLike {
  accountSlug: string
  projectSlug: string
  accessKey: string
}

export interface AssetChange {
  symbol: string
  decimals: number
  type: string
  from: string
  to: string
  rawAmount: string
  dollarValue: string
}

export interface ValidationTx {
  label: string
  chainId: number
  fromAddress: string
  tx: TxLike
  authorization?: string
}

export interface TenderlySimulationResult {
  ok: boolean
  txLabel: string
  chainId: number
  statusCode?: number
  authorization?: string
  values: {
    simulationId?: string
    status?: string | number | boolean
    gasUsed?: string | number
    blockNumber?: string | number
    from?: string
    to?: string
    value?: string | number
    networkId?: string | number
    errorMessage?: string
  }
  assetChanges: AssetChange[]
}

// ---------------------------------------------------------------------------
// Low-level JSON helpers
// ---------------------------------------------------------------------------

export function getString(
  obj: Record<string, unknown>,
  key: string
): string | undefined {
  const value = obj[key]
  return typeof value === 'string' ? value : undefined
}

export function getSimpleValue(
  obj: Record<string, unknown>,
  key: string
): string | number | boolean | undefined {
  const value = obj[key]
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? value
    : undefined
}

export function getStringOrNumber(
  obj: Record<string, unknown>,
  key: string
): string | number | undefined {
  const value = obj[key]
  return typeof value === 'string' || typeof value === 'number'
    ? value
    : undefined
}

export function getRecord(
  obj: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const value = obj[key]
  if (value == null || typeof value !== 'object') return undefined
  return value as Record<string, unknown>
}

export function bigintToString(value: bigint | undefined): string {
  return value != null ? value.toString() : '0'
}

// ---------------------------------------------------------------------------
// Config / parsing
// ---------------------------------------------------------------------------

/**
 * Extracts Tenderly credentials from a bot config object, falling back to
 * environment variables. Throws if any credential is missing.
 *
 * @param config - The raw bot plugin config (e.g. pluginConfig.lifi or pluginConfig.sweeper)
 * @param pluginName - Name used in the error message (e.g. "lifi" or "sweeper")
 */
export function getTenderlyConfig(
  config: Record<string, unknown>,
  pluginName: string
): TenderlyConfigLike {
  const tenderlyRaw =
    config.tenderly != null && typeof config.tenderly === 'object'
      ? (config.tenderly as Record<string, unknown>)
      : undefined

  const accountSlug =
    getString(tenderlyRaw ?? {}, 'accountSlug') ??
    process.env.TENDERLY_ACCOUNT_SLUG
  const projectSlug =
    getString(tenderlyRaw ?? {}, 'projectSlug') ??
    process.env.TENDERLY_PROJECT_SLUG
  const accessKey =
    getString(tenderlyRaw ?? {}, 'accessKey') ?? process.env.TENDERLY_ACCESS_KEY

  if (accountSlug == null || projectSlug == null || accessKey == null) {
    throw new Error(
      `Missing Tenderly config. Provide pluginConfig.${pluginName}.tenderly.{accountSlug,projectSlug,accessKey} or TENDERLY_ACCOUNT_SLUG/TENDERLY_PROJECT_SLUG/TENDERLY_ACCESS_KEY env vars.`
    )
  }

  return { accountSlug, projectSlug, accessKey }
}

export function parseAssetChanges(
  transactionInfo: Record<string, unknown> | undefined
): AssetChange[] {
  if (transactionInfo == null) return []
  const raw = transactionInfo.asset_changes
  if (!Array.isArray(raw)) return []
  const changes: AssetChange[] = []
  for (const entry of raw as Array<Record<string, unknown>>) {
    const tokenInfo = getRecord(entry, 'token_info')
    changes.push({
      symbol: getString(tokenInfo ?? {}, 'symbol') ?? '???',
      decimals: Number(getStringOrNumber(tokenInfo ?? {}, 'decimals') ?? 18),
      type: getString(entry, 'type') ?? 'Transfer',
      from: getString(entry, 'from') ?? '',
      to: getString(entry, 'to') ?? '',
      rawAmount: getString(entry, 'raw_amount') ?? '0',
      dollarValue: getString(entry, 'dollar_value') ?? ''
    })
  }
  return changes
}

export function parseBundleResults(
  parsed: Record<string, unknown>,
  txs: Array<{ label: string; chainId: number; authorization?: string }>
): TenderlySimulationResult[] {
  const results: TenderlySimulationResult[] = []
  const simulations = Array.isArray(parsed.simulation_results)
    ? (parsed.simulation_results as Array<Record<string, unknown>>)
    : []

  for (let i = 0; i < txs.length; i++) {
    const sim = simulations[i] ?? {}
    const simulation = getRecord(sim, 'simulation') ?? sim
    const transaction =
      getRecord(sim, 'transaction') ?? getRecord(simulation, 'transaction')
    const transactionInfo = getRecord(transaction ?? {}, 'transaction_info')
    const error = getRecord(simulation, 'error')

    const values = {
      simulationId: getString(simulation, 'id') ?? getString(sim, 'id'),
      status:
        getSimpleValue(simulation, 'status') ??
        getSimpleValue(transaction ?? {}, 'status'),
      gasUsed:
        getStringOrNumber(simulation, 'gas_used') ??
        getStringOrNumber(transaction ?? {}, 'gas_used'),
      blockNumber:
        getStringOrNumber(simulation, 'block_number') ??
        getStringOrNumber(transaction ?? {}, 'block_number'),
      from:
        getString(transaction ?? {}, 'from') ?? getString(simulation, 'from'),
      to: getString(transaction ?? {}, 'to') ?? getString(simulation, 'to'),
      value:
        getStringOrNumber(transaction ?? {}, 'value') ??
        getStringOrNumber(simulation, 'value'),
      networkId:
        getStringOrNumber(simulation, 'network_id') ?? String(txs[i].chainId),
      errorMessage:
        getString(error ?? {}, 'message') ??
        getString(simulation, 'error_message') ??
        getString(sim, 'error')
    }

    const status = getSimpleValue(simulation, 'status')
    const ok = status === true || status === 1 || status === '1'

    results.push({
      ok,
      txLabel: txs[i].label,
      chainId: txs[i].chainId,
      statusCode: 200,
      authorization: txs[i].authorization,
      values,
      assetChanges: parseAssetChanges(transactionInfo)
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// Core simulation
// ---------------------------------------------------------------------------

export async function simulateBundleTxs(
  tenderly: TenderlyConfigLike,
  txs: ValidationTx[]
): Promise<TenderlySimulationResult[]> {
  if (txs.length === 0) return []
  const chainId = txs[0].chainId

  const simulations = txs.map(tx => ({
    network_id: String(chainId),
    from: tx.tx.from ?? tx.fromAddress,
    to: tx.tx.to ?? '',
    input: tx.tx.data ?? '0x',
    value: bigintToString(tx.tx.value),
    gas: Math.max(
      tx.tx.gasLimit != null ? Number(tx.tx.gasLimit) : 0,
      8_000_000
    ),
    simulation_type: 'full',
    save: false,
    save_if_fails: false
  }))

  const url = `https://api.tenderly.co/api/v1/account/${tenderly.accountSlug}/project/${tenderly.projectSlug}/simulate-bundle`
  const response = await retryFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Key': tenderly.accessKey
    },
    body: JSON.stringify({ simulations })
  })

  let parsed: Record<string, unknown> = {}
  try {
    parsed = (await response.json()) as Record<string, unknown>
  } catch {
    parsed = {}
  }

  if (!response.ok) {
    const errorMsg =
      getString(parsed, 'error') ??
      getString(getRecord(parsed, 'error') ?? {}, 'message') ??
      `HTTP ${response.status}`
    return txs.map(tx => ({
      ok: false,
      txLabel: tx.label,
      chainId: tx.chainId,
      statusCode: response.status,
      authorization: tx.authorization,
      values: { errorMessage: errorMsg },
      assetChanges: []
    }))
  }

  return parseBundleResults(parsed, txs)
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export function formatNetImpact(
  walletAddress: string,
  results: TenderlySimulationResult[]
): string {
  const netBySymbol = new Map<
    string,
    { amount: bigint; decimals: number; dollarIn: number; dollarOut: number }
  >()
  for (const result of results) {
    for (const ac of result.assetChanges) {
      const entry = netBySymbol.get(ac.symbol) ?? {
        amount: BigInt(0),
        decimals: ac.decimals,
        dollarIn: 0,
        dollarOut: 0
      }
      const rawAmount =
        ac.rawAmount != null && ac.rawAmount !== '' ? ac.rawAmount : '0'
      const raw = BigInt(rawAmount)
      const dollarValue =
        ac.dollarValue != null && ac.dollarValue !== '' ? ac.dollarValue : '0'
      const dollars = parseFloat(dollarValue)
      if (ac.to.toLowerCase() === walletAddress) {
        entry.amount += raw
        entry.dollarIn += dollars
      }
      if (ac.from.toLowerCase() === walletAddress) {
        entry.amount -= raw
        entry.dollarOut += dollars
      }
      netBySymbol.set(ac.symbol, entry)
    }
  }
  const lines: string[] = []
  for (const [symbol, entry] of Array.from(netBySymbol.entries())) {
    if (entry.amount === BigInt(0)) continue
    const sign = entry.amount >= BigInt(0) ? '+' : '-'
    const abs = entry.amount >= BigInt(0) ? entry.amount : -entry.amount
    const whole = abs / BigInt(10 ** entry.decimals)
    const frac = abs % BigInt(10 ** entry.decimals)
    const fracStr = frac.toString().padStart(entry.decimals, '0').slice(0, 6)
    const netDollar = entry.dollarIn - entry.dollarOut
    const dollarStr =
      netDollar >= 0
        ? `+$${netDollar.toFixed(2)}`
        : `-$${Math.abs(netDollar).toFixed(2)}`
    lines.push(`  ${symbol}: ${sign}${whole}.${fracStr} (${dollarStr})`)
  }
  return lines.length > 0 ? `  Net balance impact:\n${lines.join('\n')}` : ''
}
