import { asMaybe } from 'cleaners'
import type { DatabaseSetup } from 'edge-server-tools'
import nano from 'nano'

import { config } from '../../../config'
import { asHoudiniDoc, type HoudiniDoc, type HoudiniSubmission } from './types'

// Database setup configuration following edge-reports-server pattern
export const houdiniDatabaseSetup: DatabaseSetup = {
  name: 'autobot_houdini_orders'
}

// Create CouchDB connection
export const createCouchConnection = (): nano.DocumentScope<HoudiniDoc> => {
  const couchCredential = config.couchUris[config.couchMainCluster]
  let couch: nano.ServerScope

  if (typeof couchCredential === 'string') {
    couch = nano(couchCredential)
  } else if (typeof couchCredential === 'object') {
    if (couchCredential.url == null) {
      throw new Error('Couch credential url is required')
    }
    if (couchCredential.username == null) {
      throw new Error('Couch credential username is required')
    }
    if (couchCredential.password == null) {
      throw new Error('Couch credential password is required')
    }
    // Put the username and password into the url using basic auth
    const url = new URL(couchCredential.url)
    url.username = couchCredential.username
    url.password = couchCredential.password
    couch = nano(url.toString())
  } else {
    throw new Error('Invalid couch credential')
  }

  return couch.use('autobot_houdini_orders')
}

const PENDING_QUERY_LIMIT = 500 // page size for the pending-docs query

// Create the status index the pending query runs on, once per process.
let indexReady = false
export const ensureHoudiniDbReady = async (
  db: nano.DocumentScope<HoudiniDoc>
): Promise<void> => {
  if (indexReady) return
  await db.createIndex({
    index: { fields: ['status'] },
    ddoc: 'houdini-indexes',
    name: 'status-idx'
  })
  indexReady = true
}

export const getPendingHoudiniDocs = async (
  db: nano.DocumentScope<HoudiniDoc>
): Promise<HoudiniDoc[]> => {
  try {
    const out: HoudiniDoc[] = []

    // Page through the full pending set so a large backlog cannot hide
    // documents beyond the first page.
    let bookmark: string | undefined
    while (true) {
      const response = await db.find({
        selector: { status: 'pending' },
        limit: PENDING_QUERY_LIMIT,
        bookmark
      })

      for (const doc of response.docs) {
        const couchDoc = asMaybe(asHoudiniDoc)(doc)
        if (couchDoc != null) out.push(couchDoc)
      }

      if (response.docs.length < PENDING_QUERY_LIMIT) break
      if (response.bookmark == null || response.bookmark === bookmark) break
      bookmark = response.bookmark
    }
    return out
  } catch (error: unknown) {
    if (
      error != null &&
      typeof error === 'object' &&
      'statusCode' in error &&
      error.statusCode === 404
    ) {
      return []
    }
    console.error(`Error getting Houdini orders:`, error)
    throw error
  }
}

// The order id is the doc id, so a repeat report of the same order is a
// conflict rather than a second doc.
export const createHoudiniDoc = async (
  db: nano.DocumentScope<HoudiniDoc>,
  submission: HoudiniSubmission
): Promise<HoudiniDoc> => {
  const document: HoudiniDoc = {
    ...submission,
    _id: submission.orderId,
    _rev: undefined,
    status: 'pending',
    attempts: 0,
    createdAt: new Date().toISOString(),
    lastAttemptAt: undefined,
    lastError: undefined,
    confirmedAt: undefined
  }
  const response = await db.insert(document)
  return { ...document, _rev: response.rev }
}

// Writes the doc over the revision it carries. Returns the stored doc, or
// undefined when another writer changed the doc since that revision.
export const writeHoudiniDoc = async (
  db: nano.DocumentScope<HoudiniDoc>,
  document: HoudiniDoc
): Promise<HoudiniDoc | undefined> => {
  try {
    const response = await db.insert(document)
    return { ...document, _rev: response.rev }
  } catch (error: unknown) {
    if (isConflict(error)) return undefined
    throw error
  }
}

// Stores an attempt's outcome over the claim it was made under. A pending or
// rejected outcome is dropped when the doc changed since the claim, because a
// newer attempt owns the doc. A confirmation is kept over any later change,
// because Houdini accepting the tx is final.
export const saveHoudiniResult = async (
  db: nano.DocumentScope<HoudiniDoc>,
  result: HoudiniDoc
): Promise<boolean> => {
  if ((await writeHoudiniDoc(db, result)) != null) return true
  if (result.status !== 'confirmed') return false

  const current = asHoudiniDoc(await db.get(result._id))
  if (current.status === 'confirmed') return true
  const confirmed: HoudiniDoc = {
    ...current,
    status: 'confirmed',
    confirmedAt: result.confirmedAt,
    lastError: undefined
  }
  return (await writeHoudiniDoc(db, confirmed)) != null
}

export const isConflict = (error: unknown): boolean =>
  error != null &&
  typeof error === 'object' &&
  'statusCode' in error &&
  error.statusCode === 409
