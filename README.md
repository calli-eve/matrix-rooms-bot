# Matrix Rooms Bot

A Matrix bot that monitors new rooms created in a specific space and posts links to a configured notification room.

## Features

### Room Monitoring
- Monitors a specified space for new room creation
- Posts formatted notifications with room links to a configured notification room
- Configurable check interval (default: 5 minutes)
- Supports both room aliases and room IDs for links
- Persists room state to file to avoid duplicate notifications
- First run establishes baseline without sending alerts

## Configuration

Copy `config.example.json` to `config.json` and configure:

```json
{
  "matrix": {
    "homeserverUrl": "https://matrix.yourserver.com",
    "accessToken": "your_matrix_access_token_here",
    "userId": "@matrix-auth-bot:yourserver.com"
  },
  "roomMonitor": {
    "observedSpace": "!mainspace:yourserver.com",
    "notificationRoom": "!notifications:yourserver.com",
    "checkInterval": 300000
  }
}
```

### Configuration Options

- **matrix**: Matrix homeserver configuration
  - `homeserverUrl`: Your Matrix homeserver URL
  - `accessToken`: Bot's access token (requires admin privileges)
  - `userId`: Bot's user ID (optional, auto-detected if not provided)

- **roomMonitor**: Room monitoring settings
  - `observedSpace`: Space ID to monitor for new rooms
  - `notificationRoom`: Room ID where notifications will be posted
  - `checkInterval`: Interval in milliseconds to check for new rooms (default: 300000 = 5 minutes)
  - `stateFile`: File path to store room monitoring state (default: ./data/room-monitor-state.json)

## Setup

1. Create a bot user in your Matrix homeserver
2. Give the bot admin privileges (required for Synapse Admin API)
3. Add the bot to the space you want to monitor and the notification room
4. Copy `config.example.json` to `config.json` and configure it
5. Run the bot: `node index.js`

## Requirements

- Node.js 18+
- Matrix homeserver with Synapse Admin API enabled
- Bot user with admin privileges