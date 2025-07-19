import cors from 'cors'
import express from 'express'
import path from 'path'
import {
  createCouchConnection,
  getAllImapConfigs,
  getImapConfig,
  saveImapConfig,
  deleteImapConfig,
  updateForwardRules
} from './server/databaseService'
import {
  createForwardingService,
  startForwardingService,
  stopForwardingService,
  getForwardRules,
  addForwardRule,
  removeForwardRule
} from './server/emailForwardingService'
import { asImapConfig } from './common/types'
import { config } from './config'

async function main(): Promise<void> {
  console.log('Starting IMAP API Server...')

  const app = express()
  const db = createCouchConnection()
  const forwardingServices: Map<string, any> = new Map()

  // Middleware
  app.use(cors())
  app.use(express.json())

  // API Routes

  // Get all IMAP configurations
  app.get('/api/configs', async (req, res) => {
    try {
      const configs = await getAllImapConfigs(db)
      res.json(configs)
    } catch (error) {
      console.error('Error getting configs:', error)
      res.status(500).json({ error: 'Failed to fetch configurations' })
    }
  })

  // Get specific IMAP configuration
  app.get('/api/configs/:emailAddress', async (req, res) => {
    try {
      const { emailAddress } = req.params
      const imapConfig = await getImapConfig(db, emailAddress)

      if (!imapConfig) {
        return res.status(404).json({ error: 'Configuration not found' })
      }

      res.json(imapConfig)
    } catch (error) {
      console.error('Error getting config:', error)
      res.status(500).json({ error: 'Failed to fetch configuration' })
    }
  })

  // Create or update IMAP configuration
  app.post('/api/configs/:emailAddress', async (req, res) => {
    try {
      const { emailAddress } = req.params
      const imapConfig = asImapConfig(req.body)

      await saveImapConfig(db, emailAddress, imapConfig)

      // Stop existing service if running
      const existingService = forwardingServices.get(emailAddress)
      if (existingService) {
        stopForwardingService(existingService)
      }

      // Create and start new forwarding service
      const forwardingServiceState = createForwardingService(imapConfig, db)
      forwardingServices.set(emailAddress, forwardingServiceState)

      startForwardingService(forwardingServiceState).catch((error) => {
        console.error(
          `Error starting forwarding service for ${emailAddress}:`,
          error
        )
      })

      res.json({ message: 'Configuration saved successfully' })
    } catch (error) {
      console.error('Error saving config:', error)
      res.status(400).json({ error: 'Invalid configuration data' })
    }
  })

  // Delete IMAP configuration
  app.delete('/api/configs/:emailAddress', async (req, res) => {
    try {
      const { emailAddress } = req.params

      // Stop forwarding service
      const existingService = forwardingServices.get(emailAddress)
      if (existingService) {
        stopForwardingService(existingService)
        forwardingServices.delete(emailAddress)
      }

      await deleteImapConfig(db, emailAddress)
      res.json({ message: 'Configuration deleted successfully' })
    } catch (error) {
      console.error('Error deleting config:', error)
      res.status(500).json({ error: 'Failed to delete configuration' })
    }
  })

  // Update forward rules for a specific email
  app.put('/api/configs/:emailAddress/rules', async (req, res) => {
    try {
      const { emailAddress } = req.params
      const { forwardRules } = req.body

      await updateForwardRules(db, emailAddress, forwardRules)

      // Update the running service
      const existingService = forwardingServices.get(emailAddress)
      if (existingService) {
        // Clear existing rules and add new ones
        const currentRules = getForwardRules(existingService)
        for (let i = currentRules.length - 1; i >= 0; i--) {
          await removeForwardRule(existingService, i)
        }

        for (const rule of forwardRules) {
          await addForwardRule(existingService, rule)
        }
      }

      res.json({ message: 'Forward rules updated successfully' })
    } catch (error) {
      console.error('Error updating forward rules:', error)
      res.status(500).json({ error: 'Failed to update forward rules' })
    }
  })

  // Get status of forwarding services
  app.get('/api/status', (req, res) => {
    const status = {
      activeServices: forwardingServices.size,
      services: Array.from(forwardingServices.keys())
    }
    res.json(status)
  })

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // Serve static files from the React app
  app.use(express.static(path.join(__dirname, '../dist')))

  // Handle client-side routing
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'))
  })

  // Start server
  app.listen(config.httpPort, async () => {
    console.log(
      `IMAP API server running at http://localhost:${config.httpPort}`
    )
  })

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down API server...')

    // Stop all forwarding services
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
  console.error('API server error:', e)
  process.exit(1)
})
