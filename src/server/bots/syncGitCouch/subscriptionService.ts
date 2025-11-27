import type { DocumentScope } from 'nano'

import type { LogFunction } from '../../types'
import { createTargetDbConnection } from './databaseService'
import type { CouchChange, CouchDoc, SyncConfigDoc } from './types'

/**
 * Subscription manager object (functional style)
 */
export interface SubscriptionManager {
  subscriptions: Map<string, { db: DocumentScope<CouchDoc> }>
}

/**
 * Initialize subscriptions for all configs
 */
export async function initializeSubscriptions(
  manager: SubscriptionManager,
  configs: SyncConfigDoc[],
  onChange: (configId: string, docId: string) => Promise<void>,
  log: LogFunction
): Promise<void> {
  // Close any existing subscriptions
  closeSubscriptions(manager, log)

  for (const config of configs) {
    try {
      const db = createTargetDbConnection(config.couchUrl, config.couchDb)

      // Get the set of document IDs we care about (for fast lookup)
      const docIds = new Set(config.syncDocs)

      log(`Setting up subscription for ${config._id} (${docIds.size} docs)`)

      // Create a changes feed
      const feed = db.changesReader.start({
        since: 'now',
        includeDocs: false
      })

      // Handle changes
      feed.on('change', (change: CouchChange) => {
        const docId = change.id
        // Only process changes for documents we're syncing
        if (docIds.has(docId)) {
          log(`Change detected: ${config._id}/${docId}`)
          // Fire and forget - don't await
          onChange(config._id, docId).catch((error: unknown) => {
            log(`Error handling change for ${config._id}/${docId}:`, error)
          })
        }
      })

      feed.on('error', (error: unknown) => {
        log(`Change feed error for ${config._id}:`, error)
      })

      manager.subscriptions.set(config._id, { db })
    } catch (error: unknown) {
      log(`Failed to setup subscription for ${config._id}:`, error)
    }
  }

  log(`Initialized ${manager.subscriptions.size} subscriptions`)
}

/**
 * Close all subscriptions
 */
export function closeSubscriptions(
  manager: SubscriptionManager,
  log: LogFunction
): void {
  for (const [configId, { db }] of Array.from(
    manager.subscriptions.entries()
  )) {
    try {
      db.changesReader.stop()
    } catch (error: unknown) {
      log(`Error closing subscription for ${configId}:`, error)
    }
  }
  manager.subscriptions.clear()
}

// Singleton instance
let subscriptionManager: SubscriptionManager | null = null

/**
 * Get the singleton subscription manager
 */
export function getSubscriptionManager(): SubscriptionManager {
  subscriptionManager ??= {
    subscriptions: new Map()
  }
  return subscriptionManager
}
