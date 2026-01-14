# Claude Status Slack Bot

Monitor the Claude status page and post incidents to Slack. Automatically tracks incident status changes and edits existing messages in place.

## Features

- Polls `status.claude.com` RSS feed every 5 minutes via GitHub Actions
- Posts new incidents to Slack with formatted messages
- Edits existing messages when status changes (no duplicates)
- Shows only the latest status update with "Last checked" timestamp
- Status indicators:
  - :rotating_light: Investigating
  - :mag: Identified
  - :eyes: Monitoring
  - :speech_balloon: Update
  - :white_check_mark: Resolved

## Message Format

```
:clawd-down: Incident Title :clawd-down:
────────────────────────────────────────
`Jan 14, 14:17 UTC`  :white_check_mark: *Resolved* - This incident has been resolved.
────────────────────────────────────────
View on status page  ·  Last checked: Jan 14, 2026, 02:41 PM UTC
```

## Setup

### 1. Create Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Under **OAuth & Permissions**, add Bot Token Scopes:
   - `chat:write`
   - `chat:write.public`
3. Install to workspace and copy the **Bot User OAuth Token** (`xoxb-...`)

### 2. Configure GitHub Secrets

Add to your repository (Settings > Secrets and variables > Actions):

- `SLACK_BOT_TOKEN` - Bot token (`xoxb-...`)
- `SLACK_CHANNEL_ID` - Target channel ID (`C...`)

### 3. Run

The workflow runs automatically every 5 minutes, or trigger manually from the Actions tab.

## Local Development

```bash
npm install
cp .env.example .env
# Edit .env with credentials
npm run check
```

## How It Works

1. Fetch RSS from `https://status.claude.com/history.rss`
2. Parse incidents and extract current status
3. Compare with cached state (`.cache/incidents.json`)
4. New incident → post to Slack, store message timestamp
5. Updated incident → edit existing Slack message
6. Save state for next run
