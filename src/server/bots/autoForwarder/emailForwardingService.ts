import type nano from 'nano'
import type Imap from 'node-imap'
import type nodemailer from 'nodemailer'

import type { ImapConfig, ImapConfigDoc } from '../../../common/types'
import {
  formatEmailBody,
  isValidEmail,
  matchesSubject
} from '../../../common/utils'
import { getEmailStatus, saveEmailStatus } from './databaseService'
import { getMessage, listRecentMessages, sendEmail } from './imapService'

// Export the connection functions for use in the master loop
export { createImapConnection, createSmtpTransporter } from './imapService'

// Process email forwarding for a single email configuration
export const processEmailForwarding = async (
  imap: Imap,
  smtp: nodemailer.Transporter,
  config: ImapConfig,
  db: nano.DocumentScope<ImapConfigDoc>,
  log: (...args: unknown[]) => void
): Promise<void> => {
  try {
    // Connect to IMAP
    await new Promise<void>((resolve, reject) => {
      imap.once('ready', () => {
        log(`IMAP connection ready for ${config.email}`)
        resolve()
      })
      imap.once('error', reject)
      imap.connect()
    })

    // Get recent messages (only the 30 most recent)
    const messageIds = await listRecentMessages(imap)

    // Get the last read timestamp
    const emailStatus = await getEmailStatus(db, config.email)
    const lastReadDate =
      emailStatus != null ? new Date(emailStatus.lastRead) : new Date(0)
    let latestProcessedDate = lastReadDate

    for (const messageId of messageIds) {
      try {
        const message = await getMessage(imap, messageId)
        const messageDate = new Date(message.date)

        // Skip messages that are older than or equal to the last read timestamp
        if (messageDate <= lastReadDate) {
          continue
        }

        log(`Processing message: ${message.subject} (${message.date})`)

        // Check if subject matches any forwarding rules
        for (const rule of config.forwardRules) {
          if (matchesSubject(message.subject, rule.subjectSearch)) {
            log(`Subject matches rule: ${rule.subjectSearch}`)

            // Validate destination email
            if (!isValidEmail(rule.destinationEmail)) {
              log(`Invalid destination email: ${rule.destinationEmail}`)
              continue
            }

            // Format email body
            const formattedBody = formatEmailBody(
              message.body,
              message.from,
              message.subject
            )

            // Send forwarded email
            await sendEmail(
              smtp,
              config.email,
              rule.destinationEmail,
              `FWD: ${message.subject}`,
              formattedBody
            )

            log(`Email forwarded to: ${rule.destinationEmail}`)
          }
        }

        // Track the latest processed date
        if (messageDate > latestProcessedDate) {
          latestProcessedDate = messageDate
        }
      } catch (error: unknown) {
        log(`Error processing message ${messageId}:`, error)
      }
    }

    // Update the last read timestamp if we processed any new messages
    if (latestProcessedDate > lastReadDate) {
      await saveEmailStatus(db, config.email, {
        lastRead: latestProcessedDate.toISOString()
      })
      log(
        `Updated last read timestamp to: ${latestProcessedDate.toISOString()}`
      )
    }
  } catch (error: unknown) {
    log(`Error processing email forwarding for ${config.email}:`, error)
    throw error
  }
}
