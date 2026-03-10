/**
 * Edge rates v3 client. POST /v3/rates with batched crypto assets (max 100 per request).
 */
import { retryFetch } from '../../../common/utils'
import { CHAINS } from './chainConfig'
import type { SweeperConfig } from './config'
import type {
  RatesRequest,
  RatesResponse,
  TokenBalance,
  TokenWithRate
} from './types'

const RATES_BATCH_SIZE = 100

interface CryptoEntry {
  pluginId: string
  tokenId: string | null
  token?: TokenBalance
  nativeForChainId?: number
}

function buildCryptoEntries(
  chainData: Map<number, { tokens: TokenBalance[]; nativeBalance: string }>
): CryptoEntry[] {
  const entries: CryptoEntry[] = []
  const seen = new Set<string>()

  for (const [chainId, data] of chainData) {
    const chain = CHAINS.find(c => c.chainId === chainId)
    const pluginId = chain?.pluginId ?? String(chainId)
    const key = (tid: string | null): string => `${pluginId}:${tid ?? 'native'}`

    if (data.nativeBalance !== '0' && !seen.has(key(null))) {
      seen.add(key(null))
      entries.push({ pluginId, tokenId: null, nativeForChainId: chainId })
    }
    for (const t of data.tokens) {
      const tid = t.tokenAddress.toLowerCase()
      if (!seen.has(key(tid))) {
        seen.add(key(tid))
        entries.push({ pluginId, tokenId: tid, token: t })
      }
    }
  }
  return entries
}

function buildRatesRequest(batch: CryptoEntry[]): RatesRequest {
  return {
    targetFiat: 'USD',
    crypto: batch.map(e => ({
      asset: {
        pluginId: e.pluginId,
        tokenId: e.tokenId
      }
    })),
    fiat: []
  }
}

export async function fetchRates(
  config: SweeperConfig,
  chainData: Map<number, { tokens: TokenBalance[]; nativeBalance: string }>
): Promise<Map<string, number>> {
  const entries = buildCryptoEntries(chainData)
  const rateByKey = new Map<string, number>()

  for (let i = 0; i < entries.length; i += RATES_BATCH_SIZE) {
    const batch = entries.slice(i, i + RATES_BATCH_SIZE)
    const body = buildRatesRequest(batch)
    const base = config.edgeRatesUrl.replace(/\/$/, '')
    const url = `${base}/v3/rates`
    const response = await retryFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = (await response.json()) as RatesResponse
    if (!Array.isArray(data.crypto)) continue
    for (const item of data.crypto) {
      const asset = item?.asset
      const rate = item?.rate
      if (asset == null || rate == null) continue
      const key = `${asset.pluginId}:${asset.tokenId ?? 'native'}`
      rateByKey.set(key, rate)
    }
  }
  return rateByKey
}

export function applyRates(
  chainData: Map<number, { tokens: TokenBalance[]; nativeBalance: string }>,
  rateByKey: Map<string, number>,
  dustThresholdUsd: number
): Map<
  number,
  { tokens: TokenWithRate[]; nativeBalance: string; nativeUsdValue: number }
> {
  const out = new Map<
    number,
    { tokens: TokenWithRate[]; nativeBalance: string; nativeUsdValue: number }
  >()

  for (const [chainId, data] of chainData) {
    const chain = CHAINS.find(c => c.chainId === chainId)
    const pluginId = chain?.pluginId ?? String(chainId)
    const nativeBalance = BigInt(data.nativeBalance)
    const rateNative = rateByKey.get(`${pluginId}:native`) ?? 0
    const nativeUsdValue = (Number(nativeBalance) / 1e18) * rateNative

    const tokens: TokenWithRate[] = []
    for (const t of data.tokens) {
      const rate = rateByKey.get(`${t.pluginId}:${t.tokenAddress}`) ?? 0
      const usdValue =
        (Number(BigInt(t.balance)) / Math.pow(10, t.decimals)) * rate
      if (usdValue < dustThresholdUsd) continue
      tokens.push({ ...t, rate, usdValue })
    }

    out.set(chainId, {
      tokens,
      nativeBalance: data.nativeBalance,
      nativeUsdValue
    })
  }
  return out
}
