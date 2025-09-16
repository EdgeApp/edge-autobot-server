import { asNumber, asObject, asValue } from 'cleaners'

import type { BridgelessSubmission } from './types'

const doFetch = async (
  url: string,
  opts: RequestInit = {}
): Promise<unknown> => {
  const res = await fetch(url, opts)
  if (!res.ok) {
    const message = await res.text()
    throw new Error(`Fetch failed: ${message}`)
  }
  const json = await res.json()
  return json
}

const asBridgelessNumConfirmations = asObject({
  chain: asObject({
    // "id": "0",
    // "type": "BITCOIN",
    // "bridge_address": "1E3TeJbW5iy6b2YLF427Za4HTaYQ3yFSUK",
    // "operator": "1E3TeJbW5iy6b2YLF427Za4HTaYQ3yFSUK",
    confirmations: asNumber
    // "name": "Bitcoin"
  })
})
export const getRequiredConfirmations = async (
  chainId: string
): Promise<number> => {
  const json = await doFetch(
    `https://rpc-api.node0.mainnet.bridgeless.com/cosmos/bridge/chains/${chainId}`
  )
  const clean = asBridgelessNumConfirmations(json)
  return clean.chain.confirmations
}

const BITCOIN_BLOCKBOOK_URL = 'https://btc-wusa1.edge.app/api/v2'

const asBitcoinBlockbookInfo = asObject({
  blockbook: asObject({
    bestHeight: asNumber
  })
})
const getBitcoinChainHeight = async (): Promise<number> => {
  const json = await doFetch(`${BITCOIN_BLOCKBOOK_URL}/`)
  const clean = asBitcoinBlockbookInfo(json)
  return clean.blockbook.bestHeight
}

const asBitcoinTransaction = asObject({
  blockHeight: asNumber
})
const getBitcoinTransactionHeight = async (txid: string): Promise<number> => {
  const json = await doFetch(`${BITCOIN_BLOCKBOOK_URL}/tx/${txid}`)
  const clean = asBitcoinTransaction(json)
  return Math.max(clean.blockHeight, 0)
}

const ZANO_RPC_URL = 'http://37.27.100.59:10500'

const asZanoHeight = asObject({
  height: asNumber,
  status: asValue('OK')
})
const getZanoChainHeight = async (): Promise<number> => {
  const json = await doFetch(`${ZANO_RPC_URL}/getheight`)
  const clean = asZanoHeight(json)
  return clean.height
}

const asZanoTransactionHeight = asObject({
  // id: 0,
  // jsonrpc: '2.0',
  result: asObject({
    status: asValue('OK'),
    tx_info: asObject({
      // amount: 18999000000000,
      // attachments: [
      //   {
      //     details_view: '',
      //     short_view:
      //       '0feef5e2ea0e88b592c0a0e6639ce73e12ea9b3136d89464748fcb60bb6f18f5',
      //     type: 'pub_key'
      //   }
      // ],
      // blob: 'ARMBgKCUpY0dBBoAAAAAAAAAABoCAAAAAAAAABoKAAAAAAAAABoPAAAAAAAAACVA4FRLH',
      // blob_size: 6794,
      // extra: [
      //   {
      //     details_view: '',
      //     short_view:
      //       '0feef5e2ea0e88b592c0a0e6639ce73e12ea9b3136d89464748fcb60bb6f18f5',
      //     type: 'pub_key'
      //   }
      // ],
      // fee: 1000000000,
      // id: 'a6e8da986858e6825fce7a192097e6afae4e889cabe853a9c29b964985b23da8',
      // ins: [
      //   {
      //     amount: 1000000000000,
      //     global_indexes: [0, 2, 12, 27],
      //     htlc_origin: '',
      //     kimage_or_ms_id:
      //       '2540e0544b1fed3b104976f803dbd83681335c427f9d601d9d5aecf86ef276d2',
      //     multisig_count: 0
      //   }
      // ],
      keeper_block: asNumber
      // object_in_json: 'ewogICJ2ZXJzaW9uIjogMSwgCiAgInZpbiI6IFsgewogICAgIC',
      // outs: [
      //   {
      //     amount: 9000000000,
      //     global_index: 0,
      //     is_spent: false,
      //     minimum_sigs: 0,
      //     pub_keys: [
      //       '7d0c755e7e24a241847176c9a3cf4c970bcd6377018068abe6fe4535b23f5323'
      //     ]
      //   }
      // ],
      // pub_key:
      //   '0feef5e2ea0e88b592c0a0e6639ce73e12ea9b3136d89464748fcb60bb6f18f5',
      // timestamp: 1557345925
    })
  })
})
const getZanoTransactionHeight = async (txid: string): Promise<number> => {
  const body = {
    id: 0,
    jsonrpc: '2.0',
    method: 'get_tx_details',
    params: {
      tx_hash: txid
    }
  }
  const opts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }
  const json = await doFetch(`${ZANO_RPC_URL}/json_rpc`, opts)
  const clean = asZanoTransactionHeight(json)
  return Math.max(clean.result.tx_info.keeper_block, 0)
}

export const chainUtils: Record<
  string,
  {
    getChainHeight: () => Promise<number>
    getTxHeight: (txid: string) => Promise<number>
  }
> = {
  // bitcoin
  '0': {
    getChainHeight: getBitcoinChainHeight,
    getTxHeight: getBitcoinTransactionHeight
  },
  // Zano
  '2': {
    getChainHeight: getZanoChainHeight,
    getTxHeight: getZanoTransactionHeight
  }
}

export const submitBridgelessDeposit = async (
  args: BridgelessSubmission
): Promise<void> => {
  const safeTxHash = args.txHash.startsWith('0x')
    ? args.txHash
    : `0x${args.txHash}`
  try {
    await doFetch('https://tss1.mainnet.bridgeless.com/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        txHash: safeTxHash,
        txNonce: args.txNonce,
        chainId: args.chainId
      })
    })
  } catch (e) {
    if (e instanceof Error && e.message.includes('deposit already exists')) {
      // do nothing, safe to delete doc
    } else {
      throw e
    }
  }
}
