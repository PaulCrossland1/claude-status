import 'dotenv/config';
import { WebClient } from '@slack/web-api';
import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

const RSS_URL = 'https://status.claude.com/history.rss';
const STATE_FILE = '.cache/incidents.json';

const slack = process.env.SLACK_BOT_TOKEN
  ? new WebClient(process.env.SLACK_BOT_TOKEN)
  : null;

const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

// Status emoji mapping
const STATUS_EMOJI = {
  investigating: ':rotating_light:',
  identified: ':mag:',
  monitoring: ':eyes:',
  update: ':speech_balloon:',
  resolved: ':white_check_mark:',
  unknown: ':grey_question:'
};

/**
 * Fetch RSS feed from status.claude.com
 */
async function fetchRssFeed() {
  console.log('Fetching RSS feed...');
  const response = await fetch(RSS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch RSS: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

/**
 * Parse RSS XML into incident objects
 */
function parseRssFeed(xmlContent) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
  });

  const parsed = parser.parse(xmlContent);
  const items = parsed?.rss?.channel?.item || [];

  // Ensure items is always an array
  const itemArray = Array.isArray(items) ? items : [items];

  return itemArray.map(item => ({
    guid: extractGuid(item.guid),
    title: item.title || 'Unknown Incident',
    description: item.description || '',
    pubDate: item.pubDate || new Date().toISOString(),
    link: item.link || 'https://status.claude.com'
  }));
}

/**
 * Extract guid value (may be string or object with #text)
 */
function extractGuid(guid) {
  if (typeof guid === 'string') return guid;
  if (guid && guid['#text']) return guid['#text'];
  return `unknown-${Date.now()}`;
}

/**
 * Extract current status from HTML description
 * The first status in the description is the most recent
 */
function extractCurrentStatus(description) {
  const statusPatterns = [
    { regex: /<strong>Resolved<\/strong>/i, status: 'resolved' },
    { regex: /<strong>Monitoring<\/strong>/i, status: 'monitoring' },
    { regex: /<strong>Identified<\/strong>/i, status: 'identified' },
    { regex: /<strong>Investigating<\/strong>/i, status: 'investigating' },
    // Also check without strong tags
    { regex: /\bResolved\b/i, status: 'resolved' },
    { regex: /\bMonitoring\b/i, status: 'monitoring' },
    { regex: /\bIdentified\b/i, status: 'identified' },
    { regex: /\bInvestigating\b/i, status: 'investigating' }
  ];

  let firstMatch = { position: Infinity, status: 'unknown' };

  for (const { regex, status } of statusPatterns) {
    const match = regex.exec(description);
    if (match && match.index < firstMatch.position) {
      firstMatch = { position: match.index, status };
    }
  }

  return firstMatch.status;
}

/**
 * Parse HTML description to extract only the most recent status update
 */
function parseDescription(htmlDescription) {
  // Extract the first <p> block (most recent update)
  const firstParagraph = htmlDescription.match(/<p>([\s\S]*?)<\/p>/i);
  if (!firstParagraph) return htmlDescription;

  let text = firstParagraph[1]
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<var[^>]*>/gi, '')
    .replace(/<\/var>/gi, '');

  // Convert timestamps in <small> tags to code blocks
  text = text.replace(/<small>([^<]+)<\/small>/gi, '`$1`');

  // Add emojis to status labels
  text = text.replace(/<strong>Investigating<\/strong>/gi, `${STATUS_EMOJI.investigating} *Investigating*`);
  text = text.replace(/<strong>Identified<\/strong>/gi, `${STATUS_EMOJI.identified} *Identified*`);
  text = text.replace(/<strong>Monitoring<\/strong>/gi, `${STATUS_EMOJI.monitoring} *Monitoring*`);
  text = text.replace(/<strong>Update<\/strong>/gi, `${STATUS_EMOJI.update} *Update*`);
  text = text.replace(/<strong>Resolved<\/strong>/gi, `${STATUS_EMOJI.resolved} *Resolved*`);

  // Handle any remaining strong tags
  text = text.replace(/<strong>/gi, '*');
  text = text.replace(/<\/strong>/gi, '*');

  // Clean up remaining HTML and entities
  text = text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

  // Put timestamp on same line as status
  text = text.replace(/`([^`]+)`\n+(:[a-z_]+:)\s*\*([^*]+)\*/g, '`$1`  $2 *$3*');

  return text.trim();
}

/**
 * Hash description for change detection
 */
function hashDescription(description) {
  return createHash('sha256').update(description).digest('hex').slice(0, 16);
}

/**
 * Load incident state from cache file
 */
async function loadState() {
  try {
    const content = await readFile(STATE_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Save incident state to cache file
 */
async function saveState(state) {
  if (!existsSync('.cache')) {
    await mkdir('.cache', { recursive: true });
  }
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Format timestamp for display (always UTC)
 */
function formatTimestamp(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short'
  });
}

/**
 * Truncate text to max length
 */
function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 20) + '\n\n_...and more_';
}

/**
 * Format incident as Slack Block Kit
 */
function formatIncidentBlocks(incident) {
  const cleanDescription = parseDescription(incident.description);
  const lastChecked = formatTimestamp(new Date().toISOString());

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `:clawd-down: ${incident.title} :clawd-down:`,
        emoji: true
      }
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncateText(cleanDescription, 2900)
      }
    },
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `<${incident.link}|View on status page>  ·  Last checked: ${lastChecked}`
        }
      ]
    }
  ];
}

/**
 * Post new incident to Slack
 */
async function postNewIncident(incident) {
  if (!slack || !SLACK_CHANNEL_ID) {
    console.log('Slack not configured, would post:', incident.title);
    return null;
  }

  const blocks = formatIncidentBlocks(incident);

  const result = await slack.chat.postMessage({
    channel: SLACK_CHANNEL_ID,
    text: `Claude Status: ${incident.title} - ${incident.status}`,
    blocks,
    unfurl_links: false,
    unfurl_media: false
  });

  if (!result.ok) {
    throw new Error(`Failed to post message: ${result.error}`);
  }

  console.log(`Posted new incident: ${incident.title}`);
  return result.ts;
}

/**
 * Update existing incident message in Slack
 */
async function updateIncidentMessage(incident, messageTs) {
  if (!slack || !SLACK_CHANNEL_ID) {
    console.log('Slack not configured, would update:', incident.title);
    return messageTs;
  }

  const blocks = formatIncidentBlocks(incident);

  const result = await slack.chat.update({
    channel: SLACK_CHANNEL_ID,
    ts: messageTs,
    text: `Claude Status: ${incident.title} - ${incident.status}`,
    blocks,
    unfurl_links: false,
    unfurl_media: false
  });

  if (!result.ok) {
    throw new Error(`Failed to update message: ${result.error}`);
  }

  console.log(`Updated incident: ${incident.title} -> ${incident.status}`);
  return result.ts;
}

/**
 * Main processing logic
 */
async function processIncidents() {
  // 1. Fetch and parse RSS
  const xmlContent = await fetchRssFeed();
  const feedItems = parseRssFeed(xmlContent);
  console.log(`Found ${feedItems.length} incidents in feed`);

  // 2. Load current state
  const state = await loadState();
  const isFirstRun = Object.keys(state).length === 0;

  if (isFirstRun) {
    console.log('First run detected - will only post most recent incident');
  }

  // 3. Process each incident
  let newCount = 0;
  let updateCount = 0;

  for (const item of feedItems) {
    const incidentId = item.guid;
    const descriptionHash = hashDescription(item.description);
    const currentStatus = extractCurrentStatus(item.description);

    const existing = state[incidentId];

    if (!existing) {
      // NEW INCIDENT
      // On first run, only post the most recent one
      if (isFirstRun && newCount > 0) {
        // Just track it in state without posting
        state[incidentId] = {
          title: item.title,
          description_hash: descriptionHash,
          status: currentStatus,
          first_seen: item.pubDate,
          last_updated: new Date().toISOString(),
          slack_message_ts: null,
          link: item.link
        };
        continue;
      }

      console.log(`New incident: ${item.title}`);

      const messageTs = await postNewIncident({
        ...item,
        status: currentStatus,
        firstSeen: item.pubDate
      });

      state[incidentId] = {
        title: item.title,
        description_hash: descriptionHash,
        status: currentStatus,
        first_seen: item.pubDate,
        last_updated: new Date().toISOString(),
        slack_message_ts: messageTs,
        link: item.link
      };

      newCount++;

    } else if (existing.description_hash !== descriptionHash) {
      // UPDATED INCIDENT
      console.log(`Updated incident: ${item.title} (${existing.status} -> ${currentStatus})`);

      // Only update Slack if we have a message to edit
      if (existing.slack_message_ts) {
        await updateIncidentMessage({
          ...item,
          status: currentStatus,
          firstSeen: existing.first_seen
        }, existing.slack_message_ts);
      }

      state[incidentId] = {
        ...existing,
        description_hash: descriptionHash,
        status: currentStatus,
        last_updated: new Date().toISOString()
      };

      updateCount++;

    } else {
      // No changes
      console.log(`No changes: ${item.title} (${currentStatus})`);
    }
  }

  // 4. Save updated state
  await saveState(state);

  console.log(`\nSummary: ${newCount} new, ${updateCount} updated`);
}

/**
 * Main entry point
 */
async function main() {
  console.log(`[${new Date().toISOString()}] Checking Claude status...`);
  console.log(`RSS URL: ${RSS_URL}`);

  if (!slack) {
    console.warn('Warning: SLACK_BOT_TOKEN not set - running in dry-run mode');
  }
  if (!SLACK_CHANNEL_ID) {
    console.warn('Warning: SLACK_CHANNEL_ID not set - running in dry-run mode');
  }

  await processIncidents();
  console.log('Done!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
