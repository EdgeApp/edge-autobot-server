import type { DocumentScope } from 'nano'

import type { LogFunction } from '../../types'
import {
  createTargetDbConnection,
  getCouchDoc,
  getStatusDoc,
  updateCouchDoc,
  updateDocStatus
} from './databaseService'
import type { GitRepo } from './gitService'
import {
  asGitDocContent,
  type ConfigDb,
  type CouchDoc,
  type SyncConfigDoc
} from './types'

/**
 * Sync a single file between git and CouchDB
 */
export async function syncFile(
  configDb: ConfigDb,
  config: SyncConfigDoc,
  couchDoc: string,
  gitRepo: GitRepo,
  log: LogFunction
): Promise<void> {
  const gitFilePath = `${config.couchDb}/${couchDoc}.json`

  log(`Syncing ${config._id}:${gitFilePath}`)

  // Get target CouchDB connection
  const targetDb = createTargetDbConnection(config.couchUrl, config.couchDb)

  // Get current status
  const statusDoc = await getStatusDoc(configDb, config._id, log)
  const docStatus = statusDoc?.docStatus?.[couchDoc]

  // Get current state
  const gitContent = await gitRepo.readFile(gitFilePath)
  const couchDocData = await getCouchDoc(targetDb, couchDoc)

  // Handle initialization
  if (gitContent == null && couchDocData == null) {
    log(`Neither git nor couch exists for ${couchDoc}, skipping`)
    return
  }

  let syncFrom: 'git' | 'couch' | null = null

  if (gitContent == null && couchDocData != null) {
    log(`Git file doesn't exist, initializing from CouchDB for ${couchDoc}`)
    syncFrom = 'couch'
  } else if (gitContent != null && couchDocData == null) {
    log(`CouchDB doc doesn't exist, initializing from git for ${couchDoc}`)
    syncFrom = 'git'
  } else if (couchDocData != null && gitContent != null) {
    // Both exist - check for changes
    const currentGitHash = await gitRepo.getLastCommitHash(gitFilePath)
    const currentCouchRev = couchDocData._rev ?? ''

    const gitChanged = docStatus?.gitHash !== currentGitHash
    const couchChanged = docStatus?.couchRev !== currentCouchRev

    if (!gitChanged && !couchChanged) {
      log(`No changes for ${couchDoc}`)
      return
    }

    if (gitChanged && couchChanged) {
      log(`Both changed for ${couchDoc}, preferring CouchDB`)
      syncFrom = 'couch'
    } else if (couchChanged) {
      log(`CouchDB changed for ${couchDoc}, syncing to git`)
      syncFrom = 'couch'
    } else if (gitChanged) {
      log(`Git changed for ${couchDoc}, syncing to CouchDB`)
      syncFrom = 'git'
    }
  }

  // Perform the sync based on determined direction
  if (syncFrom === 'couch') {
    await syncCouchToGit(
      configDb,
      config,
      couchDoc,
      gitFilePath,
      couchDocData!,
      gitRepo,
      log
    )
  } else if (syncFrom === 'git') {
    await syncGitToCouch(
      configDb,
      config,
      couchDoc,
      gitFilePath,
      gitContent!,
      targetDb,
      gitRepo,
      log
    )
  }
}

/**
 * Sync from CouchDB to Git
 */
async function syncCouchToGit(
  configDb: ConfigDb,
  config: SyncConfigDoc,
  couchDoc: string,
  gitFilePath: string,
  couchDocData: CouchDoc,
  gitRepo: GitRepo,
  log: LogFunction
): Promise<void> {
  try {
    // Remove _rev before saving to git
    const { _rev, ...docWithoutRev } = couchDocData
    const jsonContent = JSON.stringify(docWithoutRev, null, 2) + '\n'

    // Commit and push with retry on conflicts
    const commitMessage = `Sync ${couchDoc} from CouchDB (rev: ${_rev ?? 'unknown'})`
    const NUM_RETRIES = 2

    for (let attempt = 0; attempt <= NUM_RETRIES; attempt++) {
      // Write to git (fresh each attempt in case of resets)
      await gitRepo.writeFile(gitFilePath, jsonContent)

      try {
        await gitRepo.commitAndPush(gitFilePath, commitMessage)
        break // Success, exit retry loop
      } catch (error: unknown) {
        const isPushConflict =
          error != null &&
          typeof error === 'object' &&
          'message' in error &&
          typeof error.message === 'string' &&
          error.message.includes('Push conflict')

        if (isPushConflict && attempt < NUM_RETRIES) {
          log(
            `Retrying after conflict for ${couchDoc} (attempt ${attempt + 1}/${NUM_RETRIES + 1})`
          )
        } else {
          throw error
        }
      }
    }

    // Update status with new commit hash
    const newGitHash = (await gitRepo.getLastCommitHash(gitFilePath)) ?? ''
    await updateDocStatus(
      configDb,
      config._id,
      couchDoc,
      newGitHash,
      _rev ?? '',
      log
    )

    log(`Successfully synced ${couchDoc} from CouchDB to git`)
  } catch (error: unknown) {
    log(`Error syncing ${couchDoc} from CouchDB to git:`, error)
    throw error
  }
}

/**
 * Sync from Git to CouchDB
 */
async function syncGitToCouch(
  configDb: ConfigDb,
  config: SyncConfigDoc,
  couchDoc: string,
  gitFilePath: string,
  gitContent: string,
  targetDb: DocumentScope<CouchDoc>,
  gitRepo: GitRepo,
  log: LogFunction
): Promise<void> {
  try {
    // Parse git content with cleaner validation
    const parsedData = asGitDocContent(JSON.parse(gitContent))

    // Handle _id: set if missing, validate if present
    if (parsedData._id == null) {
      parsedData._id = couchDoc
    } else if (parsedData._id !== couchDoc) {
      throw new Error(
        `Git file _id '${parsedData._id}' does not match expected document ID '${couchDoc}'`
      )
    }

    // Now _id is guaranteed to be set
    const docData: CouchDoc = { ...parsedData, _id: parsedData._id }

    // Get current _rev from CouchDB
    const currentDoc = await getCouchDoc(targetDb, couchDoc)
    if (currentDoc?._rev != null) {
      docData._rev = currentDoc._rev
    }

    // Update CouchDB
    let newRev: string
    try {
      newRev = await updateCouchDoc(targetDb, docData)
    } catch (error: unknown) {
      // Handle CouchDB conflict
      if (
        error != null &&
        typeof error === 'object' &&
        'statusCode' in error &&
        error.statusCode === 409
      ) {
        log(
          `CouchDB conflict for ${couchDoc}, fetching latest and syncing back`
        )
        const latestDoc = await getCouchDoc(targetDb, couchDoc)
        if (latestDoc != null) {
          // Sync the latest CouchDB doc back to git
          await syncCouchToGit(
            configDb,
            config,
            couchDoc,
            gitFilePath,
            latestDoc,
            gitRepo,
            log
          )

          log(`Resolved conflict for ${couchDoc} by preferring CouchDB`)
          return
        }
      }
      throw error
    }

    // Update status with current commit hash
    const gitHash = (await gitRepo.getLastCommitHash(gitFilePath)) ?? ''
    await updateDocStatus(configDb, config._id, couchDoc, gitHash, newRev, log)

    log(`Successfully synced ${couchDoc} from git to CouchDB`)
  } catch (error: unknown) {
    log(`Error syncing ${couchDoc} from git to CouchDB:`, error)
    throw error
  }
}

/**
 * Process all sync files for a config
 */
export async function processConfig(
  configDb: ConfigDb,
  config: SyncConfigDoc,
  gitRepo: GitRepo,
  log: LogFunction
): Promise<void> {
  log(`Processing config: ${config._id}`)

  // Sync each doc independently
  for (const couchDoc of config.syncDocs) {
    try {
      await syncFile(configDb, config, couchDoc, gitRepo, log)
    } catch (error: unknown) {
      log(`Failed to sync ${couchDoc}:`, error)
      // Continue with other docs
    }
  }
}

/**
 * Handle a change event from CouchDB subscription
 */
export async function handleCouchChange(
  configDb: ConfigDb,
  config: SyncConfigDoc,
  docId: string,
  gitRepo: GitRepo,
  log: LogFunction
): Promise<void> {
  // Check if this document should be synced
  if (!config.syncDocs.includes(docId)) {
    log(`No sync config found for ${docId}`)
    return
  }

  log(`Handling CouchDB change for ${config._id}/${docId}`)
  await syncFile(configDb, config, docId, gitRepo, log)
}
