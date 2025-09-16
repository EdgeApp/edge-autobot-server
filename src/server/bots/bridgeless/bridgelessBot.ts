import type { Request, Response } from 'express'

import type { Autobot, AutobotEngineArgs } from '../../types'
import {
  createBridgelessDoc,
  createCouchConnection,
  deleteBridgelessDoc,
  getAllBridgelessDocs,
  updateBridgelessDoc
} from './databaseService'
import {
  chainUtils,
  getRequiredConfirmations,
  submitBridgelessDeposit
} from './txidSubmissionService'
import { asBridgelessSubmission } from './types'

async function bridgelessBotEngine({ log }: AutobotEngineArgs): Promise<void> {
  const db = createCouchConnection()

  log('Processing all txids...')
  const configs = await getAllBridgelessDocs(db)
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
      const numConfirmations = await getRequiredConfirmations(chainId)

      for (const document of documents) {
        if (document.confirmedHeight === 0) {
          try {
            const txHeight = await chainUtils[chainId].getTxHeight(
              document.txHash
            )
            if (txHeight === 0) {
              continue
            }

            document.confirmedHeight = txHeight
            await updateBridgelessDoc(db, document)
          } catch (error) {
            log(`Error updating txid ${document.txHash}:`, error)
            continue
          }
        }

        if (document.confirmedHeight + (numConfirmations - 1) <= chainHeight) {
          await submitBridgelessDeposit(document)
          log('Successfully submitted deposit for txid:', document.txHash)
          await deleteBridgelessDoc(db, document)
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
