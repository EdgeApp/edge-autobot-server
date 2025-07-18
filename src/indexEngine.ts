import {
  createForwardingService,
  startForwardingService,
  stopForwardingService
} from './server/emailForwardingService'
import {
  createCouchConnection,
  getAllImapConfigs
} from './server/databaseService'

async function main(): Promise<void> {
  console.log('Starting IMAP Email Forwarding Engine...')

  const db = createCouchConnection()
  const forwardingServices: Map<string, any> = new Map()

  // Initialize forwarding services for all existing configs
  async function initializeForwardingServices(): Promise<void> {
    try {
      const configs = await getAllImapConfigs(db)

      for (const { emailAddress, config: imapConfig } of configs) {
        const forwardingServiceState = createForwardingService(imapConfig)
        forwardingServices.set(emailAddress, forwardingServiceState)

        // Start the forwarding service
        startForwardingService(forwardingServiceState).catch((error) => {
          console.error(
            `Error starting forwarding service for ${emailAddress}:`,
            error
          )
        })
      }

      console.log(`Initialized ${forwardingServices.size} forwarding services`)
    } catch (error) {
      console.error('Error initializing forwarding services:', error)
    }
  }

  await initializeForwardingServices()
  console.log('Email forwarding engine is running...')

  // Main loop - check for emails every minute
  setInterval(async () => {
    try {
      console.log('Checking for new email configurations...')
      const configs = await getAllImapConfigs(db)

      // Get current email addresses
      const currentEmails = new Set(forwardingServices.keys())
      const newEmails = new Set(configs.map((c) => c.emailAddress))

      // Stop services for emails that no longer exist
      for (const emailAddress of Array.from(currentEmails)) {
        if (!newEmails.has(emailAddress)) {
          console.log(`Removing forwarding service for ${emailAddress}`)
          const serviceState = forwardingServices.get(emailAddress)
          stopForwardingService(serviceState)
          forwardingServices.delete(emailAddress)
        }
      }

      // Start services for new emails
      for (const { emailAddress, config: imapConfig } of configs) {
        if (!currentEmails.has(emailAddress)) {
          console.log(`Starting forwarding service for ${emailAddress}`)
          const forwardingServiceState = createForwardingService(imapConfig)
          forwardingServices.set(emailAddress, forwardingServiceState)

          startForwardingService(forwardingServiceState).catch((error) => {
            console.error(
              `Error starting forwarding service for ${emailAddress}:`,
              error
            )
          })
        }
      }

      console.log(`Active forwarding services: ${forwardingServices.size}`)
    } catch (error) {
      console.error('Error in main loop:', error)
    }
  }, 60000) // Check every 60 seconds

  process.on('SIGINT', async () => {
    console.log('Shutting down email forwarding engine...')
    for (const [emailAddress, serviceState] of Array.from(
      forwardingServices.entries()
    )) {
      console.log(`Stopping forwarding service for ${emailAddress}`)
      stopForwardingService(serviceState)
    }
    process.exit(0)
  })
}

main().catch((e) => {
  console.error('Email forwarding engine error:', e)
  process.exit(1)
})
