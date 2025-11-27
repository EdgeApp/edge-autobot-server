# SyncGitCouch Bot Reference

## Overview

The `syncGitCouch` bot provides bidirectional synchronization between Git repositories and CouchDB documents. It continuously monitors both sources for changes and automatically keeps them in sync, enabling version control for CouchDB documents while maintaining the flexibility of database-driven applications.

## Purpose

This bot is designed for scenarios where you need:
- **Version control** for CouchDB documents stored in Git
- **Backup** of critical configuration documents
- **Collaboration** on database documents through Git workflows
- **Audit trail** of changes to important database records
- **Disaster recovery** capabilities for database content

## How It Works

### Bidirectional Sync
The bot monitors both Git files and CouchDB documents for changes:
- **CouchDB → Git**: When a document is updated in CouchDB, the bot commits the change to Git
- **Git → CouchDB**: When a file is modified in Git, the bot updates the corresponding CouchDB document

### Change Detection
The bot maintains state information (git commit hash and CouchDB revision) for each synchronized file. Every minute, it:
1. Checks if the git file has changed (comparing current hash vs stored hash)
2. Checks if the CouchDB document has changed (comparing current rev vs stored rev)
3. Syncs changes in the appropriate direction

### Real-time Updates
For faster CouchDB-to-Git updates, the bot subscribes to CouchDB's changes feed, enabling near-instantaneous syncing when documents are modified in the database.

## Configuration

### Database Setup

The bot uses a CouchDB database named `autobot_syncgitcouch` to store configuration. Each sync configuration is a document in this database.

### Configuration Document Format

```json
{
  "_id": "my_config_sync",
  "enabled": true,
  "gitRepo": "git@github.com:myorg/myrepo.git",
  "couchUrl": "https://admin:password@couchdb.example.com:6984",
  "couchDb": "my_database",
  "syncDocs": [
    "assetStatus",
    "corePlugins"
  ]
}
```

### Configuration Fields

| Field       | Type    | Description                                                   |
|-------------|---------|---------------------------------------------------------------|
| `_id`       | string  | Unique identifier for this sync configuration                 |
| `enabled`   | boolean | Whether this sync configuration is active (true/false)        |
| `gitRepo`   | string  | Git repository URL (SSH or HTTPS format)                      |
| `couchUrl`  | string  | CouchDB server URL with credentials                           |
| `couchDb`   | string  | Name of the CouchDB database containing documents to sync     |
| `syncDocs`  | array   | List of CouchDB document names to sync                        |

### File Naming

Git files are created using the pattern: `{couchDb}/{couchDoc}.json`

**Example**:
- `couchDb`: `"my_database"`
- `couchDoc`: `"assetStatus"`
- **Resulting file**: `my_database/assetStatus.json`

## Setup Instructions

### 1. Create Configuration Document

Using CouchDB Fauxton or any CouchDB client:

1. Open the `autobot_syncgitcouch` database
2. Create a new document with your configuration (see format above)
3. Save the document

### 2. Git Repository Setup

Ensure:
- The Git repository exists and is accessible
- SSH keys are configured if using SSH URLs
- The bot has read/write access to the repository
- The `master` branch exists (bot commits to master)

### 3. Initial Sync

On first run:
- If a git file doesn't exist, the bot downloads the current CouchDB document
- If neither exists, the bot logs a warning and skips that file
- The bot creates a status document to track sync state

## Status Tracking

The bot automatically creates status documents to track synchronization state.

### Status Document Format

```json
{
  "_id": "my_config_sync:status",
  "docStatus": {
    "assetStatus": {
      "gitHash": "1f94ea3b4bfa52e7d8a3c6b10e3f9a8d4e5c2b1a",
      "couchRev": "485-6315c5b2f57e569b59450f1c5c4399fe"
    },
    "corePlugins": {
      "gitHash": "9faed3349be0f8c7d6a5b4e3c2d1a0f9e8d7c6b5",
      "couchRev": "1-bc82f7787f7b495c97a6fcf633688885"
    }
  }
}
```

The status document ID is the configuration ID with `:status` appended.

## Behavior & Rules

### Conflict Resolution

**Scenario 1: Both Changed**
If both the git file and CouchDB document have changed since the last sync:
- **CouchDB wins**: The bot overwrites the git file with the CouchDB content
- Rationale: Database is considered the source of truth

**Scenario 2: Git Push Conflict**
If the bot's git push fails due to conflicts:
- The bot executes: `git fetch && git reset --hard origin/master`
- Applies the CouchDB changes on top
- Commits and pushes again
- This maintains CouchDB as the source of truth

**Scenario 3: CouchDB Update Conflict**
If updating CouchDB fails due to a revision conflict:
- The bot fetches the latest CouchDB document
- Syncs it back to git (overwriting the git change)
- Again, CouchDB wins

### Data Handling

**CouchDB → Git**:
- The `_rev` field is removed before saving to git
- Files are saved as formatted JSON
- Commit message: `"Sync {couchDoc} from CouchDB (rev: {couchRev})"`

**Git → CouchDB**:
- The bot fetches the current `_rev` from CouchDB before updating
- JSON is parsed and validated before uploading

### Independent Document Processing

Each document in the `syncDocs` array is processed independently:
- Separate git commits for each document
- If one document fails, others continue processing
- Each document has its own status tracking

## Operation

### Timing
- Bot runs every **1 minute**
- Each run checks all configured sync files
- CouchDB changes may trigger faster updates via subscription

### Subscriptions
The bot maintains a CouchDB changes feed subscription:
- Subscription is reestablished every minute
- This workaround addresses CouchDB subscription reliability issues
- Implemented as a singleton pattern

### Git Branch
All commits go to the **master** branch.

## Monitoring & Troubleshooting

### Log Messages

**Normal Operation**:
- "Syncing {couchDoc} from CouchDB to git"
- "Syncing {couchDoc} from git to CouchDB"

**Warnings**:
- "Neither git file nor CouchDB doc exists for {couchDoc}"
- "Conflict detected, preferring CouchDB for {couchDoc}"

**Errors**:
- Git operation failures
- CouchDB connection issues
- JSON parsing errors

### Common Issues

**Issue**: Files not syncing
- Check git repository accessibility
- Verify CouchDB credentials and URL
- Ensure documents exist in CouchDB or git
- Review bot logs for errors

**Issue**: Git conflicts
- Bot automatically resolves by preferring CouchDB
- Check git history for conflict resolution commits

**Issue**: Missing SSH keys
- Ensure SSH keys are properly configured
- Test git access: `ssh -T git@github.com`

**Issue**: CouchDB authentication failures
- Verify username and password in `couchUrl`
- Check CouchDB user permissions
- Ensure database exists

## Best Practices

1. **Test configurations** with a single file first before adding multiple files
2. **Use descriptive IDs** for configuration documents (e.g., `production_config_sync`)
3. **Monitor logs** regularly, especially after initial setup
4. **Backup important data** before enabling sync
5. **Use SSH keys** for git authentication when possible
6. **Keep CouchDB URLs secure** - they contain credentials

## Security Considerations

- Configuration documents contain **plaintext passwords** in `couchUrl`
- Store `autobot_syncgitcouch` database securely
- Limit access to the bot's git SSH keys
- Use dedicated bot accounts with minimal required permissions
- Consider using git credential helpers instead of embedded passwords

## Limitations

- Only syncs to the `master` branch
- No support for git branches or tags
- Binary files not supported (JSON documents only)
- CouchDB is always preferred in conflicts
- No support for deleting synced files (only updates)

## Example Use Cases

### Configuration Management
Sync application configuration documents from CouchDB to git for version control and change tracking.

### Data Backup
Automatically backup critical CouchDB documents to a git repository for disaster recovery.

### Multi-Environment Deployment
Maintain configuration documents in git and automatically sync to production CouchDB databases.

### Collaborative Editing
Allow team members to edit configuration documents through git PRs while keeping CouchDB updated.

