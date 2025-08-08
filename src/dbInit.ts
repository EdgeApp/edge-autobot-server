import {
  connectCouch,
  type DatabaseSetup,
  makeMangoIndex,
  setupDatabase,
  type SetupDatabaseOptions
} from 'edge-server-tools'

import { config } from './config'

// Create indexes and default documents for email configurations
const emailConfigIndexes = {
  '_design/email': makeMangoIndex('email', ['_id'], {
    partitioned: false
  }),
  '_design/forwardRules': makeMangoIndex('forwardRules', ['forwardRules'], {
    partitioned: false
  }),
  // Default test document
  'test@example.com': {
    _id: 'test@example.com',
    active: false, // Set this to true for real entries
    email: 'test@example.com',
    password: 'password',
    host: 'imap.gmail.com',
    port: 993,
    tls: 'implicit',
    forwardRules: [
      {
        subjectSearch: '__TEST__',
        destinationEmail: 'recipient@example.com'
      }
    ]
  }
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
    databases.map(async setup => await setupDatabase(pool, setup, options))
  )
  console.log('Done')
  process.exit(0)
}

initDbs().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
