import {
  asArray,
  asBoolean,
  asNumber,
  asObject,
  asOptional,
  asString
} from 'cleaners'

export const asEmailForwardRule = asObject({
  subjectSearch: asString,
  destinationEmail: asString
})

export const asImapConfig = asObject({
  email: asString,
  password: asString,
  active: asOptional(asBoolean, false),
  host: asOptional(asString, 'imap.gmail.com'),
  port: asOptional(asNumber, 993),
  tls: asOptional(asString, 'implicit'),
  forwardRules: asArray(asEmailForwardRule)
})

export const asEmailStatus = asObject({
  lastRead: asString
})

export type EmailForwardRule = ReturnType<typeof asEmailForwardRule>
export type ImapConfig = ReturnType<typeof asImapConfig>
export type EmailStatus = ReturnType<typeof asEmailStatus>

export interface ImapConfigDoc extends ImapConfig {
  _id: string
  _rev?: string
}

export interface EmailStatusDoc extends EmailStatus {
  _id: string
  _rev?: string
}

export interface EmailMessage {
  id: string
  subject: string
  from: string
  to: string
  body: string
  date: string
}
