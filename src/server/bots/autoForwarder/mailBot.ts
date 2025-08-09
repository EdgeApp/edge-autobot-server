import type { Autobot, AutobotEngineArgs } from '../../types'
import { createCouchConnection, getAllImapConfigs } from './databaseService'
import {
  createImapConnection,
  createSmtpTransporter,
  processEmailForwarding
} from './emailForwardingService'

export async function mailBotEngine({ log }: AutobotEngineArgs): Promise<void> {
  const db = createCouchConnection()

  log('Processing all email configurations...')
  const configs = await getAllImapConfigs(db)

  log(`Found ${configs.length} email configurations to process`)

  // Process each email configuration
  for (const imapConfig of configs) {
    const { email } = imapConfig
    try {
      log(`Processing email: ${email}`)

      // Create fresh connections for each email
      const imap = createImapConnection(imapConfig, log)
      const smtp = createSmtpTransporter(imapConfig)

      // Process this email's forwarding
      await processEmailForwarding(imap, smtp, imapConfig, db, log)

      // Close connections
      imap.end()

      log(`Completed processing for: ${email}`)
    } catch (error: unknown) {
      log(`Error processing email ${email}:`, error)
      // Continue with next email even if one fails
    }
  }

  log('Completed processing all emails')
}

export const mailBot: Autobot = {
  botId: 'mailForwarder',
  engines: [
    {
      engine: mailBotEngine,
      frequency: 'minute'
    }
  ]
}
