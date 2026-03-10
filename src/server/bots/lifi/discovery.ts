/**
 * LiFi fee discovery — fetches integrator fee balances from the LiFi API.
 */
import { retryFetch } from '../../../common/utils'
import { chainByChainId } from '../sweeper/chainConfig'
import type { LifiConfig } from './config'
import type { LifiChainFees, LifiFeesResponse } from './types'

const LIFI_API_BASE = 'https://li.quest/v1'

export async function fetchLifiFees(
  config: LifiConfig
): Promise<LifiFeesResponse> {
  const { integrator, lifiApiKey } = config
  if (integrator === '') {
    throw new Error('Missing lifi.integrator in config')
  }

  const url = `${LIFI_API_BASE}/integrators/${encodeURIComponent(integrator)}`
  const headers: Record<string, string> = {
    Accept: 'application/json'
  }
  if (lifiApiKey !== '' && lifiApiKey !== integrator) {
    headers['x-lifi-api-key'] = lifiApiKey
  }

  const response = await retryFetch(url, { headers })
  if (!response.ok) {
    throw new Error(
      `LiFi API error: HTTP ${response.status} fetching fees for integrator "${integrator}"`
    )
  }

  const data = (await response.json()) as LifiFeesResponse
  return data
}

/**
 * Filter fee balances to only chains we support and tokens above dust threshold.
 * Optionally filter to specific chainIds.
 */
export function filterFeeBalances(
  feeBalances: LifiChainFees[],
  dustThresholdUsd: number,
  chainIds?: number[]
): LifiChainFees[] {
  const filtered: LifiChainFees[] = []

  for (const chainFees of feeBalances) {
    // Skip chains we don't know about
    const chain = chainByChainId(chainFees.chainId)
    if (chain == null) continue

    // Skip if chain filter is active and this chain isn't in it
    if (chainIds != null && !chainIds.includes(chainFees.chainId)) continue

    // Filter tokens above dust threshold with non-zero balance
    const tokenBalances = chainFees.tokenBalances.filter(tb => {
      const usd = parseFloat(tb.amountUsd)
      return !isNaN(usd) && usd >= dustThresholdUsd && tb.amount !== '0'
    })

    if (tokenBalances.length > 0) {
      filtered.push({ chainId: chainFees.chainId, tokenBalances })
    }
  }

  return filtered
}
