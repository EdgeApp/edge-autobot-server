import type { Request, Response } from 'express'

import type { Autobot, AutobotEngineArgs } from '../../types'
import {
  createBridgelessDoc,
  createCouchConnection,
  ensureBridgelessDbReady,
  getPendingBridgelessDocs,
  updateBridgelessDoc
} from './databaseService'
import {
  chainUtils,
  getBridgeChainInfo,
  submitBridgelessDeposit
} from './txidSubmissionService'
import { asBridgelessSubmission } from './types'

async function bridgelessBotEngine({ log }: AutobotEngineArgs): Promise<void> {
  const db = createCouchConnection()
  await ensureBridgelessDbReady(db)

  log('Processing all txids...')
  const configs = await getPendingBridgelessDocs(db)
  if (configs == null) {
    log('No txids to process')
    return
  }

  for (const [chainId, documents] of Object.entries(configs)) {
    if (chainUtils[chainId] == null) {
      log(`Chain ${chainId} not supported`)
      continue
    }
    log(`Processing ${documents.length} txids for chain ${chainId}`)
    try {
      const chainHeight = await chainUtils[chainId].getChainHeight()
      const { confirmations: numConfirmations, name: chainName } =
        await getBridgeChainInfo(chainId)

      for (const document of documents) {
        // Isolate each document so one failing txid (e.g. a deposit the TSS
        // rejects every tick) cannot starve the rest of its chain.
        try {
          document.chainName = chainName

          if (document.confirmedHeight === 0) {
            const txHeight = await chainUtils[chainId].getTxHeight(
              document.txHash
            )
            if (txHeight === 0) {
              log(`txid ${document.txHash}: not found on chain yet, waiting`)
              continue
            }

            document.confirmedHeight = txHeight
            await updateBridgelessDoc(db, document)
            log(`txid ${document.txHash}: included at height ${txHeight}`)
          }

          const confirmations = chainHeight - document.confirmedHeight + 1
          if (
            document.confirmedHeight + (numConfirmations - 1) <=
            chainHeight
          ) {
            const submitted = await submitBridgelessDeposit(document, log)
            log('Successfully submitted deposit for txid:', document.txHash)

            // Keep the doc as an audit record. Only record the submitted
            // identifiers when they differ from the doc's own (TON deposits
            // resolve to the bridge tx hash + logical time).
            document.status = 'submitted'
            document.submittedAt = new Date().toISOString()
            if (
              submitted.txHash !== document.txHash &&
              submitted.txHash !== `0x${document.txHash}`
            ) {
              document.submitted = submitted
            }
            await updateBridgelessDoc(db, document)
          } else {
            log(
              `txid ${document.txHash}: waiting for confirmations (${confirmations}/${numConfirmations})`
            )
          }
        } catch (error) {
          log(`Error processing txid ${document.txHash}:`, error)
          continue
        }
      }
    } catch (error) {
      log(`Error processing txids for chain ${chainId}:`, error)
      continue
    }
  }

  log('Completed processing all txids')
}

export const handleBridgelessDeposit = (req: Request, res: Response): void => {
  try {
    const { chainId, txHash, txNonce } = asBridgelessSubmission(req.body)
    const db = createCouchConnection()
    createBridgelessDoc(db, {
      chainId,
      txHash,
      txNonce
    })
      .then(() => res.status(200).send())
      .catch((e: unknown) => {
        // A conflict means this deposit was already reported (possibly already
        // submitted and kept as an audit record) — treat the PUT as idempotent.
        if (
          e != null &&
          typeof e === 'object' &&
          'statusCode' in e &&
          e.statusCode === 409
        ) {
          res.status(200).send()
          return
        }
        res.status(500).send('Server Error')
      })
  } catch (e: unknown) {
    console.error('Error creating Bridgeless doc:', e)
    res.status(400).json({ error: 'Invalid request body' })
  }
}

export const bridgelessBot: Autobot = {
  botId: 'bridgeless',
  engines: [
    {
      engine: bridgelessBotEngine,
      frequency: 'minute'
    }
  ]
}
