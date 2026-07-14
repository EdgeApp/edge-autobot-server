/**
 * Chain definitions for the sweeper: chain IDs, pluginIds, stablecoin addresses, RPC URLs, Rango/LiFi codes.
 */
import type { ChainInfo } from './types'

export const CHAINS: ChainInfo[] = [
  {
    chainId: 1,
    pluginId: 'ethereum',
    nativeSymbol: 'ETH',
    usdcAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    usdtAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    rpcUrl: 'https://eth.llamarpc.com',
    rangoCode: 'ETH',
    lifiCode: 'eth'
  },
  {
    chainId: 137,
    pluginId: 'polygon',
    nativeSymbol: 'POL',
    usdcAddress: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    usdtAddress: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
    rpcUrl: 'https://polygon-rpc.com',
    rangoCode: 'POLYGON',
    lifiCode: 'pol'
  },
  {
    chainId: 42161,
    pluginId: 'arbitrum',
    nativeSymbol: 'ETH',
    usdcAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    usdtAddress: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    rangoCode: 'ARBITRUM',
    lifiCode: 'arb'
  },
  {
    chainId: 10,
    pluginId: 'optimism',
    nativeSymbol: 'ETH',
    usdcAddress: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
    usdtAddress: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
    rpcUrl: 'https://mainnet.optimism.io',
    rangoCode: 'OPTIMISM',
    lifiCode: 'opt'
  },
  {
    chainId: 324,
    pluginId: 'zksync',
    nativeSymbol: 'ETH',
    usdcAddress: '0x1d17cbcf0d6d143135ae902365d2e5e2a16538d4',
    usdtAddress: '0x493257fd37edb34451f62edf8d2a0c418852ba4c',
    rpcUrl: 'https://mainnet.zk.io',
    rangoCode: 'ZKSYNC',
    lifiCode: 'era'
  },
  {
    chainId: 8453,
    pluginId: 'base',
    nativeSymbol: 'ETH',
    usdcAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    usdtAddress: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
    rpcUrl: 'https://mainnet.base.org',
    rangoCode: 'BASE',
    lifiCode: 'bas'
  },
  {
    chainId: 43114,
    pluginId: 'avalanche',
    nativeSymbol: 'AVAX',
    usdcAddress: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
    usdtAddress: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7',
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    rangoCode: 'AVAX_CCHAIN',
    lifiCode: 'ava'
  }
]

const ETHERSCAN_RATE_LIMIT_MS = 1100

export function getEtherscanDelayMs(): number {
  return ETHERSCAN_RATE_LIMIT_MS
}

// Resolved RPC URLs keyed by chainId. Populated by initRpcUrls().
// Falls back to the public rpcUrl in CHAINS when not set.
const resolvedRpcUrl = new Map<number, string>()

export function initRpcUrls(infuraProjectId: string, drpcApiKey: string): void {
  if (infuraProjectId !== '') {
    resolvedRpcUrl.set(1, `https://mainnet.infura.io/v3/${infuraProjectId}`)
  }
  if (drpcApiKey !== '') {
    resolvedRpcUrl.set(
      137,
      `https://lb.drpc.org/ogrpc?network=polygon&dkey=${drpcApiKey}`
    )
    resolvedRpcUrl.set(
      42161,
      `https://lb.drpc.org/ogrpc?network=arbitrum&dkey=${drpcApiKey}`
    )
    resolvedRpcUrl.set(
      10,
      `https://lb.drpc.org/ogrpc?network=optimism&dkey=${drpcApiKey}`
    )
    resolvedRpcUrl.set(
      324,
      `https://lb.drpc.org/ogrpc?network=zksync&dkey=${drpcApiKey}`
    )
    resolvedRpcUrl.set(
      8453,
      `https://lb.drpc.org/ogrpc?network=base&dkey=${drpcApiKey}`
    )
    resolvedRpcUrl.set(
      43114,
      `https://lb.drpc.org/ogrpc?network=avalanche&dkey=${drpcApiKey}`
    )
  }
}

export function getRpcUrl(chainId: number): string {
  const resolved = resolvedRpcUrl.get(chainId)
  if (resolved != null) return resolved
  const chain = CHAINS.find(c => c.chainId === chainId)
  return chain?.rpcUrl ?? 'https://eth.llamarpc.com'
}

export function chainByChainId(chainId: number): ChainInfo | undefined {
  return CHAINS.find(c => c.chainId === chainId)
}

export function chainByPluginId(pluginId: string): ChainInfo | undefined {
  return CHAINS.find(c => c.pluginId === pluginId)
}
