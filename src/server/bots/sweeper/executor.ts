/**
 * Interactive execution: hidden private-key prompt, ethers.js signing and broadcast.
 */
import { ethers } from 'ethers'
import * as readline from 'readline'

import { getRpcUrl } from './chainConfig'
import type {
  AuthorizationMode,
  PlannedSwap,
  TransactionRequestLike
} from './types'

const EIP2612_PERMIT_ABI = [
  'function name() view returns (string)',
  'function nonces(address owner) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)'
]

const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }
  ]
}

export interface PermitSignatureResult {
  chainId: number
  pluginId: string
  tokenSymbol: string
  tokenAddress: string
  owner: string
  spender: string
  value: string
  deadline: number
  nonce: string
  signature: { v: number; r: string; s: string }
  ok: boolean
  error?: string
}

function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
}

export async function promptPrivateKey(): Promise<string> {
  return await new Promise(resolve => {
    const stdin = process.stdin as NodeJS.ReadStream & {
      setRawMode?: (mode: boolean) => void
    }
    if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true)
    process.stdout.write('Enter private key (hidden): ')
    let key = ''
    const onData = (ch: Buffer): void => {
      const c = ch.toString('utf8')
      if (c === '\n' || c === '\r') {
        stdin.removeListener('data', onData)
        if (typeof stdin.setRawMode === 'function') stdin.setRawMode(false)
        stdin.unref()
        process.stdout.write('\n')
        resolve(key.trim())
      } else if (c === '\u0003') {
        process.exit(1)
      } else if (c === '\u007F' || c === '\b') {
        if (key.length > 0) key = key.slice(0, -1)
      } else {
        key += c
      }
    }
    stdin.on('data', onData)
  })
}

export async function promptConfirm(message: string): Promise<boolean> {
  const rl = createReadline()
  return await new Promise(resolve => {
    rl.question(`${message} (yes/no): `, answer => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'yes')
    })
  })
}

export function getProvider(chainId: number): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(getRpcUrl(chainId))
}

export async function signAndSend(
  wallet: ethers.Wallet,
  tx: TransactionRequestLike,
  nonce?: number
): Promise<string> {
  const provider = getProvider(tx.chainId ?? 1)
  const connected = wallet.connect(provider)
  const req: ethers.TransactionRequest = {
    to: tx.to,
    data: tx.data,
    value: tx.value,
    gasLimit: tx.gasLimit,
    chainId: tx.chainId,
    type: tx.type,
    nonce
  }
  const sent = await connected.sendTransaction(req)
  // Don't wait for receipt — caller manages nonces so txs can be
  // broadcast back-to-back without waiting for confirmation.
  return sent.hash
}

export async function executePlannedSwaps(
  planned: PlannedSwap[],
  privateKey: string
): Promise<Array<{ hash: string; chainId: number; tokenSymbol: string }>> {
  const wallet = new ethers.Wallet(privateKey)
  const results: Array<{ hash: string; chainId: number; tokenSymbol: string }> =
    []

  // Fetch starting nonce per chain so we can broadcast all txs without
  // waiting for prior confirmations.
  const nonceByChain = new Map<number, number>()
  for (const p of planned) {
    if (!nonceByChain.has(p.chainId)) {
      const provider = getProvider(p.chainId)
      const nonce = await provider.getTransactionCount(
        wallet.address,
        'pending'
      )
      nonceByChain.set(p.chainId, nonce)
    }
  }

  for (const p of planned) {
    const nextNonce = (): number => {
      const n = nonceByChain.get(p.chainId)!
      nonceByChain.set(p.chainId, n + 1)
      return n
    }

    if (p.resetApprovalTx != null) {
      const nonce = nextNonce()
      const hash = await signAndSend(wallet, p.resetApprovalTx, nonce)
      results.push({
        hash,
        chainId: p.chainId,
        tokenSymbol: `${p.tokenSymbol}(reset-approve)`
      })
    }
    if (p.approvalTx != null) {
      const nonce = nextNonce()
      const hash = await signAndSend(wallet, p.approvalTx, nonce)
      results.push({
        hash,
        chainId: p.chainId,
        tokenSymbol: `${p.tokenSymbol}(approve)`
      })
    }
    const nonce = nextNonce()
    const hash = await signAndSend(wallet, p.swapTx, nonce)
    results.push({ hash, chainId: p.chainId, tokenSymbol: p.tokenSymbol })
  }
  return results
}

/**
 * Sign an EIP-2612 permit for a token. Returns the permit signature
 * without broadcasting anything on-chain.
 */
export async function signPermitForToken(
  privateKey: string,
  chainId: number,
  pluginId: string,
  tokenAddress: string,
  tokenSymbol: string,
  spender: string,
  value: string
): Promise<PermitSignatureResult> {
  const provider = getProvider(chainId)
  const wallet = new ethers.Wallet(privateKey, provider)
  const owner = wallet.address
  const normalized = tokenAddress.startsWith('0x')
    ? tokenAddress
    : `0x${tokenAddress}`

  try {
    const contract = new ethers.Contract(
      normalized,
      EIP2612_PERMIT_ABI,
      provider
    )
    const [tokenName, nonce] = await Promise.all([
      contract.name() as Promise<string>,
      contract.nonces(owner) as Promise<bigint>
    ])

    const deadline = Math.floor(Date.now() / 1000) + 3600 // 1 hour

    const domain: ethers.TypedDataDomain = {
      name: tokenName,
      version: '1',
      chainId,
      verifyingContract: normalized
    }
    const permitValue = {
      owner,
      spender,
      value,
      nonce: nonce.toString(),
      deadline
    }

    const sig = await wallet.signTypedData(domain, PERMIT_TYPES, permitValue)
    const { v, r, s } = ethers.Signature.from(sig)

    return {
      chainId,
      pluginId,
      tokenSymbol,
      tokenAddress: normalized,
      owner,
      spender,
      value,
      deadline,
      nonce: nonce.toString(),
      signature: { v, r, s },
      ok: true
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      chainId,
      pluginId,
      tokenSymbol,
      tokenAddress: normalized,
      owner: new ethers.Wallet(privateKey).address,
      spender,
      value,
      deadline: 0,
      nonce: '0',
      signature: { v: 0, r: '0x', s: '0x' },
      ok: false,
      error: message
    }
  }
}

/**
 * Dry-run: sign permits for all permit-type planned swaps/bridges.
 * Never signs or broadcasts full transactions.
 */
export async function dryRunPermits(
  privateKey: string,
  swaps: Array<{
    chainId: number
    pluginId: string
    tokenSymbol: string
    tokenAddress: string
    spender: string
    value: string
    authorization: AuthorizationMode
  }>
): Promise<PermitSignatureResult[]> {
  const permitItems = swaps.filter(s => s.authorization === 'permit')
  if (permitItems.length === 0) return []

  const results: PermitSignatureResult[] = []
  for (const item of permitItems) {
    const result = await signPermitForToken(
      privateKey,
      item.chainId,
      item.pluginId,
      item.tokenAddress,
      item.tokenSymbol,
      item.spender,
      item.value
    )
    results.push(result)
  }
  return results
}
