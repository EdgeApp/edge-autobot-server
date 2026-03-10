/**
 * Types for the LiFi fee claimer bot.
 */
import type { TransactionRequestLike } from '../sweeper/types'

export interface LifiToken {
  address: string
  symbol: string
  decimals: number
  chainId: number
  name: string
  coinKey: string
  priceUSD: string
  logoURI?: string
}

export interface LifiTokenBalance {
  token: LifiToken
  amount: string
  amountUsd: string
}

export interface LifiChainFees {
  chainId: number
  tokenBalances: LifiTokenBalance[]
}

export interface LifiFeesResponse {
  integratorId: string
  feeBalances: LifiChainFees[]
}

export interface PlannedWithdrawal {
  chainId: number
  pluginId: string
  tokens: Array<{
    symbol: string
    address: string
    amount: string
    amountUsd: string
  }>
  withdrawTx: TransactionRequestLike
  fromAddress: string
}
