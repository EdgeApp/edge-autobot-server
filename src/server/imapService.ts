import Imap from 'node-imap'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import { ImapConfig, EmailMessage } from '../common/types'

// Create IMAP connection
export const createImapConnection = (config: ImapConfig): Imap => {
  return new Imap({
    user: config.email,
    password: config.password,
    host: config.host,
    port: config.port,
    tls: config.tls === 'implicit',
    tlsOptions: { servername: config.host },
    connTimeout: 60000,
    authTimeout: 5000,
    debug: console.log
  })
}

// Create SMTP transporter for sending emails
export const createSmtpTransporter = (config: ImapConfig) => {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: config.email,
      pass: config.password
    }
  })
}

// List recent messages (last 30, regardless of read status)
export const listRecentMessages = (imap: Imap): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    imap.openBox('INBOX', false, (err, box) => {
      if (err) {
        reject(err)
        return
      }

      // Get total number of messages
      const totalMessages = box.messages.total
      if (totalMessages === 0) {
        resolve([])
        return
      }

      // Calculate range for last 30 messages
      const start = Math.max(1, totalMessages - 29) // IMAP uses 1-based indexing
      const end = totalMessages

      // Search for messages in the range
      imap.search([`${start}:${end}`], (err, results) => {
        if (err) {
          reject(err)
          return
        }

        resolve(results.map((id) => id.toString()))
      })
    })
  })
}

// Get message content
export const getMessage = (
  imap: Imap,
  messageId: string
): Promise<EmailMessage> => {
  return new Promise((resolve, reject) => {
    const fetch = imap.fetch(messageId, { bodies: '' })

    fetch.on('message', (msg, seqno) => {
      msg.on('body', (stream, info) => {
        simpleParser(stream as any, (err: any, parsed: any) => {
          if (err) {
            reject(err)
            return
          }

          const emailMessage: EmailMessage = {
            id: messageId,
            subject: parsed.subject || '',
            from: parsed.from?.text || '',
            to: Array.isArray(parsed.to)
              ? parsed.to[0]?.text || ''
              : parsed.to?.text || '',
            body: parsed.text || '',
            date: parsed.date?.toISOString() || new Date().toISOString()
          }

          resolve(emailMessage)
        })
      })
    })

    fetch.on('error', reject)
  })
}

// Send email
export const sendEmail = async (
  transporter: nodemailer.Transporter,
  from: string,
  to: string,
  subject: string,
  body: string
): Promise<void> => {
  const mailOptions = {
    from,
    to,
    subject,
    text: body
  }

  await transporter.sendMail(mailOptions)
}

// Mark message as read
export const markAsRead = (imap: Imap, messageId: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    imap.addFlags(messageId, ['\\Seen'], (err) => {
      if (err) {
        reject(err)
        return
      }
      resolve()
    })
  })
}
