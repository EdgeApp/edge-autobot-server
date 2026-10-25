import type { Request, Response } from 'express'

import type { Autobot, AutobotEngineArgs, LogFunction } from '../../types'
import {
  CONFIRM_TIMEOUT_MS,
  confirmHoudiniDoc,
  hasHoudiniCredentials
} from './confirmService'
import {
  createCouchConnection,
  createHoudiniDoc,
  ensureHoudiniDbReady,
  getPendingHoudiniDocs,
  isConflict,
  saveHoudiniResult,
  writeHoudiniDoc
} from './databaseService'
import {
  asHoudiniSubmission,
  type HoudiniDoc,
  type HoudiniSubmission
} from './types'

// The API makes the first attempt as a report arrives, in a separate process
// from the engine. The engine leaves a doc alone for this long after its
// creation or the start of its last attempt. An attempt cannot outlast its
// request timeout, so it has always ended once the spacing has passed.
const ATTEMPT_SPACING_MS = CONFIRM_TIMEOUT_MS + 10 * 1000

const apiLog: LogFunction = Object.assign(
  (...args: unknown[]): void => {
    console.log(`houdini:api: ${args.join(' ')}`)
  },
  {
    warn: (...args: unknown[]): void => {
      console.warn(`houdini:api: ${args.join(' ')}`)
    },
    error: (...args: unknown[]): void => {
      console.error(`houdini:api: ${args.join(' ')}`)
    }
  }
)

// Claims the doc before calling Houdini by recording the attempt at the
// revision this caller read. A caller holding an older revision gets a
// conflict and leaves the order to the claim's owner, and the engine's
// spacing check sees the attempt while it is still in flight.
const attemptConfirm = async (
  db: ReturnType<typeof createCouchConnection>,
  document: HoudiniDoc,
  log: LogFunction
): Promise<void> => {
  const { orderId, txHash } = document
  const claimed = await writeHoudiniDoc(db, {
    ...document,
    attempts: document.attempts + 1,
    lastAttemptAt: new Date().toISOString()
  })
  if (claimed == null) {
    log(`Houdini order ${orderId} changed before its attempt, skipping`)
    return
  }

  const result = await confirmHoudiniDoc(claimed, log)
  if (!(await saveHoudiniResult(db, result))) {
    log.warn(
      `Houdini order ${orderId}, tx ${txHash} changed during its attempt, dropped the ${result.status} result`
    )
  }
}

async function houdiniBotEngine({ log }: AutobotEngineArgs): Promise<void> {
  if (!hasHoudiniCredentials()) {
    log.warn('Houdini API key or secret is not configured, skipping')
    return
  }
  const db = createCouchConnection()
  await ensureHoudiniDbReady(db)

  const documents = await getPendingHoudiniDocs(db)
  log(`Processing ${documents.length} pending Houdini orders`)

  const cutoff = Date.now() - ATTEMPT_SPACING_MS
  for (const document of documents) {
    const lastTouched = Date.parse(document.lastAttemptAt ?? document.createdAt)
    if (lastTouched > cutoff) continue

    // Isolate each doc so one failing order cannot block the rest.
    try {
      await attemptConfirm(db, document, log)
    } catch (error: unknown) {
      log.error(
        `Error processing Houdini order ${document.orderId}, tx ${document.txHash}:`,
        error
      )
    }
  }

  log('Completed processing Houdini orders')
}

export const handleHoudiniReport = (req: Request, res: Response): void => {
  let submission: HoudiniSubmission
  try {
    submission = asHoudiniSubmission(req.body)
  } catch (e: unknown) {
    console.error('Error creating Houdini doc:', e)
    res.status(400).json({ error: 'Invalid request body' })
    return
  }
  const { orderId, txHash } = submission

  const db = createCouchConnection()
  createHoudiniDoc(db, submission)
    .then(
      async document => {
        res.status(200).send()
        // Without credentials the report waits in the database for a
        // configured engine.
        if (hasHoudiniCredentials()) await attemptConfirm(db, document, apiLog)
      },
      (e: unknown) => {
        // A conflict means this order was already reported and its doc is
        // already tracked: treat the PUT as idempotent.
        if (isConflict(e)) {
          res.status(200).send()
          return
        }
        console.error('Error creating Houdini doc:', e)
        res.status(500).send('Server Error')
      }
    )
    .catch((e: unknown) => {
      apiLog.error(
        `Error confirming Houdini order ${orderId}, tx ${txHash}:`,
        e
      )
    })
}

export const houdiniBot: Autobot = {
  botId: 'houdini',
  engines: [
    {
      engine: houdiniBotEngine,
      frequency: 'minute'
    }
  ]
}
