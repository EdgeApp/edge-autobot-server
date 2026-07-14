/**
 * Rango/LiFi swap quotes and ethers.js TransactionRequest construction for approvals and swaps.
 */
import { ethers } from 'ethers'

import { retryFetch } from '../../../common/utils'
import { CHAINS } from './chainConfig'
import type { SweeperConfig } from './config'
import type {
  PlannedSwap,
  SwapQuoteTx,
  SweeperChainResult,
  TokenWithRate,
  TransactionRequestLike
} from './types'

const RANGO_BASE = 'https://api.rango.exchange'
const LIFI_BASE = 'https://li.quest'
const PARENT_TOKEN_CONTRACT_ADDRESS = '0x0'
const NATIVE_TOKEN_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const APPROVE_IFACE = new ethers.Interface([
  'function approve(address spender, uint256 amount) returns (bool)'
])

interface RangoSwapResponse {
  result?: {
    requestId?: string
    tx?: {
      txTo?: string
      txData?: string
      value?: string
      gasLimit?: string
      approveTo?: string | null
      approveData?: string | null
    }
    transaction?: {
      txTo?: string
      txData?: string
      value?: string
      gasLimit?: string
      approveTo?: string | null
      approveData?: string | null
    }
  }
  tx?: {
    txTo?: string
    txData?: string
    value?: string
    gasLimit?: string
    approveTo?: string | null
    approveData?: string | null
  }
}

interface QuoteAttempt {
  quote: SwapQuoteTx | null
  statusCode?: number
}

function isNativeTokenAddress(tokenAddress: string): boolean {
  const normalized = tokenAddress.toLowerCase()
  const withPrefix = normalized.startsWith('0x')
    ? normalized
    : `0x${normalized}`
  return (
    withPrefix === NATIVE_TOKEN_SENTINEL ||
    withPrefix === PARENT_TOKEN_CONTRACT_ADDRESS
  )
}

function toRangoAsset(chainCode: string, tokenAddress: string): string {
  if (isNativeTokenAddress(tokenAddress)) return chainCode
  const normalized = tokenAddress.startsWith('0x')
    ? tokenAddress.toLowerCase()
    : `0x${tokenAddress.toLowerCase()}`
  return `${chainCode}--${normalized}`
}

function toLifiToken(tokenAddress: string): string {
  if (isNativeTokenAddress(tokenAddress)) return PARENT_TOKEN_CONTRACT_ADDRESS
  return tokenAddress.startsWith('0x')
    ? tokenAddress.toLowerCase()
    : `0x${tokenAddress.toLowerCase()}`
}

function toLifiFee(affiliateFeeBasis: string): string {
  const basis = parseFloat(affiliateFeeBasis)
  if (Number.isNaN(basis)) return '0'
  return (basis / 10000).toString()
}

function toHexAddress(address: string): string {
  return address.startsWith('0x') ? address : `0x${address}`
}

function decodeApprovalSpender(approvalData?: string): string | undefined {
  if (approvalData == null || approvalData === '') return undefined
  try {
    const [spender] = APPROVE_IFACE.decodeFunctionData('approve', approvalData)
    return typeof spender === 'string' ? spender : String(spender)
  } catch {
    return undefined
  }
}

function parseRangoTx(body: RangoSwapResponse): SwapQuoteTx | null {
  const tx = body?.result?.tx ?? body?.result?.transaction ?? body?.tx
  if (tx?.txTo != null && tx?.txData != null) {
    const approvalData =
      tx.approveData != null && tx.approveData !== ''
        ? tx.approveData
        : undefined
    return {
      txTo: tx.txTo,
      txData: tx.txData,
      value: tx.value ?? '0',
      gasLimit: tx.gasLimit,
      approvalTo:
        tx.approveTo != null && tx.approveTo !== ''
          ? toHexAddress(tx.approveTo)
          : undefined,
      approvalData,
      approvalSpender: decodeApprovalSpender(approvalData)
    }
  }
  return null
}

async function requestRangoSwap(
  config: SweeperConfig,
  chainId: number,
  fromTokenAddress: string,
  toTokenAddress: string,
  amountWei: string,
  fromAddress: string,
  slippagePercent: number
): Promise<QuoteAttempt> {
  const chain = CHAINS.find(c => c.chainId === chainId)
  if (chain == null) return { quote: null }
  const rango = config.rango
  const fromBlock = toRangoAsset(chain.rangoCode, fromTokenAddress)
  const toBlock = toRangoAsset(chain.rangoCode, toTokenAddress)

  const params = new URLSearchParams({
    apiKey: rango.rangoApiKey,
    appId: rango.appId,
    referrerAddress: rango.referrerAddress.toLowerCase(),
    referrerFee: rango.referrerFee,
    from: fromBlock,
    to: toBlock,
    fromAddress,
    toAddress: fromAddress,
    amount: amountWei,
    disableEstimate: 'false',
    slippage: String(slippagePercent)
  })
  const url = `${RANGO_BASE}/basic/swap?${params.toString()}`
  try {
    const response = await retryFetch(url)
    const contentType = response.headers.get('content-type') ?? ''
    const rawText = await response.text()
    if (!response.ok || !contentType.includes('application/json')) {
      return { quote: null, statusCode: response.status }
    }
    const data = JSON.parse(rawText) as RangoSwapResponse
    return { quote: parseRangoTx(data), statusCode: response.status }
  } catch (err) {
    console.warn('Rango swap request failed for chain', chainId, ':', err)
    return { quote: null }
  }
}

interface LiFiQuoteAction {
  fromToken?: { address: string }
  toToken?: { address: string }
  estimate?: { fromAmount?: string; toAmount?: string }
  transactionRequest?: LiFiTransactionRequest
}

interface LiFiTransactionRequest {
  to: string
  data: string
  value?: string
  gasLimit?: string
}

interface LiFiEstimate {
  approvalAddress?: string
}

interface LiFiIncludedStep {
  estimate?: LiFiEstimate
}

interface LiFiQuoteResponse {
  action?: LiFiQuoteAction
  actions?: LiFiQuoteAction[]
  estimate?: LiFiEstimate
  transactionRequest?: LiFiTransactionRequest
  includedSteps?: LiFiIncludedStep[]
}

function findApprovalSpender(data: LiFiQuoteResponse): string | undefined {
  const topLevel = data.estimate?.approvalAddress
  if (topLevel != null && topLevel !== '') return topLevel
  for (const step of data.includedSteps ?? []) {
    const fromStep = step.estimate?.approvalAddress
    if (fromStep != null && fromStep !== '') return fromStep
  }
  return undefined
}

async function requestLifiQuote(
  config: SweeperConfig,
  chainId: number,
  fromTokenAddress: string,
  toTokenAddress: string,
  amountWei: string,
  fromAddress: string,
  _slippagePercent: number
): Promise<QuoteAttempt> {
  const chain = CHAINS.find(c => c.chainId === chainId)
  if (chain == null) return { quote: null }
  const lifi = config.lifi
  const from = toLifiToken(fromTokenAddress)
  const to = toLifiToken(toTokenAddress)
  const slippageDecimal = Math.min(Math.max(_slippagePercent / 100, 0), 0.05)

  const params = new URLSearchParams({
    fromChain: chain.lifiCode,
    toChain: chain.lifiCode,
    fromToken: from,
    toToken: to,
    fromAddress,
    toAddress: fromAddress,
    fromAmount: amountWei,
    integrator: lifi.integrator,
    slippage: slippageDecimal.toString(),
    fee: toLifiFee(lifi.affiliateFeeBasis)
  })
  const url = `${LIFI_BASE}/v1/quote?${params.toString()}`
  try {
    const response = await retryFetch(url)
    const contentType = response.headers.get('content-type') ?? ''
    const rawText = await response.text()
    if (!response.ok || !contentType.includes('application/json')) {
      return { quote: null, statusCode: response.status }
    }
    const data = JSON.parse(rawText) as LiFiQuoteResponse
    const action = data?.action ?? data?.actions?.[0]
    const tr = data.transactionRequest ?? action?.transactionRequest
    const approvalSpender = findApprovalSpender(data)
    if (tr?.to != null && tr?.data != null) {
      return {
        quote: {
          txTo: tr.to,
          txData: tr.data,
          value: tr.value ?? '0',
          gasLimit: tr.gasLimit,
          approvalSpender
        },
        statusCode: response.status
      }
    }
    return { quote: null, statusCode: response.status }
  } catch (err) {
    console.warn('LiFi quote request failed for chain', chainId, ':', err)
    return { quote: null }
  }
}

const RESET_APPROVAL_TOKENS = new Set(
  CHAINS.map(c => c.usdtAddress.toLowerCase())
)

function needsResetApproval(tokenAddress: string): boolean {
  const normalized = tokenAddress.toLowerCase()
  const withPrefix = normalized.startsWith('0x')
    ? normalized
    : `0x${normalized}`
  return RESET_APPROVAL_TOKENS.has(withPrefix)
}

function buildResetApprovalTx(
  tokenAddress: string,
  spender: string,
  chainId: number
): ethers.TransactionRequest {
  return {
    to: toHexAddress(tokenAddress),
    data: APPROVE_IFACE.encodeFunctionData('approve', [spender, 0]),
    chainId,
    type: 2
  }
}

function buildApprovalTx(
  tokenAddress: string,
  spender: string,
  amount: bigint,
  chainId: number,
  approvalTo?: string,
  approvalData?: string
): ethers.TransactionRequest {
  if (
    approvalTo != null &&
    approvalTo !== '' &&
    approvalData != null &&
    approvalData !== ''
  ) {
    return {
      to: toHexAddress(approvalTo),
      data: approvalData,
      chainId,
      type: 2
    }
  }

  const to = toHexAddress(tokenAddress)
  return {
    to,
    data: APPROVE_IFACE.encodeFunctionData('approve', [spender, amount]),
    chainId,
    type: 2
  }
}

function buildSwapTx(
  quote: SwapQuoteTx,
  chainId: number,
  fromAddress: string
): ethers.TransactionRequest {
  return {
    to: quote.txTo,
    data: quote.txData,
    value: ethers.toBigInt(quote.value ?? '0'),
    gasLimit:
      quote.gasLimit != null ? ethers.toBigInt(quote.gasLimit) : undefined,
    chainId,
    type: 2,
    from: fromAddress
  }
}

export function getTargetTokenAddress(result: SweeperChainResult): string {
  if (result.target.tokenAddress != null) {
    return result.target.tokenAddress.startsWith('0x')
      ? result.target.tokenAddress
      : `0x${result.target.tokenAddress}`
  }
  const chain = CHAINS.find(c => c.chainId === result.chainId)
  if (chain?.nativeSymbol === 'ETH')
    return '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  return '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
}

export function sortTokensNativeLast(tokens: TokenWithRate[]): TokenWithRate[] {
  return [...tokens].sort((a, b) => {
    const aNative = isNativeTokenAddress(a.tokenAddress) ? 1 : 0
    const bNative = isNativeTokenAddress(b.tokenAddress) ? 1 : 0
    return aNative - bNative
  })
}

export function getTargetSymbol(chainResult: SweeperChainResult): string {
  return chainResult.target.type === 'native'
    ? chainResult.pluginId
    : chainResult.target.type.toUpperCase()
}

export async function buildPlannedSwap(
  config: SweeperConfig,
  chainResult: SweeperChainResult,
  token: TokenWithRate,
  fromAddress: string,
  slippageOverride?: number
): Promise<{
  planned: PlannedSwap | null
  skipped: { chainId: number; symbol: string; reason: string } | null
}> {
  const slippage = slippageOverride ?? config.slippage ?? 1
  const targetTokenAddress = getTargetTokenAddress(chainResult)
  const targetSymbol = getTargetSymbol(chainResult)
  const fromTokenAddr = token.tokenAddress.startsWith('0x')
    ? token.tokenAddress
    : `0x${token.tokenAddress}`

  const rangoAttempt = await requestRangoSwap(
    config,
    chainResult.chainId,
    fromTokenAddr,
    targetTokenAddress,
    token.balance,
    fromAddress,
    slippage
  )
  let quote: SwapQuoteTx | null = rangoAttempt.quote
  const lifiAttempt =
    quote == null
      ? await requestLifiQuote(
          config,
          chainResult.chainId,
          fromTokenAddr,
          targetTokenAddress,
          token.balance,
          fromAddress,
          slippage
        )
      : { quote, statusCode: undefined as number | undefined }
  quote = quote ?? lifiAttempt.quote

  if (quote == null) {
    const reason = `rango:${rangoAttempt.statusCode ?? 'n/a'}, lifi:${lifiAttempt.statusCode ?? 'n/a'}`
    return {
      planned: null,
      skipped: { chainId: chainResult.chainId, symbol: token.symbol, reason }
    }
  }

  const spender = quote.approvalSpender ?? quote.txTo
  const swapTx = buildSwapTx(quote, chainResult.chainId, fromAddress)
  const approvalTx = buildApprovalTx(
    fromTokenAddr,
    spender,
    BigInt(token.balance),
    chainResult.chainId,
    quote.approvalTo,
    quote.approvalData
  )
  const resetApprovalTx = needsResetApproval(fromTokenAddr)
    ? buildResetApprovalTx(fromTokenAddr, spender, chainResult.chainId)
    : undefined

  return {
    planned: {
      chainId: chainResult.chainId,
      pluginId: chainResult.pluginId,
      tokenSymbol: token.symbol,
      tokenAddress: fromTokenAddr,
      tokenBalance: token.balance,
      targetSymbol,
      authorization: 'approve',
      resetApprovalTx: resetApprovalTx as unknown as TransactionRequestLike,
      approvalTx: approvalTx as unknown as TransactionRequestLike,
      swapTx: swapTx as unknown as TransactionRequestLike,
      fromAddress
    },
    skipped: null
  }
}
