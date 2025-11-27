import { asArray, asBoolean, asObject, asOptional, asString } from 'cleaners'
import type { DocumentScope } from 'nano'

// Cleaner for git file content (with optional _id for initial sync scenarios)
export const asGitDocContent = asObject({
  _id: asOptional(asString),
  _rev: asOptional(asString)
}).withRest

export type GitDocContent = ReturnType<typeof asGitDocContent>

export const asSyncConfigDoc = asObject({
  _id: asString,
  _rev: asOptional(asString),
  enabled: asBoolean,
  gitRepo: asString,
  couchUrl: asString,
  couchDb: asString,
  syncDocs: asArray(asString)
})

// Cleaners for status documents
export const asDocStatus = asObject({
  gitHash: asString, // Git commit hash of last sync
  couchRev: asString
})

export const asSyncStatusDoc = asObject({
  _id: asString,
  _rev: asOptional(asString),
  docStatus: asObject(asDocStatus)
})

// Type definitions derived from cleaners
export type SyncConfigDoc = ReturnType<typeof asSyncConfigDoc>
export type DocStatus = ReturnType<typeof asDocStatus>
export type SyncStatusDoc = ReturnType<typeof asSyncStatusDoc>

// Cleaner for CouchDB documents in target database (with loose validation for extra fields)
export function asCouchDoc(raw: any): CouchDoc {
  // Validate required fields
  asObject({
    _id: asString,
    _rev: asOptional(asString)
  })(raw)

  // Return with all additional fields
  return raw as CouchDoc
}

// Type for CouchDB documents in target database
export interface CouchDoc {
  _id: string
  _rev?: string
  [key: string]: unknown
}

// Type for change feed events
export interface CouchChange {
  seq: string | number
  id: string
  changes: Array<{ rev: string }>
  deleted?: boolean
  doc?: CouchDoc
}

// Type alias for the config database
export type ConfigDb = DocumentScope<SyncConfigDoc>
