import express from 'express'
import path from 'path'
import { config } from '../config'

async function main(): Promise<void> {
  console.log('Starting API Server (Frontend Only)...')

  const app = express()

  // Middleware
  app.use(express.json())

  // Health check endpoint (kept for monitoring)
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // Info endpoint about configuration
  app.get('/api/info', (req, res) => {
    res.json({
      message: 'Configure email forwarding directly in CouchDB',
      couchDbUrl:
        'http://localhost:5984/_utils/#database/autobot_emailforwards',
      engineStatus: 'Running independently'
    })
  })

  // Serve static files from the React app
  app.use(express.static(path.join(__dirname, '../../dist')))

  // Handle client-side routing - serve React app for all other routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../dist/index.html'))
  })

  // Start server
  app.listen(config.httpPort, async () => {
    console.log(`API server running at http://localhost:${config.httpPort}`)
    console.log('Frontend available at: http://localhost:8008')
    console.log('Configure email forwarding directly in CouchDB:')
    console.log('http://localhost:5984/_utils/#database/autobot_emailforwards')
  })

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down API server...')
    process.exit(0)
  })
}

main().catch((e) => {
  console.error('API server error:', e)
  process.exit(1)
})
