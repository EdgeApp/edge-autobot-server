import {
  createImapConnection,
  createSmtpTransporter,
  listUnreadMessages,
  getMessage,
  sendEmail,
  markAsRead
} from './imapService'
import { ImapConfig, EmailForwardRule } from '../common/types'
import {
  matchesSubject,
  formatEmailBody,
  isValidEmail,
  snooze
} from '../common/utils'

// State management for email forwarding service
interface ForwardingServiceState {
  imap: any
  smtp: any
  config: ImapConfig
  processedMessages: Set<string>
  isRunning: boolean
}

// Create email forwarding service state
export const createForwardingService = (
  config: ImapConfig
): ForwardingServiceState => {
  return {
    imap: createImapConnection(config),
    smtp: createSmtpTransporter(config),
    config,
    processedMessages: new Set<string>(),
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

      // Get unread messages
      const messageIds = await listUnreadMessages(state.imap)

      for (const messageId of messageIds) {
        if (state.processedMessages.has(messageId)) {
          continue
        }

        try {
          const message = await getMessage(state.imap, messageId)
          console.log(`Processing message: ${message.subject}`)

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

          // Mark message as read
          await markAsRead(state.imap, messageId)
          state.processedMessages.add(messageId)
        } catch (error) {
          console.error(`Error processing message ${messageId}:`, error)
        }
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
