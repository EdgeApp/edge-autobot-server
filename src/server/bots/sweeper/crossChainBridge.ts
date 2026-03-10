/**
 * Cross-chain bridge: Rango primary, LiFi fallback. Build bridge tx payloads L2 → Ethereum.
 */
import { ethers } from 'ethers'

import { retryFetch } from '../../../common/utils'
import { CHAINS } from './chainConfig'
import type { SweeperConfig } from './config'
import type {
  PlannedBridge,
  SwapQuoteTx,
  SweeperChainResult,
  TransactionRequestLike
} from './types'

const RANGO_BASE = 'https://api.rango.exchange'
const LIFI_BASE = 'https://li.quest'
const ETH_CHAIN_ID = 1
const ETH_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
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
  const tx = body?.result?.tx ?? body?.tx
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

function isNativeTokenAddress(tokenAddress: string): boolean {
  const normalized = tokenAddress.toLowerCase()
  return (
    normalized === NATIVE_TOKEN_SENTINEL ||
    normalized === PARENT_TOKEN_CONTRACT_ADDRESS
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

async function requestRangoBridge(
  config: SweeperConfig,
  sourceChainId: number,
  sourceTokenAddress: string,
  amountWei: string,
  fromAddress: string,
  slippagePercent: number
): Promise<SwapQuoteTx | null> {
  const chain = CHAINS.find(c => c.chainId === sourceChainId)
  if (chain == null) return null
  const rango = config.rango
  const fromBlock = toRangoAsset(chain.rangoCode, sourceTokenAddress)
  const toBlock = `ETH--${ETH_USDC}`

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
    disableEstimate: 'true',
    slippage: String(slippagePercent)
  })
  const url = `${RANGO_BASE}/basic/swap?${params.toString()}`
  try {
    const response = await retryFetch(url)
    if (!response.ok) {
      console.warn('Rango bridge request failed with status', response.status)
      return null
    }
    const data = (await response.json()) as RangoSwapResponse
    return parseRangoTx(data)
  } catch (err) {
    console.warn('Rango bridge request failed:', err)
    return null
  }
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
  action?: {
    transactionRequest?: LiFiTransactionRequest
  }
  actions?: Array<{
    transactionRequest?: LiFiTransactionRequest
  }>
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

async function requestLifiBridge(
  config: SweeperConfig,
  sourceChainId: number,
  sourceTokenAddress: string,
  amountWei: string,
  fromAddress: string,
  _slippagePercent: number
): Promise<SwapQuoteTx | null> {
  const chain = CHAINS.find(c => c.chainId === sourceChainId)
  if (chain == null) return null
  const ethChain = CHAINS.find(c => c.chainId === ETH_CHAIN_ID)
  if (ethChain == null) return null
  const lifi = config.lifi
  const fromToken = toLifiToken(sourceTokenAddress)
  const slippageDecimal = Math.min(Math.max(_slippagePercent / 100, 0), 0.05)

  const params = new URLSearchParams({
    fromChain: chain.lifiCode,
    toChain: ethChain.lifiCode,
    fromToken,
    toToken: ETH_USDC,
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
    if (!response.ok) {
      console.warn('LiFi bridge request failed with status', response.status)
      return null
    }
    const data = (await response.json()) as LiFiQuoteResponse
    const action = data?.action ?? data?.actions?.[0]
    const tr = data.transactionRequest ?? action?.transactionRequest
    const approvalSpender = findApprovalSpender(data)
    if (tr?.to != null && tr?.data != null) {
      return {
        txTo: tr.to,
        txData: tr.data,
        value: tr.value ?? '0',
        gasLimit: tr.gasLimit,
        approvalSpender
      }
    }
    return null
  } catch (err) {
    console.warn('LiFi bridge request failed:', err)
    return null
  }
}

function buildBridgeTxRequest(
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

function getConsolidatedTokenAddress(result: SweeperChainResult): string {
  if (result.target.tokenAddress != null) {
    return result.target.tokenAddress.startsWith('0x')
      ? result.target.tokenAddress
      : `0x${result.target.tokenAddress}`
  }
  const chain = CHAINS.find(c => c.chainId === result.chainId)
  return `0x${chain?.nativeSymbol === 'ETH' ? 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' : 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'}`
}

function getConsolidatedSymbol(result: SweeperChainResult): string {
  if (result.target.type === 'usdc') return 'USDC'
  if (result.target.type === 'usdt') return 'USDT'
  const chain = CHAINS.find(c => c.chainId === result.chainId)
  return chain?.nativeSymbol ?? 'ETH'
}

/**
 * Build cross-chain bridge payloads for all non-Ethereum chains → Ethereum USDC.
 * Rango primary, LiFi fallback. Skips Ethereum chain (already on mainnet).
 */
export async function buildBridgePlans(
  config: SweeperConfig,
  results: SweeperChainResult[],
  fromAddress: string,
  slippageOverride?: number,
  maxTxs?: number
): Promise<{
  planned: PlannedBridge[]
  skipped: Array<{ chainId: string; symbol: string }>
}> {
  const planned: PlannedBridge[] = []
  const skipped: Array<{ chainId: string; symbol: string }> = []
  const slippage = slippageOverride ?? config.slippage ?? 1
  let craftedTxs = 0

  for (const result of results) {
    if (result.chainId === ETH_CHAIN_ID) continue

    const chain = CHAINS.find(c => c.chainId === result.chainId)
    if (chain == null) continue

    const tokenAddress = getConsolidatedTokenAddress(result)
    const symbol = getConsolidatedSymbol(result)
    const amount = result.target.balance ?? result.nativeBalance

    if (amount === '0' || amount === '' || BigInt(amount) === 0n) {
      continue
    }

    let quote: SwapQuoteTx | null = await requestRangoBridge(
      config,
      result.chainId,
      tokenAddress,
      amount,
      fromAddress,
      slippage
    )
    quote ??= await requestLifiBridge(
      config,
      result.chainId,
      tokenAddress,
      amount,
      fromAddress,
      slippage
    )

    if (quote == null) {
      skipped.push({ chainId: chain.pluginId, symbol })
      continue
    }

    const bridgeTx = buildBridgeTxRequest(quote, result.chainId, fromAddress)
    const isNative = result.target.type === 'native'
    const approvalTx = isNative
      ? undefined
      : buildApprovalTx(
          tokenAddress,
          quote.approvalSpender ?? quote.txTo,
          BigInt(amount),
          result.chainId,
          quote.approvalTo,
          quote.approvalData
        )
    const txsForPlan = approvalTx != null ? 2 : 1
    if (maxTxs != null && craftedTxs + txsForPlan > maxTxs) break
    craftedTxs += txsForPlan

    planned.push({
      sourceChainId: result.chainId,
      sourcePluginId: chain.pluginId,
      sourceTokenAddress: tokenAddress,
      sourceSymbol: symbol,
      targetSymbol: 'USDC (Ethereum)',
      amountWei: amount,
      authorization: isNative ? 'none' : 'approve',
      approvalTx: approvalTx as unknown as TransactionRequestLike | undefined,
      bridgeTx: bridgeTx as unknown as TransactionRequestLike,
      fromAddress
    })
  }

  return { planned, skipped }
}

export async function getBridgeStatus(
  config: SweeperConfig,
  requestId: string,
  txHash: string
): Promise<{ status: string }> {
  const url = `https://api.rango.exchange/basic/status?requestId=${requestId}&txId=${txHash}&apiKey=${config.rango.rangoApiKey}`
  try {
    const response = await retryFetch(url)
    if (!response.ok) {
      throw new Error(`Bridge status fetch failed: HTTP ${response.status}`)
    }
    return (await response.json()) as { status: string }
  } catch (err) {
    console.warn('Failed to fetch bridge status:', err)
    throw err
  }
}
