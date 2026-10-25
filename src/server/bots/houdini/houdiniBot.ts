import type { Request, Response } from 'express'

import type { Autobot, AutobotEngineArgs, LogFunction } from '../../types'
import {
  CONFIRM_TIMEOUT_MS,
  confirmHoudiniDoc,
  hasHoudiniCredentials,
  isHoudiniReportingEnabled
} from './confirmService'
import {
  createCouchConnection,
  createHoudiniDoc,
  ensureHoudiniDbReady,
  getHoudiniDoc,
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

// The spacing before a retry doubles with each attempt, from the first value
// up to the cap. The first value exceeds the request timeout, so an attempt
// has always ended before the next one on the same order is due.
const RETRY_FIRST_MS = CONFIRM_TIMEOUT_MS + 10 * 1000
const RETRY_CAP_MS = 60 * 60 * 1000

// Same `MM-DDTHH:mm:ss.sssZ:` prefix as the engine's log lines.
const stamp = (): string => new Date().toISOString().slice(5)

const apiLog: LogFunction = Object.assign(
  (...args: unknown[]): void => {
    console.log(`${stamp()}:houdini:api: ${args.join(' ')}`)
  },
  {
    warn: (...args: unknown[]): void => {
      console.warn(`${stamp()}:houdini:api: ${args.join(' ')}`)
    },
    error: (...args: unknown[]): void => {
      console.error(`${stamp()}:houdini:api: ${args.join(' ')}`)
    }
  }
)

/**
 * Whether a pending report is due for an attempt at `now`. A new report is
 * due at once; after that the spacing doubles with each attempt, up to an
 * hour.
 */
export const isAttemptDue = (document: HoudiniDoc, now: number): boolean => {
  if (document.attempts === 0 || document.lastAttemptAt == null) return true
  const spacing = Math.min(
    RETRY_FIRST_MS * 2 ** (document.attempts - 1),
    RETRY_CAP_MS
  )
  return Date.parse(document.lastAttemptAt) + spacing <= now
}

/**
 * Claims the doc before calling Houdini by recording the attempt at the
 * revision this caller read. A caller holding an older revision gets a
 * conflict and leaves the order to the claim's owner.
 */
export const attemptConfirm = async (
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

/**
 * Attempts every pending report that is due at `now`, one at a time.
 */
export const processHoudiniOrders = async (
  db: ReturnType<typeof createCouchConnection>,
  log: LogFunction,
  now: number
): Promise<void> => {
  const documents = await getPendingHoudiniDocs(db)
  const due = documents.filter(document => isAttemptDue(document, now))
  log(`Processing ${due.length} of ${documents.length} pending Houdini orders`)

  for (const document of due) {
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

async function houdiniBotEngine({ log }: AutobotEngineArgs): Promise<void> {
  if (!hasHoudiniCredentials()) {
    log.warn('Houdini API key or secret is not configured, skipping')
    return
  }
  const db = createCouchConnection()
  await ensureHoudiniDbReady(db)
  await processHoudiniOrders(db, log, Date.now())
}

export interface HoudiniReportAnswer {
  status: number
  error?: string
}

// The order id is the doc id, so a repeat report lands as a conflict. The
// same tx hash makes the repeat idempotent; a different one is a second
// transaction for an order already tracked, which this server will not
// confirm, so the app hears 409.
const storeSubmission = async (
  db: ReturnType<typeof createCouchConnection>,
  submission: HoudiniSubmission,
  log: LogFunction
): Promise<HoudiniReportAnswer> => {
  const { orderId, txHash } = submission
  try {
    await createHoudiniDoc(db, submission)
    return { status: 200 }
  } catch (error: unknown) {
    if (!isConflict(error)) throw error
  }

  const stored = await getHoudiniDoc(db, orderId)
  if (stored.txHash.toLowerCase() === txHash.toLowerCase()) {
    return { status: 200 }
  }
  log.warn(
    `Houdini order ${orderId} was reported again with tx ${txHash}, but is tracked with tx ${stored.txHash}`
  )
  return { status: 409, error: 'Order already reported with another tx' }
}

/**
 * Stores a dex report for the engine, which makes the first attempt on its
 * next run, and returns the answer for the app. A server that cannot work
 * reports answers 503 without opening the database, so the app confirms the
 * order itself.
 */
export const answerHoudiniReport = async (
  openDb: () => ReturnType<typeof createCouchConnection>,
  body: unknown,
  log: LogFunction
): Promise<HoudiniReportAnswer> => {
  if (!isHoudiniReportingEnabled()) {
    return { status: 503, error: 'Houdini reporting is not enabled' }
  }

  let submission: HoudiniSubmission
  try {
    submission = asHoudiniSubmission(body)
  } catch (error: unknown) {
    log.warn('Rejected a malformed Houdini report:', error)
    return { status: 400, error: 'Invalid request body' }
  }

  try {
    return await storeSubmission(openDb(), submission, log)
  } catch (error: unknown) {
    log.error(
      `Error storing Houdini order ${submission.orderId}, tx ${submission.txHash}:`,
      error
    )
    return { status: 500, error: 'Server error' }
  }
}

export const handleHoudiniReport = (req: Request, res: Response): void => {
  answerHoudiniReport(createCouchConnection, req.body, apiLog)
    .then(({ status, error }) => {
      if (error == null) res.status(status).send()
      else res.status(status).json({ error })
    })
    .catch((error: unknown) => {
      apiLog.error('Error answering a Houdini report:', error)
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
