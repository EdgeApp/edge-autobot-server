import { asMaybe } from 'cleaners'
import type { DatabaseSetup } from 'edge-server-tools'
import nano from 'nano'

import { config } from '../../../config'
import {
  asBridgelessDoc,
  type BridgelessDoc,
  type BridgelessSubmission
} from './types'

// Database setup configuration following edge-reports-server pattern
export const bridgelessDatabaseSetup: DatabaseSetup = {
  name: 'autobot_bridgeless_txids'
}

// Create CouchDB connection
export const createCouchConnection = (): nano.DocumentScope<BridgelessDoc> => {
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

  return couch.use('autobot_bridgeless_txids')
}

const PENDING_QUERY_LIMIT = 500 // page size for the pending-docs query

// One-time (per process) database preparation: create the status index used
// by the pending query, and stamp `status: 'pending'` onto any docs written
// before the field existed (docs without an indexed field are invisible to
// Mango queries on it).
let dbReady = false
export const ensureBridgelessDbReady = async (
  db: nano.DocumentScope<BridgelessDoc>
): Promise<void> => {
  if (dbReady) return

  await db.createIndex({
    index: { fields: ['status'] },
    ddoc: 'bridgeless-indexes',
    name: 'status-idx'
  })

  const response = await db.list({ include_docs: true })
  for (const row of response.rows) {
    const raw: unknown = row.doc
    if (
      raw != null &&
      typeof raw === 'object' &&
      !('status' in raw) &&
      'txHash' in raw
    ) {
      const couchDoc = asMaybe(asBridgelessDoc)(raw)
      if (couchDoc == null) continue
      await db.insert({ ...couchDoc, status: 'pending' })
    }
  }

  dbReady = true
}

export const getPendingBridgelessDocs = async (
  db: nano.DocumentScope<BridgelessDoc>
): Promise<Record<string, BridgelessDoc[]> | null> => {
  try {
    const out: Record<string, BridgelessDoc[]> = {}

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
        const couchDoc = asMaybe(asBridgelessDoc)(doc)
        if (couchDoc == null) continue

        out[couchDoc.chainId] ??= []
        out[couchDoc.chainId].push(couchDoc)
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
      return null
    }
    console.error(`Error getting Bridgeless txids:`, error)
    throw error
  }
}

export const createBridgelessDoc = async (
  db: nano.DocumentScope<BridgelessDoc>,
  submission: BridgelessSubmission
): Promise<void> => {
  await db.insert({
    ...submission,
    confirmedHeight: 0,
    status: 'pending' as const,
    chainName: undefined,
    submittedAt: undefined,
    submitted: undefined,
    _id: `${submission.chainId}_${submission.txHash}`,
    _rev: undefined
  })
}

export const updateBridgelessDoc = async (
  db: nano.DocumentScope<BridgelessDoc>,
  document: BridgelessDoc
): Promise<void> => {
  const doc = await db.get(document._id)
  await db.insert({
    ...document,
    _id: document._id,
    _rev: doc._rev
  })
}

// Delete Bridgeless doc
export const deleteBridgelessDoc = async (
  db: nano.DocumentScope<BridgelessDoc>,
  document: BridgelessDoc
): Promise<void> => {
  try {
    const doc = await db.get(document._id)
    await db.destroy(doc._id, doc._rev)
  } catch (error: unknown) {
    console.error(`Error deleting Bridgeless doc for ${document._id}:`, error)
    throw error
  }
}
