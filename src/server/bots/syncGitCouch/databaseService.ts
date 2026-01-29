import type { DatabaseSetup } from 'edge-server-tools'
import nano, { type DocumentScope } from 'nano'

import { config } from '../../../config'
import type { LogFunction } from '../../types'
import {
  asCouchDoc,
  asSyncConfigDoc,
  asSyncStatusDoc,
  type ConfigDb,
  type CouchDoc,
  type DocStatus,
  type SyncConfigDoc,
  type SyncStatusDoc
} from './types'

const CONFIG_DB_NAME = 'autobot_syncgitcouch'

// Database setup for dbInit.ts
export const syncGitCouchDatabaseSetup: DatabaseSetup = {
  name: CONFIG_DB_NAME,
  documents: {
    // Sample disabled config for reference
    sampleConfig: {
      _id: 'sampleConfig',
      enabled: false,
      gitRepo: 'git@github.com:example/repo.git',
      couchUrl: 'https://admin:password@couchdb.example.com:6984',
      couchDb: 'app_sampledb',
      syncDocs: ['someSettings', 'moreSettings']
    }
  }
}

/**
 * Create connection to the main autobot_syncgitcouch database
 */
export const createConfigDbConnection = (): ConfigDb => {
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
    const url = new URL(couchCredential.url)
    url.username = couchCredential.username
    url.password = couchCredential.password
    couch = nano(url.toString())
  } else {
    throw new Error('Invalid couch credential')
  }

  return couch.use(CONFIG_DB_NAME)
}

/**
 * Create connection to a target CouchDB database specified in config
 */
export const createTargetDbConnection = (
  couchUrl: string,
  dbName: string
): DocumentScope<CouchDoc> => {
  const couch = nano(couchUrl)
  return couch.use(dbName)
}

/**
 * Get all sync configurations from the database
 */
export const getAllSyncConfigs = async (
  db: ConfigDb,
  log: LogFunction
): Promise<SyncConfigDoc[]> => {
  try {
    const response = await db.list({ include_docs: true })
    const configs: SyncConfigDoc[] = []

    for (const row of response.rows) {
      // Skip design documents and status documents
      if (
        row.id.startsWith('_design/') ||
        row.id.endsWith(':status') ||
        row.doc == null
      ) {
        continue
      }

      try {
        const doc = asSyncConfigDoc(row.doc)
        // Only include enabled configs
        if (doc.enabled) {
          configs.push(doc)
        }
      } catch (error) {
        log.error(`Error parsing config for ${row.id}:`, error)
      }
    }

    return configs
  } catch (error: unknown) {
    log.error('Error getting all sync configs:', error)
    throw error
  }
}

/**
 * Get status document for a config
 */
export const getStatusDoc = async (
  db: ConfigDb,
  configId: string,
  log: LogFunction
): Promise<SyncStatusDoc | null> => {
  try {
    const statusId = `${configId}:status`
    const doc = await db.get(statusId)
    return asSyncStatusDoc(doc)
  } catch (error: unknown) {
    if (
      error != null &&
      typeof error === 'object' &&
      'statusCode' in error &&
      error.statusCode === 404
    ) {
      return null
    }
    log(`Error getting status doc for ${configId}:`, error)
    throw error
  }
}

/**
 * Save or update status document
 */
export const saveStatusDoc = async (
  db: ConfigDb,
  configId: string,
  docStatus: Record<string, DocStatus>,
  log: LogFunction
): Promise<void> => {
  try {
    const statusId = `${configId}:status`
    const existingStatus = await getStatusDoc(db, configId, log)

    const statusDoc: Omit<SyncStatusDoc, '_rev'> & { _rev?: string } = {
      _id: statusId,
      docStatus
    }

    if (existingStatus?._rev != null) {
      statusDoc._rev = existingStatus._rev
    }

    // Cast needed because ConfigDb is typed for SyncConfigDoc but also stores status docs
    await db.insert(statusDoc as unknown as SyncConfigDoc)
  } catch (error: unknown) {
    log(`Error saving status doc for ${configId}:`, error)
    throw error
  }
}

/**
 * Update status for a single document
 */
export const updateDocStatus = async (
  db: ConfigDb,
  configId: string,
  docName: string,
  gitHash: string,
  couchRev: string,
  log: LogFunction
): Promise<void> => {
  const statusDoc = await getStatusDoc(db, configId, log)
  const docStatus = statusDoc?.docStatus ?? {}

  docStatus[docName] = { gitHash, couchRev }

  await saveStatusDoc(db, configId, docStatus, log)
}

/**
 * Get a document from target CouchDB
 */
export const getCouchDoc = async (
  db: DocumentScope<CouchDoc>,
  docId: string
): Promise<CouchDoc | null> => {
  try {
    const doc = await db.get(docId)
    return asCouchDoc(doc)
  } catch (error: unknown) {
    if (
      error != null &&
      typeof error === 'object' &&
      'statusCode' in error &&
      error.statusCode === 404
    ) {
      return null
    }
    throw error
  }
}

/**
 * Update a document in target CouchDB
 */
export const updateCouchDoc = async (
  db: DocumentScope<CouchDoc>,
  doc: CouchDoc
): Promise<string> => {
  const result = await db.insert(doc)
  return result.rev
}
