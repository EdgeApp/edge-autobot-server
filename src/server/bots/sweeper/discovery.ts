/**
 * Token discovery via Etherscan API v2 PRO (addresstokenbalance + balance).
 * zkSync Era uses its own block explorer API (tokenlist action).
 * Known stablecoins (USDC, USDT) are always queried directly since
 * addresstokenbalance silently omits some tokens.
 */
import { retryFetch, snooze } from '../../../common/utils'
import { CHAINS } from './chainConfig'
import type { SweeperConfig } from './config'
import type {
  EtherscanBalanceResponse,
  EtherscanTokenBalance,
  EtherscanTokenResponse,
  TokenBalance
} from './types'

const ETHERSCAN_V2_BASE = 'https://api.etherscan.io/v2/api'
const RATE_LIMIT_BACKOFF_MS = 2000
const MAX_RETRIES = 3

// Global throttle: Etherscan silently truncates results when requests are too
// frequent (returns fewer tokens with status=1, no error). Enforce minimum
// spacing between ALL Etherscan API calls.
let lastEtherscanRequestMs = 0
const MIN_REQUEST_SPACING_MS = 1200

async function throttledFetch(
  url: string
): Promise<{ ok: boolean; status: number; text: string; contentType: string }> {
  // Enforce minimum spacing
  const elapsed = Date.now() - lastEtherscanRequestMs
  if (elapsed < MIN_REQUEST_SPACING_MS) {
    await snooze(MIN_REQUEST_SPACING_MS - elapsed)
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    lastEtherscanRequestMs = Date.now()
    const response = await retryFetch(url)
    const contentType = response.headers.get('content-type') ?? ''
    const text = await response.text()

    // Check for application-level rate limit (HTTP 200 with JSON error body)
    if (response.ok && contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>
        const message = typeof parsed.message === 'string' ? parsed.message : ''
        if (message.toLowerCase().includes('rate limit')) {
          if (attempt < MAX_RETRIES) {
            const backoff = RATE_LIMIT_BACKOFF_MS * (attempt + 1)
            console.warn(
              `  [discovery] rate limited by Etherscan, retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`
            )
            await snooze(backoff)
            continue
          }
        }
      } catch {
        // not JSON — handled below
      }
    }

    return { ok: response.ok, status: response.status, text, contentType }
  }
  // Exhausted retries — return last response (will be handled by caller)
  lastEtherscanRequestMs = Date.now()
  const response = await retryFetch(url)
  const contentType = response.headers.get('content-type') ?? ''
  const text = await response.text()
  return { ok: response.ok, status: response.status, text, contentType }
}

// Chains that use their own explorer API instead of Etherscan v2
const CHAIN_EXPLORER_OVERRIDES: Record<
  number,
  { baseUrl: string; action: string }
> = {
  // zkSync Era — Etherscan v2 returns 504 for this chain
  324: {
    baseUrl: 'https://block-explorer-api.mainnet.zksync.io/api',
    action: 'tokenlist'
  }
}

// Directly query a single ERC-20 balance using Etherscan tokenbalance action.
// Returns raw balance string (wei) or null on failure.
async function fetchSpecificTokenBalance(
  config: SweeperConfig,
  address: string,
  chainId: number,
  contractAddress: string
): Promise<string | null> {
  const url = new URL(ETHERSCAN_V2_BASE)
  url.searchParams.set('chainid', String(chainId))
  url.searchParams.set('module', 'account')
  url.searchParams.set('action', 'tokenbalance')
  url.searchParams.set('contractaddress', contractAddress)
  url.searchParams.set('address', address)
  url.searchParams.set('tag', 'latest')
  url.searchParams.set('apikey', config.etherscanApiKey)

  const {
    ok,
    text: rawText,
    contentType
  } = await throttledFetch(url.toString())
  if (!ok || !contentType.includes('application/json')) return null
  let data: EtherscanBalanceResponse
  try {
    data = JSON.parse(rawText) as EtherscanBalanceResponse
  } catch {
    return null
  }
  if (data.status !== '1' || typeof data.result !== 'string') return null
  return data.result
}

export async function fetchTokenBalances(
  config: SweeperConfig,
  address: string,
  chainId: number
): Promise<TokenBalance[]> {
  const override = CHAIN_EXPLORER_OVERRIDES[chainId]
  if (override != null) {
    return await fetchTokenBalancesFromExplorer(address, chainId, override)
  }

  // Use offset=100 to get all tokens in a single request. Etherscan's
  // pagination with small offsets has a bug that drops tokens.
  // Supplement with direct balance queries for known stablecoins as a safety net.
  const url = new URL(ETHERSCAN_V2_BASE)
  url.searchParams.set('chainid', String(chainId))
  url.searchParams.set('module', 'account')
  url.searchParams.set('action', 'addresstokenbalance')
  url.searchParams.set('address', address)
  url.searchParams.set('page', '1')
  url.searchParams.set('offset', '100')
  url.searchParams.set('apikey', config.etherscanApiKey)

  const {
    ok,
    status,
    text: rawText,
    contentType
  } = await throttledFetch(url.toString())
  if (!ok || !contentType.includes('application/json')) {
    console.warn(
      `  [discovery] chainId=${chainId} token fetch failed: HTTP ${status}`
    )
    return await supplementWithKnownTokens(config, address, chainId, [])
  }
  let data: EtherscanTokenResponse
  try {
    data = JSON.parse(rawText) as EtherscanTokenResponse
  } catch {
    console.warn(`  [discovery] chainId=${chainId} token fetch non-JSON`)
    return await supplementWithKnownTokens(config, address, chainId, [])
  }

  if (data.status !== '1' || !Array.isArray(data.result)) {
    const rawMessage = (data as unknown as Record<string, unknown>).message
    const message = typeof rawMessage === 'string' ? rawMessage : ''
    const isNoResults =
      message.toLowerCase().includes('no token') ||
      message.toLowerCase().includes('no transactions')
    if (!isNoResults) {
      console.warn(
        `  [discovery] chainId=${chainId} token fetch status=${data.status} message=${message}`
      )
    }
    return await supplementWithKnownTokens(config, address, chainId, [])
  }

  const mapped = mapEtherscanTokens(data.result, chainId)
  return await supplementWithKnownTokens(config, address, chainId, mapped)
}

// Always query known stablecoins (USDC, USDT) directly via tokenbalance and
// replace/add them in the token list. addresstokenbalance is unreliable: it
// sometimes omits tokens entirely, and sometimes returns wrong TokenDivisor.
async function supplementWithKnownTokens(
  config: SweeperConfig,
  address: string,
  chainId: number,
  existing: TokenBalance[]
): Promise<TokenBalance[]> {
  const chain = CHAINS.find(c => c.chainId === chainId)
  if (chain == null) return existing

  const knownContracts: Array<{
    address: string
    symbol: string
    name: string
    decimals: number
  }> = []
  if (chain.usdcAddress != null && chain.usdcAddress !== '') {
    knownContracts.push({
      address: chain.usdcAddress,
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6
    })
  }
  if (chain.usdtAddress != null && chain.usdtAddress !== '') {
    knownContracts.push({
      address: chain.usdtAddress,
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6
    })
  }

  // Remove any existing entries for known tokens (may have wrong decimals)
  const knownAddrs = new Set(
    knownContracts.map(k => k.address.toLowerCase().replace(/^0x/, ''))
  )
  const result = existing.filter(
    t => !knownAddrs.has(t.tokenAddress.toLowerCase())
  )

  // Query each known token directly and add with correct decimals
  for (const known of knownContracts) {
    const normalizedAddr = known.address.toLowerCase().replace(/^0x/, '')
    const balance = await fetchSpecificTokenBalance(
      config,
      address,
      chainId,
      known.address
    )
    if (balance == null || balance === '0') continue

    result.push({
      tokenAddress: normalizedAddr,
      symbol: known.symbol,
      name: known.name,
      balance,
      decimals: known.decimals,
      chainId,
      pluginId: chain.pluginId
    })
  }

  return result
}

async function fetchTokenBalancesFromExplorer(
  address: string,
  chainId: number,
  override: { baseUrl: string; action: string }
): Promise<TokenBalance[]> {
  const url = new URL(override.baseUrl)
  url.searchParams.set('module', 'account')
  url.searchParams.set('action', override.action)
  url.searchParams.set('address', address)

  // Explorer overrides don't use Etherscan, so use retryFetch directly
  const response = await retryFetch(url.toString())
  const contentType = response.headers.get('content-type') ?? ''
  const rawText = await response.text()
  if (!response.ok || !contentType.includes('application/json')) {
    console.warn(
      `  [discovery] chainId=${chainId} explorer fetch failed: HTTP ${response.status}`
    )
    return []
  }
  let data: EtherscanTokenResponse
  try {
    data = JSON.parse(rawText) as EtherscanTokenResponse
  } catch {
    console.warn(`  [discovery] chainId=${chainId} explorer fetch non-JSON`)
    return []
  }

  if (data.status !== '1') {
    const rawMessage = (data as unknown as Record<string, unknown>).message
    const message = typeof rawMessage === 'string' ? rawMessage : ''
    const isNoResults =
      message.toLowerCase().includes('no token') ||
      message.toLowerCase().includes('no transactions')
    if (!isNoResults) {
      console.warn(
        `  [discovery] chainId=${chainId} explorer fetch status=${data.status} message=${message}`
      )
    }
    return []
  }
  if (data.result == null || !Array.isArray(data.result)) return []

  return mapEtherscanTokens(data.result, chainId)
}

function mapEtherscanTokens(
  result: EtherscanTokenBalance[],
  chainId: number
): TokenBalance[] {
  const chain = CHAINS.find(c => c.chainId === chainId)
  const pluginId = chain?.pluginId ?? String(chainId)

  return result
    .filter((r: EtherscanTokenBalance) => r.TokenQuantity !== '0')
    .map((r: EtherscanTokenBalance) => ({
      tokenAddress: r.TokenAddress.toLowerCase().replace(/^0x/, ''),
      symbol: r.TokenSymbol,
      name: r.TokenName,
      balance: r.TokenQuantity,
      decimals: (() => {
        const d = parseInt(r.TokenDivisor, 10)
        return d !== 0 && !Number.isNaN(d) ? d : 18
      })(),
      chainId,
      pluginId
    }))
}

export async function fetchNativeBalance(
  config: SweeperConfig,
  address: string,
  chainId: number
): Promise<string> {
  const url = new URL(ETHERSCAN_V2_BASE)
  url.searchParams.set('chainid', String(chainId))
  url.searchParams.set('module', 'account')
  url.searchParams.set('action', 'balance')
  url.searchParams.set('address', address)
  url.searchParams.set('tag', 'latest')
  url.searchParams.set('apikey', config.etherscanApiKey)

  const {
    ok,
    text: rawText,
    contentType
  } = await throttledFetch(url.toString())
  if (!ok || !contentType.includes('application/json')) {
    return '0'
  }
  let data: EtherscanBalanceResponse
  try {
    data = JSON.parse(rawText) as EtherscanBalanceResponse
  } catch {
    return '0'
  }

  if (data.status !== '1' || typeof data.result !== 'string') {
    return '0'
  }
  return data.result
}

export async function discoverAllChains(
  config: SweeperConfig,
  address: string,
  chainIds?: number[]
): Promise<Map<number, { tokens: TokenBalance[]; nativeBalance: string }>> {
  const chains =
    chainIds != null ? CHAINS.filter(c => chainIds.includes(c.chainId)) : CHAINS
  const result = new Map<
    number,
    { tokens: TokenBalance[]; nativeBalance: string }
  >()

  for (const chain of chains) {
    const tokens = await fetchTokenBalances(config, address, chain.chainId)
    const nativeBalance = await fetchNativeBalance(
      config,
      address,
      chain.chainId
    )
    result.set(chain.chainId, { tokens, nativeBalance })
  }

  return result
}
