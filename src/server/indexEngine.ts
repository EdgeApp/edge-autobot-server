import {
  processEmailForwarding,
  createImapConnection,
  createSmtpTransporter
} from './emailForwardingService'
import { createCouchConnection, getAllImapConfigs } from './databaseService'
import { logger } from '../common/utils'

async function main(): Promise<void> {
  console.log('Starting IMAP Email Forwarding Engine...')

  const db = createCouchConnection()

  // Master loop function that processes all emails
  async function processAllEmails(): Promise<void> {
    try {
      logger.mail('Processing all email configurations...')
      const configs = await getAllImapConfigs(db)

      logger.mail(`Found ${configs.length} email configurations to process`)

      // Process each email configuration
      for (const { emailAddress, config: imapConfig } of configs) {
        try {
          logger.mail(`Processing email: ${emailAddress}`)

          // Create fresh connections for each email
          const imap = createImapConnection(imapConfig)
          const smtp = createSmtpTransporter(imapConfig)

          // Process this email's forwarding
          await processEmailForwarding(imap, smtp, imapConfig, db)

          // Close connections
          imap.end()

          logger.mail(`Completed processing for: ${emailAddress}`)
        } catch (error: unknown) {
          logger.error(`Error processing email ${emailAddress}:`, error)
          // Continue with next email even if one fails
        }
      }

      logger.mail('Completed processing all emails')
    } catch (error: unknown) {
      logger.error('Error in master loop:', error)
    }
  }

  console.log('Email forwarding engine is running...')

  // Run immediately to process emails
  await processAllEmails()

  // Main loop - process all emails every 60 seconds
  setInterval(processAllEmails, 60000)

  process.on('SIGINT', async () => {
    console.log('Shutting down email forwarding engine...')
    process.exit(0)
  })
}

main().catch((e) => {
  console.error('Email forwarding engine error:', e)
  process.exit(1)
})
