#!/usr/bin/env node

/**
 * IMAP Setup Helper Script
 *
 * This script helps you set up IMAP credentials for the email forwarding service.
 *
 * Prerequisites:
 * 1. Enable IMAP in your Gmail account settings
 * 2. Generate an App Password for your Gmail account
 */

import * as readline from 'readline'

interface ImapConfig {
  email: string
  password: string
  host: string
  port: number
  tls: string
  forwardRules: Array<{
    subjectSearch: string
    destinationEmail: string
  }>
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

console.log('=== IMAP Setup Helper ===\n')

console.log(
  'This script will help you create an IMAP configuration for the email forwarding service.\n'
)

console.log('Prerequisites:')
console.log('1. Enable IMAP in your Gmail account:')
console.log('   - Go to Gmail Settings > Forwarding and POP/IMAP')
console.log('   - Enable IMAP')
console.log('2. Generate an App Password:')
console.log('   - Go to Google Account Settings > Security')
console.log('   - Enable 2-Step Verification if not already enabled')
console.log('   - Go to App Passwords')
console.log('   - Generate a new app password for "Mail"\n')

rl.question(
  'Do you have IMAP enabled and an App Password ready? (y/n): ',
  answer => {
    if (answer.toLowerCase() !== 'y') {
      console.log(
        '\nPlease complete the prerequisites first, then run this script again.'
      )
      rl.close()
      return
    }

    rl.question('Enter your Gmail address: ', emailAddress => {
      rl.question(
        'Enter your App Password (not your regular Gmail password): ',
        password => {
          const config: ImapConfig = {
            email: emailAddress,
            password: password,
            host: 'imap.gmail.com',
            port: 993,
            tls: 'implicit',
            forwardRules: []
          }

          console.log('\n=== Configuration Generated ===')
          console.log(`Email Address: ${emailAddress}`)
          console.log('Configuration:')
          console.log(JSON.stringify(config, null, 2))

          console.log('\n=== Next Steps ===')
          console.log('1. Start the server: yarn start.dev')
          console.log('2. Create the configuration using the API:')
          console.log(
            `   curl -X POST http://localhost:8008/api/configs/${emailAddress} \\`
          )
          console.log('        -H "Content-Type: application/json" \\')
          console.log(`        -d '${JSON.stringify(config)}'`)
          console.log('\n3. Add forwarding rules using the API:')
          console.log(
            `   curl -X PUT http://localhost:8008/api/configs/${emailAddress}/rules \\`
          )
          console.log('        -H "Content-Type: application/json" \\')
          console.log(
            '        -d \'{"forwardRules":[{"subjectSearch":"urgent","destinationEmail":"your@email.com"}]}\''
          )

          rl.close()
        }
      )
    })
  }
)
