import type { Autobot, AutobotEngineArgs, LogFunction } from '../../types'
import { createConfigDbConnection, getAllSyncConfigs } from './databaseService'
import { type GitRepo, makeRepo } from './gitService'
import {
  closeSubscriptions,
  getSubscriptionManager,
  initializeSubscriptions
} from './subscriptionService'
import { handleCouchChange, processConfig } from './syncService'
import type { ConfigDb, SyncConfigDoc } from './types'

// Track pending operations per config to serialize git operations
const pendingOperations = new Map<string, Promise<void>>()

/**
 * Main engine function for syncGitCouch bot
 */
export async function syncGitCouchEngine({
  log
}: AutobotEngineArgs): Promise<void> {
  log('Starting syncGitCouch engine')

  try {
    // Get config database connection
    const configDb = createConfigDbConnection()

    // Get all sync configurations
    const configs = await getAllSyncConfigs(configDb, log)
    log(`Found ${configs.length} sync configurations`)

    if (configs.length === 0) {
      log('No configurations found, skipping')
      return
    }

    // Process each configuration - serialize with pendingOperations to prevent
    // races with subscription callbacks
    for (const config of configs) {
      const configId = config._id
      const prevOp = pendingOperations.get(configId) ?? Promise.resolve()
      const newOp = prevOp
        .catch(() => {}) // Ignore errors from previous operation
        .then(async () => {
          await processSyncConfig(config, configDb, log)
        })
        .catch((error: unknown) => {
          log(`Error processing config ${configId}:`, error)
        })
        .finally(() => {
          if (pendingOperations.get(configId) === newOp) {
            pendingOperations.delete(configId)
          }
        })

      pendingOperations.set(configId, newOp)
      await newOp
    }

    // Setup/refresh CouchDB subscriptions
    const subscriptionManager = getSubscriptionManager()
    await initializeSubscriptions(
      subscriptionManager,
      configs,
      async (configId: string, docId: string) => {
        // Serialize operations per config to prevent concurrent git operations
        const prevOp = pendingOperations.get(configId) ?? Promise.resolve()
        const newOp = prevOp
          .catch(() => {}) // Ignore errors from previous operation
          .then(async () => {
            const config = configs.find(c => c._id === configId)
            if (config == null) return

            const gitRepo = await setupGitRepo(config, log)
            await handleCouchChange(configDb, config, docId, gitRepo, log)
          })
          .catch((error: unknown) => {
            log(`Error handling change for ${configId}/${docId}:`, error)
          })
          .finally(() => {
            // Clean up if this is still the current operation
            if (pendingOperations.get(configId) === newOp) {
              pendingOperations.delete(configId)
            }
          })

        pendingOperations.set(configId, newOp)
        await newOp
      },
      log
    )

    log('Completed syncGitCouch engine run')
  } catch (error: unknown) {
    log('Error in syncGitCouch engine:', error)
    throw error
  }
}

/**
 * Setup and initialize a git repo for a config
 */
async function setupGitRepo(
  config: SyncConfigDoc,
  log: LogFunction
): Promise<GitRepo> {
  log(`Setting up git repo for ${config._id}`)

  // Create git repo instance
  const gitRepo = makeRepo(config.gitRepo, log)

  // Initialize git repo (uses existing clone if available on disk)
  try {
    await gitRepo.init(config._id)
  } catch (error: unknown) {
    log.error(`Failed to initialize git repo for ${config._id}:`, error)
    throw error
  }

  // Reset to latest remote changes
  try {
    await gitRepo.resetToRemote()
  } catch (error: unknown) {
    log.error(`Failed to reset repo for ${config._id}:`, error)
    throw error
  }

  return gitRepo
}

/**
 * Process a single sync configuration
 */
async function processSyncConfig(
  config: SyncConfigDoc,
  configDb: ConfigDb,
  log: LogFunction
): Promise<void> {
  const gitRepo = await setupGitRepo(config, log)

  // Process all sync files
  await processConfig(configDb, config, gitRepo, log)
}

/**
 * Cleanup function (called on shutdown if needed)
 * Note: We don't delete the git repo directories on disk - they persist for reuse
 */
export async function cleanup(log: LogFunction): Promise<void> {
  // Close subscriptions
  const subscriptionManager = getSubscriptionManager()
  closeSubscriptions(subscriptionManager, log)
}

/**
 * Export the bot configuration
 */
export const syncGitCouchBot: Autobot = {
  botId: 'syncGitCouch',
  engines: [
    {
      engine: syncGitCouchEngine,
      frequency: 'minute'
    }
  ]
}
