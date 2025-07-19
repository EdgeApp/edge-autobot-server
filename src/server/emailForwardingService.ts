import {
  createImapConnection,
  createSmtpTransporter,
  listRecentMessages,
  getMessage,
  sendEmail
} from './imapService'
import { ImapConfig, EmailForwardRule } from '../common/types'
import {
  matchesSubject,
  formatEmailBody,
  isValidEmail,
  snooze
} from '../common/utils'
import { getEmailStatus, saveEmailStatus } from './databaseService'

// State management for email forwarding service
interface ForwardingServiceState {
  imap: any
  smtp: any
  config: ImapConfig
  db: any
  isRunning: boolean
}

// Create email forwarding service state
export const createForwardingService = (
  config: ImapConfig,
  db: any
): ForwardingServiceState => {
  return {
    imap: createImapConnection(config),
    smtp: createSmtpTransporter(config),
    config,
    db,
    isRunning: false
  }
}

// Start the email forwarding service
export const startForwardingService = async (
  state: ForwardingServiceState
): Promise<void> => {
  if (state.isRunning) {
    console.log('Email forwarding service is already running')
    return
  }

  state.isRunning = true
  console.log('Starting email forwarding service...')

  while (state.isRunning) {
    try {
      // Connect to IMAP
      await new Promise<void>((resolve, reject) => {
        state.imap.once('ready', () => {
          console.log('IMAP connection ready')
          resolve()
        })
        state.imap.once('error', reject)
        state.imap.connect()
      })

      // Get recent messages
      const messageIds = await listRecentMessages(state.imap)

      // Get the last read timestamp
      const emailStatus = await getEmailStatus(state.db, state.config.email)
      const lastReadDate = emailStatus
        ? new Date(emailStatus.lastRead)
        : new Date(0)
      let latestProcessedDate = lastReadDate

      for (const messageId of messageIds) {
        try {
          const message = await getMessage(state.imap, messageId)
          const messageDate = new Date(message.date)

          // Skip messages that are older than or equal to the last read timestamp
          if (messageDate <= lastReadDate) {
            continue
          }

          console.log(
            `Processing message: ${message.subject} (${message.date})`
          )

          // Check if subject matches any forwarding rules
          for (const rule of state.config.forwardRules) {
            if (matchesSubject(message.subject, rule.subjectSearch)) {
              console.log(`Subject matches rule: ${rule.subjectSearch}`)

              // Validate destination email
              if (!isValidEmail(rule.destinationEmail)) {
                console.error(
                  `Invalid destination email: ${rule.destinationEmail}`
                )
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
                state.smtp,
                state.config.email,
                rule.destinationEmail,
                `FWD: ${message.subject}`,
                formattedBody
              )

              console.log(`Email forwarded to: ${rule.destinationEmail}`)
            }
          }

          // Track the latest processed date
          if (messageDate > latestProcessedDate) {
            latestProcessedDate = messageDate
          }
        } catch (error) {
          console.error(`Error processing message ${messageId}:`, error)
        }
      }

      // Update the last read timestamp if we processed any new messages
      if (latestProcessedDate > lastReadDate) {
        await saveEmailStatus(state.db, state.config.email, {
          lastRead: latestProcessedDate.toISOString()
        })
        console.log(
          `Updated last read timestamp to: ${latestProcessedDate.toISOString()}`
        )
      }

      // Disconnect from IMAP
      state.imap.end()

      await snooze(30000) // Check every 30 seconds
    } catch (error) {
      console.error('Error in email forwarding loop:', error)
      await snooze(60000) // Wait 1 minute on error
    }
  }
}

// Stop the email forwarding service
export const stopForwardingService = (state: ForwardingServiceState): void => {
  state.isRunning = false
  if (state.imap) {
    state.imap.end()
  }
  console.log('Email forwarding service stopped')
}

// Add a forward rule
export const addForwardRule = async (
  state: ForwardingServiceState,
  rule: EmailForwardRule
): Promise<void> => {
  if (!isValidEmail(rule.destinationEmail)) {
    throw new Error(`Invalid destination email: ${rule.destinationEmail}`)
  }

  state.config.forwardRules.push(rule)
  console.log(
    `Added forward rule: ${rule.subjectSearch} -> ${rule.destinationEmail}`
  )
}

// Remove a forward rule by index
export const removeForwardRule = async (
  state: ForwardingServiceState,
  index: number
): Promise<void> => {
  if (index < 0 || index >= state.config.forwardRules.length) {
    throw new Error(`Invalid rule index: ${index}`)
  }

  const removedRule = state.config.forwardRules.splice(index, 1)[0]
  console.log(
    `Removed forward rule: ${removedRule.subjectSearch} -> ${removedRule.destinationEmail}`
  )
}

// Get all forward rules
export const getForwardRules = (
  state: ForwardingServiceState
): EmailForwardRule[] => {
  return [...state.config.forwardRules]
}

// Update all forward rules
export const updateForwardRules = (
  state: ForwardingServiceState,
  rules: EmailForwardRule[]
): void => {
  // Validate all destination emails
  for (const rule of rules) {
    if (!isValidEmail(rule.destinationEmail)) {
      throw new Error(`Invalid destination email: ${rule.destinationEmail}`)
    }
  }

  state.config.forwardRules = [...rules]
  console.log(`Updated forward rules: ${rules.length} rules`)
}
