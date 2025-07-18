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

# Initialize database and indexes
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

The server uses a `config.json` file for CouchDB connection:

```json
{
  "couchDbFullpath": "http://admin:admin@127.0.0.1:5984"
}
```

## Usage

### Start the Services

You can run the services in different ways:

#### Development Mode (API + Frontend)
```bash
yarn start.dev
```
This starts the API server with the React frontend on `http://localhost:8008`

#### Background Email Forwarding Service
```bash
yarn start
```
This runs only the background email forwarding service (no API/UI)

#### API Server Only
```bash
yarn start.api
```
This runs only the API server on `http://localhost:8008`

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

### API Endpoints

#### Get All Configurations
```bash
GET /api/configs
```

#### Get Specific Configuration
```bash
GET /api/configs/{emailAddress}
```

#### Create/Update Configuration
```bash
POST /api/configs/{emailAddress}
Content-Type: application/json

{
  "email": "your@gmail.com",
  "password": "your_app_password",
  "host": "imap.gmail.com",
  "port": 993,
  "tls": "implicit",
  "forwardRules": [
    {
      "subjectSearch": "urgent",
      "destinationEmail": "manager@company.com"
    },
    {
      "subjectSearch": "invoice",
      "destinationEmail": "accounting@company.com"
    }
  ]
}
```

#### Delete Configuration
```bash
DELETE /api/configs/{emailAddress}
```

#### Update Forward Rules
```bash
PUT /api/configs/{emailAddress}/rules
Content-Type: application/json

{
  "forwardRules": [
    {
      "subjectSearch": "new_pattern",
      "destinationEmail": "new@email.com"
    }
  ]
}
```

#### Get Service Status
```bash
GET /api/status
```

#### Health Check
```bash
GET /health
```

## Database Schema

Each document in the `autobot_emailforwards` database represents a Gmail account configuration:

- **Document ID**: The Gmail address being monitored
- **Document Content**:
  - `email`: Gmail address
  - `password`: App Password (not regular Gmail password)
  - `host`: IMAP server (default: imap.gmail.com)
  - `port`: IMAP port (default: 993)
  - `tls`: TLS mode (default: implicit)
  - `forwardRules`: Array of forwarding rules

### Forward Rule Structure
```json
{
  "subjectSearch": "string to search for in subject",
  "destinationEmail": "email@address.com"
}
```

## How It Works

1. The server starts and loads all IMAP configurations from CouchDB
2. For each configuration, a background service is started
3. Each service connects to Gmail via IMAP every 30 seconds
4. When unread messages are found, it checks if the subject matches any forwarding rules
5. If a match is found, the email is forwarded to the destination address via SMTP
6. The original message is marked as read to prevent reprocessing

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
