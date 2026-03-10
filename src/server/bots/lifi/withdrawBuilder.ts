/**
 * Builds withdrawal transactions for LiFi integrator fees.
 * Calls the LiFi withdraw endpoint to get transaction calldata.
 */
import { retryFetch } from '../../../common/utils'
import { chainByChainId } from '../sweeper/chainConfig'
import type { LifiConfig } from './config'
import type { LifiChainFees, PlannedWithdrawal } from './types'

const LIFI_API_BASE = 'https://li.quest/v1'

export async function buildWithdrawals(
  config: LifiConfig,
  feeBalances: LifiChainFees[],
  recipientAddress: string
): Promise<{
  planned: PlannedWithdrawal[]
  skipped: Array<{ chainId: number; reason: string }>
}> {
  const { integrator, lifiApiKey } = config
  const planned: PlannedWithdrawal[] = []
  const skipped: Array<{ chainId: number; reason: string }> = []

  for (const chainFees of feeBalances) {
    const chain = chainByChainId(chainFees.chainId)
    if (chain == null) {
      skipped.push({
        chainId: chainFees.chainId,
        reason: 'unknown chain'
      })
      continue
    }

    const tokenAddresses = chainFees.tokenBalances.map(tb => tb.token.address)
    const params = new URLSearchParams()
    for (const addr of tokenAddresses) {
      params.append('tokenAddresses', addr)
    }

    const url = `${LIFI_API_BASE}/integrators/${encodeURIComponent(integrator)}/withdraw/${chainFees.chainId}?${params.toString()}`
    const headers: Record<string, string> = {
      Accept: 'application/json'
    }
    if (lifiApiKey !== '' && lifiApiKey !== integrator) {
      headers['x-lifi-api-key'] = lifiApiKey
    }

    let response: Response
    try {
      response = await retryFetch(url, { headers })
    } catch (err) {
      skipped.push({
        chainId: chainFees.chainId,
        reason: `fetch error: ${String(err)}`
      })
      continue
    }

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`
      try {
        const body = (await response.json()) as Record<string, unknown>
        if (typeof body.message === 'string') errorMsg = body.message
      } catch {}
      skipped.push({
        chainId: chainFees.chainId,
        reason: errorMsg
      })
      continue
    }

    const data = (await response.json()) as {
      transactionRequest: { data: string; to: string }
    }

    planned.push({
      chainId: chainFees.chainId,
      pluginId: chain.pluginId,
      tokens: chainFees.tokenBalances.map(tb => ({
        symbol: tb.token.symbol,
        address: tb.token.address,
        amount: tb.amount,
        amountUsd: tb.amountUsd
      })),
      withdrawTx: {
        to: data.transactionRequest.to,
        data: data.transactionRequest.data,
        value: BigInt(0),
        chainId: chainFees.chainId,
        type: 2,
        from: recipientAddress
      },
      fromAddress: recipientAddress
    })
  }

  return { planned, skipped }
}
