import nano from 'nano'

import {
  asEmailStatus,
  asImapConfig,
  type EmailForwardRule,
  type EmailStatus,
  type EmailStatusDoc,
  type ImapConfig,
  type ImapConfigDoc
} from '../common/types'
import { config } from '../config'

// Type for CouchDB documents that can be either ImapConfig or EmailStatus
type CouchDocument =
  | ImapConfigDoc
  | EmailStatusDoc
  | { _id: string; _rev?: string; [key: string]: unknown }

// Create CouchDB connection
export const createCouchConnection = (): nano.DocumentScope<ImapConfigDoc> => {
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

  return couch.use('autobot_emailforwards')
}

// Get IMAP configuration for a specific email address
export const getImapConfig = async (
  db: nano.DocumentScope<ImapConfigDoc>,
  emailAddress: string
): Promise<ImapConfig | null> => {
  try {
    const doc = await db.get(emailAddress)
    return asImapConfig(doc)
  } catch (error: unknown) {
    if (
      error != null &&
      typeof error === 'object' &&
      'statusCode' in error &&
      error.statusCode === 404
    ) {
      return null
    }
    console.error(`Error getting IMAP config for ${emailAddress}:`, error)
    throw error
  }
}

// Save IMAP configuration
export const saveImapConfig = async (
  db: nano.DocumentScope<ImapConfigDoc>,
  emailAddress: string,
  imapConfig: ImapConfig
): Promise<void> => {
  try {
    const existingDoc = await getImapConfig(db, emailAddress)

    if (existingDoc != null) {
      // Update existing document
      const doc = await db.get(emailAddress)
      const updatedDoc: ImapConfigDoc = {
        ...imapConfig,
        _id: emailAddress,
        _rev: doc._rev
      }
      await db.insert(updatedDoc)
    } else {
      // Create new document
      const newDoc: ImapConfigDoc = {
        ...imapConfig,
        _id: emailAddress
      }
      await db.insert(newDoc)
    }

    console.log(`Saved IMAP config for ${emailAddress}`)
  } catch (error: unknown) {
    console.error(`Error saving IMAP config for ${emailAddress}:`, error)
    throw error
  }
}

// Delete IMAP configuration
export const deleteImapConfig = async (
  db: nano.DocumentScope<ImapConfigDoc>,
  emailAddress: string
): Promise<void> => {
  try {
    const doc = await db.get(emailAddress)
    await db.destroy(emailAddress, doc._rev)
  } catch (error: unknown) {
    console.error(`Error deleting IMAP config for ${emailAddress}:`, error)
    throw error
  }
}

// Get all IMAP configurations
export const getAllImapConfigs = async (
  db: nano.DocumentScope<ImapConfigDoc>
): Promise<Array<{ emailAddress: string; config: ImapConfig }>> => {
  try {
    const response = await db.list({ include_docs: true })
    const configs: Array<{ emailAddress: string; config: ImapConfig }> = []

    for (const row of response.rows) {
      // Skip design documents and documents without email field
      if (row.doc?.forwardRules != null && row.doc.active) {
        try {
          const config = asImapConfig(row.doc)
          configs.push({
            emailAddress: row.id,
            config
          })
        } catch (error) {
          console.error(`Error parsing config for ${row.id}:`, error)
        }
      }
    }

    return configs
  } catch (error: unknown) {
    console.error('Error getting all IMAP configs:', error)
    throw error
  }
}

// Update forward rules for a specific email
export const updateForwardRules = async (
  db: nano.DocumentScope<ImapConfigDoc>,
  emailAddress: string,
  forwardRules: EmailForwardRule[]
): Promise<void> => {
  try {
    const doc = await db.get(emailAddress)
    const updatedDoc = {
      ...doc,
      forwardRules
    }
    await db.insert(updatedDoc)
  } catch (error: unknown) {
    console.error(`Error updating forward rules for ${emailAddress}:`, error)
    throw error
  }
}

// Get email status for a specific email address
export const getEmailStatus = async (
  db: nano.DocumentScope<ImapConfigDoc>,
  emailAddress: string
): Promise<EmailStatus | null> => {
  try {
    const statusId = `${emailAddress}__status`
    const doc = await db.get(statusId)
    return asEmailStatus(doc)
  } catch (error: unknown) {
    if (
      error != null &&
      typeof error === 'object' &&
      'statusCode' in error &&
      error.statusCode === 404
    ) {
      return null
    }
    console.error(`Error getting email status for ${emailAddress}:`, error)
    throw error
  }
}

// Save or update email status
export const saveEmailStatus = async (
  db: nano.DocumentScope<ImapConfigDoc>,
  emailAddress: string,
  emailStatus: EmailStatus
): Promise<void> => {
  try {
    const statusId = `${emailAddress}__status`
    const existingStatus = await getEmailStatus(db, emailAddress)

    if (existingStatus != null) {
      // Update existing document
      const doc = (await db.get(statusId)) as CouchDocument
      const updatedDoc: EmailStatusDoc = {
        ...emailStatus,
        _id: statusId,
        _rev: doc._rev
      }
      await db.insert(updatedDoc as unknown as ImapConfigDoc)
    } else {
      // Create new document
      const newDoc: EmailStatusDoc = {
        ...emailStatus,
        _id: statusId
      }
      await db.insert(newDoc as unknown as ImapConfigDoc)
    }

    console.log(`Saved email status for ${emailAddress}`)
  } catch (error: unknown) {
    console.error(`Error saving email status for ${emailAddress}:`, error)
    throw error
  }
}
