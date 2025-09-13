# Edge Autobot Server

A Gmail email forwarding server that automatically forwards emails based on subject line matches using IMAP.

## Features

- Monitor Gmail accounts via IMAP
- Forward emails based on subject line patterns
- Multiple forwarding rules per email address
- REST API for configuration management
- React frontend for easy management
- Background processing with automatic retry logic
- Graceful shutdown handling

## Prerequisites

- Node.js 18+
- CouchDB running locally or remotely
- Gmail account with IMAP enabled and App Password

## Setup

### 1. Install Dependencies

```bash
yarn install
```

### 2. Setup Database

Ensure CouchDB is running, then initialize the database and indexes:

```bash
# Start CouchDB (if not already running)
# On macOS: brew services start couchdb
# On Ubuntu: sudo systemctl start couchdb

# Initialize database, indexes, and create default test document
yarn setup
```

### 3. Gmail IMAP Setup

1. **Enable IMAP in Gmail**:
   - Go to Gmail Settings > Forwarding and POP/IMAP
   - Enable IMAP

2. **Generate App Password**:
   - Go to Google Account Settings > Security
   - Enable 2-Step Verification if not already enabled
   - Go to App Passwords
   - Generate a new app password for "Mail"

### 4. Configuration

The server uses a `serverConfig.json` file for CouchDB connection:

```json
{
  "couchDbFullpath": "http://admin:admin@127.0.0.1:5984"
}
```

## Usage

### Start the Services

You can run the services in different ways:

#### Development Mode (Frontend Server)
```bash
yarn start.dev
```
This starts the frontend server on `http://localhost:8008`

#### Background Email Forwarding Service
```bash
yarn start
```
This runs only the background email forwarding service (no UI)

#### Frontend Server Only
```bash
yarn start.api
```
This serves the React frontend on `http://localhost:8008`

#### Production with PM2
```bash
# Build the project
yarn build

# Start both services with PM2
pm2 start pm2.json

# Check status
pm2 status

# View logs
pm2 logs autobotEngine
pm2 logs autobotApi
```

### Setup Gmail IMAP

For guided IMAP setup, run:

```bash
yarn setup.gmail
```

The server runs on port 8008 by default.

### Configuration

**Email forwarding is configured directly in CouchDB** - no API endpoints are needed for configuration management.

#### Web Interface
The server provides a web interface at `http://localhost:8008` for monitoring, but configuration must be done directly in CouchDB.

#### Available Endpoints

**Health Check**
```bash
GET /health
```

**Configuration Info**
```bash
GET /api/info
```

#### CouchDB Configuration

Configure email forwarding by creating documents directly in CouchDB:

1. Open CouchDB Admin: `http://localhost:5984/_utils/#database/autobot_emailforwards`
2. Create a new document with the email address as the document ID
3. Use the document structure shown below

## Database Schema

Each document in the `autobot_emailforwards` database represents an email account configuration:

- **Document ID**: The email address being monitored
- **Document Content**:
  - `email`: Email address
  - `password`: App Password (not regular email password)
  - `host`: IMAP server (default: imap.gmail.com)
  - `port`: IMAP port (default: 993)
  - `tls`: TLS mode (default: implicit)
  - `forwardRules`: Array of forwarding rules

### Default Test Document

When you run `yarn setup`, a default test document is created with ID `test@example.com` containing sample configuration and forwarding rules. You can use this as a template or delete it after creating your own configurations.

### Forward Rule Structure
```json
{
  "subjectSearch": "string to search for in subject",
  "destinationEmail": "email@address.com"
}
```

## How It Works

The system uses a simple master loop architecture:

1. **Master Loop**: A single background process runs continuously, checking all configured email accounts every 60 seconds
2. **Configuration Loading**: The engine loads all IMAP configurations from CouchDB on each cycle
3. **Email Processing**: For each email account:
   - Connects to the email server via IMAP
   - Retrieves recent messages
   - Checks if any subject lines match the configured forwarding rules
   - Forwards matching emails via SMTP
   - Tracks the last processed timestamp to avoid reprocessing
4. **API Server**: A separate API server handles configuration management and serves the web UI independently

## Error Handling

- Invalid email addresses are logged and skipped
- IMAP connection errors trigger automatic retries
- Database connection issues are handled gracefully
- Services restart automatically on configuration updates

## Security Considerations

- Use App Passwords instead of regular Gmail passwords
- Store credentials securely in CouchDB
- Use HTTPS in production
- Regularly rotate App Passwords
- Validate all input data

## Development

```bash
# Lint code
yarn lint

# Fix linting issues
yarn fix

# Clean build artifacts
yarn clean
```

## License

MIT
