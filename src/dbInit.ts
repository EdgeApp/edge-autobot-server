import {
  connectCouch,
  DatabaseSetup,
  makeMangoIndex,
  setupDatabase,
  SetupDatabaseOptions
} from 'edge-server-tools'

import { config } from './config'

// Create indexes for email configurations using makeMangoIndex
const emailConfigIndexes = {
  '_design/email': makeMangoIndex('email', ['_id'], {
    partitioned: false
  }),
  '_design/forwardRules': makeMangoIndex('forwardRules', ['forwardRules'], {
    partitioned: false
  })
}

// Database setup configuration following edge-reports-server pattern
const emailForwardsDatabaseSetup: DatabaseSetup = {
  name: 'autobot_emailforwards',
  documents: emailConfigIndexes
}

const databases = [emailForwardsDatabaseSetup]

const options: SetupDatabaseOptions = {}

export async function initDbs(): Promise<void> {
  console.log('Using cluster configuration')
  const pool = connectCouch(config.couchMainCluster, config.couchUris)
  await Promise.all(
    databases.map(async (setup) => await setupDatabase(pool, setup, options))
  )
  console.log('Done')
  process.exit(0)
}

initDbs().catch((err) => {
  console.error(err)
  process.exit(1)
})
