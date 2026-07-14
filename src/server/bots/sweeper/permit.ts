/**
 * Helpers for detecting ERC-20 permit (EIP-2612/DAI-style) support.
 */
import { ethers } from 'ethers'

import { CHAINS, getRpcUrl } from './chainConfig'

const PROBE_OWNER = '0x0000000000000000000000000000000000000001'
const nonPermitTokenAddresses = new Set(
  CHAINS.map(chain => chain.usdtAddress.toLowerCase())
)
const providerByChainId = new Map<number, ethers.JsonRpcProvider>()
const permitSupportCache = new Map<string, boolean>()

const permitProbeAbi = [
  'function nonces(address owner) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)'
]

function normalizeTokenAddress(tokenAddress: string): string {
  return tokenAddress.startsWith('0x')
    ? tokenAddress.toLowerCase()
    : `0x${tokenAddress.toLowerCase()}`
}

function getProvider(chainId: number): ethers.JsonRpcProvider | undefined {
  const existing = providerByChainId.get(chainId)
  if (existing != null) return existing

  const chain = CHAINS.find(c => c.chainId === chainId)
  if (chain == null) return undefined

  const provider = new ethers.JsonRpcProvider(getRpcUrl(chainId))
  providerByChainId.set(chainId, provider)
  return provider
}

export async function tokenSupportsPermit(
  chainId: number,
  tokenAddress: string
): Promise<boolean> {
  const normalizedToken = normalizeTokenAddress(tokenAddress)
  if (nonPermitTokenAddresses.has(normalizedToken)) return false

  const cacheKey = `${chainId}:${normalizedToken}`
  const cached = permitSupportCache.get(cacheKey)
  if (cached != null) return cached

  const provider = getProvider(chainId)
  if (provider == null) {
    permitSupportCache.set(cacheKey, false)
    return false
  }

  const contract = new ethers.Contract(
    normalizedToken,
    permitProbeAbi,
    provider
  )
  let supported = false
  try {
    await Promise.all([
      contract.nonces(PROBE_OWNER),
      contract.DOMAIN_SEPARATOR()
    ])
    supported = true
  } catch {
    supported = false
  }

  permitSupportCache.set(cacheKey, supported)
  return supported
}

export function destroyProviders(): void {
  for (const provider of Array.from(providerByChainId.values())) {
    provider.destroy()
  }
  providerByChainId.clear()
}
