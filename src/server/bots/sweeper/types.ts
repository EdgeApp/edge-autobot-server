/**
 * Shared types for the multi-chain token sweeper.
 * See edge-plans/2026-02/multi-chain-token-sweep.md
 */

export interface ChainInfo {
  chainId: number
  pluginId: string
  nativeSymbol: string
  usdcAddress: string
  usdtAddress: string
  rpcUrl: string
  rangoCode: string
  lifiCode: string
}

export interface TokenBalance {
  tokenAddress: string
  symbol: string
  name: string
  balance: string
  decimals: number
  chainId: number
  pluginId: string
}

export interface TokenWithRate extends TokenBalance {
  rate: number
  usdValue: number
}

export interface CandidateTarget {
  type: 'native' | 'usdc' | 'usdt'
  tokenAddress: string | null
  usdValue: number
  balance?: string
  decimals?: number
}

export interface SweeperChainResult {
  chainId: number
  pluginId: string
  tokens: TokenWithRate[]
  nativeBalance: string
  nativeUsdValue: number
  target: CandidateTarget
  tokensToSwap: TokenWithRate[]
}

export interface EtherscanTokenBalance {
  TokenAddress: string
  TokenName: string
  TokenSymbol: string
  TokenQuantity: string
  TokenDivisor: string
  TokenPriceUSD: string
}

export interface EtherscanBalanceResponse {
  status: string
  message: string
  result: string
}

export interface EtherscanTokenResponse {
  status: string
  message: string
  result: EtherscanTokenBalance[]
}

export interface RatesRequestCrypto {
  asset: {
    pluginId: string
    tokenId: string | null
  }
}

export interface RatesRequest {
  targetFiat: string
  crypto: RatesRequestCrypto[]
  fiat: unknown[]
}

export interface RatesResponseAsset {
  asset: {
    pluginId: string
    tokenId: string | null
  }
  rate: number
}

export interface RatesResponse {
  targetFiat: string
  crypto: RatesResponseAsset[]
  fiat: unknown[]
}

export interface SwapQuoteTx {
  txTo: string
  txData: string
  value: string
  gasLimit?: string
  approvalSpender?: string
  approvalTo?: string
  approvalData?: string
}

export interface TransactionRequestLike {
  to?: string | null
  data?: string
  value?: bigint
  gasLimit?: bigint
  chainId?: number
  type?: number
  from?: string
}

export type AuthorizationMode = 'approve' | 'permit' | 'none'

export interface PlannedSwap {
  chainId: number
  pluginId: string
  tokenSymbol: string
  tokenAddress: string
  tokenBalance: string
  targetSymbol: string
  authorization: AuthorizationMode
  resetApprovalTx?: TransactionRequestLike
  approvalTx?: TransactionRequestLike
  swapTx: TransactionRequestLike
  fromAddress: string
}

export interface PlannedBridge {
  sourceChainId: number
  sourcePluginId: string
  sourceTokenAddress: string
  sourceSymbol: string
  targetSymbol: string
  amountWei: string
  authorization: AuthorizationMode
  resetApprovalTx?: TransactionRequestLike
  approvalTx?: TransactionRequestLike
  bridgeTx: TransactionRequestLike
  fromAddress: string
}
