/**
 * Per-chain target selection: always USDC.
 */
import { CHAINS } from './chainConfig'
import type {
  CandidateTarget,
  SweeperChainResult,
  TokenWithRate
} from './types'

function buildUsdcTarget(
  chainId: number,
  tokens: TokenWithRate[]
): CandidateTarget {
  const chain = CHAINS.find(c => c.chainId === chainId)
  const usdcAddress = chain?.usdcAddress.toLowerCase().replace(/^0x/, '')

  const usdc =
    usdcAddress != null
      ? tokens.find(t => t.tokenAddress === usdcAddress)
      : undefined

  return {
    type: 'usdc',
    tokenAddress: usdcAddress ?? null,
    usdValue: usdc?.usdValue ?? 0,
    balance: usdc?.balance,
    decimals: usdc?.decimals ?? 6
  }
}

const NATIVE_TOKEN_SENTINEL = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export function selectTargetsPerChain(
  chainData: Map<
    number,
    { tokens: TokenWithRate[]; nativeBalance: string; nativeUsdValue: number }
  >,
  dustThresholdUsd: number
): SweeperChainResult[] {
  const results: SweeperChainResult[] = []

  for (const [chainId, data] of chainData) {
    const chain = CHAINS.find(c => c.chainId === chainId)
    const pluginId = chain?.pluginId ?? String(chainId)
    const target = buildUsdcTarget(chainId, data.tokens)
    const tokensToSwap = data.tokens.filter(
      t => target.tokenAddress == null || t.tokenAddress !== target.tokenAddress
    )

    // Add native token (ETH/POL) as swappable, reserving dust threshold for gas
    const nativeUsd = data.nativeUsdValue
    if (nativeUsd > dustThresholdUsd * 2) {
      const nativeRate = nativeUsd / (Number(BigInt(data.nativeBalance)) / 1e18)
      const reserveWei = BigInt(
        Math.ceil((dustThresholdUsd / nativeRate) * 1e18)
      )
      const swapWei = BigInt(data.nativeBalance) - reserveWei
      if (swapWei > BigInt(0)) {
        const swapUsd = (Number(swapWei) / 1e18) * nativeRate
        tokensToSwap.push({
          tokenAddress: NATIVE_TOKEN_SENTINEL,
          symbol: chain?.nativeSymbol ?? 'ETH',
          name: chain?.nativeSymbol ?? 'ETH',
          balance: swapWei.toString(),
          decimals: 18,
          chainId,
          pluginId,
          rate: nativeRate,
          usdValue: swapUsd
        })
      }
    }

    results.push({
      chainId,
      pluginId,
      tokens: data.tokens,
      nativeBalance: data.nativeBalance,
      nativeUsdValue: data.nativeUsdValue,
      target,
      tokensToSwap
    })
  }

  return results
}
