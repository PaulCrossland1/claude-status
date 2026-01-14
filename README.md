# Claude Status Slack Bot

Monitor the Claude status page and post incidents to Slack. Automatically tracks incident status changes and updates existing messages instead of creating duplicates.

## Features

- Polls Claude status RSS feed every 5 minutes (via GitHub Actions)
- Posts new incidents to Slack with formatted messages
- Edits existing messages when incident status changes
- Prevents duplicate notifications with state tracking
- Status indicators:
  - :red_circle: Investigating
  - :large_yellow_circle: Identified
  - :large_blue_circle: Monitoring
  - :large_green_circle: Resolved

## Setup

### 1. Create Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Under **OAuth & Permissions**, add these Bot Token Scopes:
   - `chat:write` - Post messages
   - `chat:write.public` - Post to public channels without joining
3. Install the app to your workspace
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### 2. Get Channel ID

1. Right-click on the target Slack channel
2. Click "View channel details"
3. Scroll to the bottom and copy the Channel ID

### 3. Configure Secrets

Add these secrets to your GitHub repository (Settings > Secrets and variables > Actions):

- `SLACK_BOT_TOKEN`: Your bot token (`xoxb-...`)
- `SLACK_CHANNEL_ID`: Target channel ID (`C...`)

### 4. Local Development

```bash
npm install
cp .env.example .env
# Edit .env with your credentials
npm run check
```

## How It Works

1. Fetches RSS from `https://status.claude.com/history.rss`
2. Parses incidents and extracts current status
3. Compares with cached state to detect new/updated incidents
4. Posts new incidents or updates existing Slack messages
5. Saves state to `.cache/incidents.json`

## GitHub Actions

The workflow runs every 5 minutes and caches the incident state between runs. You can also trigger it manually from the Actions tab.
