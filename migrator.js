import { Client, GatewayIntentBits, REST, Routes, ChannelType, PermissionFlagsBits } from 'discord.js';
import dotenv from 'dotenv';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '.temp');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const CONFIG = {
  token: process.env.DISCORD_BOT_TOKEN,
  mappings: JSON.parse(process.env.MIGRATION_MAPPINGS || '[]'),
  delayMs: parseInt(process.env.MIGRATION_DELAY_MS || '1000', 10),
  batchSize: parseInt(process.env.MIGRATION_BATCH_SIZE || '50', 10),
  dryRun: process.env.DRY_RUN === 'true',
  skipExisting: process.env.SKIP_EXISTING === 'true',
  maxMessagesPerChannel: parseInt(process.env.MAX_MESSAGES_PER_CHANNEL || '0', 10),
  maxDaysAgo: parseInt(process.env.MAX_DAYS_AGO || '99999', 10),
};

if (!CONFIG.token) {
  console.error('Missing DISCORD_BOT_TOKEN in .env');
  process.exit(1);
}

if (!CONFIG.mappings.length) {
  console.error('Missing MIGRATION_MAPPINGS in .env. Expected JSON array.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, (res) => {
      if (res.statusCode === 200 || res.statusCode === 301 || res.statusCode === 302) {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
      } else {
        reject(new Error(`Failed to download ${url}: ${res.statusCode}`));
      }
    });
    req.on('error', reject);
    req.end();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMessages(channel, limit = 0) {
  const messages = [];
  let lastId = null;
  const maxPerRequest = 100;
  const cutoff = CONFIG.maxDaysAgo > 0 ? Date.now() - CONFIG.maxDaysAgo * 24 * 60 * 60 * 1000 : 0;

  console.log(`  Cutoff date: ${cutoff ? new Date(cutoff).toISOString() : 'none (fetch all)'}`);

  while (true) {
    if (limit > 0 && messages.length >= limit) break;

    const fetchLimit = Math.min(maxPerRequest, limit > 0 ? limit - messages.length : maxPerRequest);
    const options = { limit: fetchLimit };

    if (lastId) {
      options.before = lastId;
    }

    let batch;
    try {
      batch = await channel.messages.fetch(options);
    } catch (err) {
      console.error(`  Error fetching batch: ${err.message}`);
      console.error(`  Full error:`, err);
      break;
    }

    console.log(`  Fetched batch of ${batch.size} messages`);

    if (!batch.size) break;

    const sorted = [...batch.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);

    for (const message of sorted) {
      if (cutoff && message.createdTimestamp < cutoff) {
        console.log(`  Reached cutoff at message ${message.id} (${new Date(message.createdTimestamp).toISOString()})`);
        return messages;
      }
      messages.push(message);
    }

    lastId = sorted[sorted.length - 1].id;

    if (batch.size < fetchLimit) break;

    await delay(CONFIG.delayMs);
  }

  return messages;
}

function buildContent(message) {
  const parts = [];

  if (message.content && message.content.trim()) {
    parts.push(message.content);
  }

  if (message.embeds?.length) {
    for (const embed of message.embeds) {
      if (embed.title) parts.push(`**${embed.title}**`);
      if (embed.description) parts.push(embed.description);
      if (embed.url) parts.push(embed.url);
      if (embed.footer?.text) parts.push(`_${embed.footer.text}_`);
    }
  }

  return parts.join('\n\n').trim() || null;
}

function getChannelTypeName(channel) {
  switch (channel.type) {
    case ChannelType.GuildText:
      return 'Text';
    case ChannelType.GuildAnnouncement:
      return 'Announcement/News';
    case ChannelType.GuildVoice:
      return 'Voice';
    case ChannelType.GuildStageVoice:
      return 'Stage';
    case ChannelType.GuildForum:
      return 'Forum';
    case ChannelType.GuildMedia:
      return 'Media';
    default:
      return channel.type;
  }
}

function hasPermission(channel, permission) {
  const permissions = channel.permissionsFor(client.user);
  if (!permissions) return false;
  return permissions.has(permission);
}

async function migrateChannel(sourceChannelId, destChannelId) {
  const sourceChannel = await client.channels.fetch(sourceChannelId);
  if (!sourceChannel || !sourceChannel.isTextBased()) {
    console.error(`Source channel ${sourceChannelId} not found or not text-based.`);
    console.error(`  Channel type: ${sourceChannel ? getChannelTypeName(sourceChannel) : 'null'}`);
    return;
  }

  const destChannel = await client.channels.fetch(destChannelId);
  if (!destChannel || !destChannel.isTextBased()) {
    console.error(`Destination channel ${destChannelId} not found or not text-based.`);
    return;
  }

  console.log(`\nMigrating #${sourceChannel.name} -> #${destChannel.name}`);
  console.log(`Source channel type: ${getChannelTypeName(sourceChannel)}`);
  console.log(`Source channel ID: ${sourceChannel.id}`);
  console.log(`Bot permissions in source channel:`);
  console.log(`  View Channel: ${hasPermission(sourceChannel, PermissionFlagsBits.ViewChannel)}`);
  console.log(`  Read Message History: ${hasPermission(sourceChannel, PermissionFlagsBits.ReadMessageHistory)}`);
  console.log(`  Send Messages: ${hasPermission(sourceChannel, PermissionFlagsBits.SendMessages)}`);
  console.log(`Fetching messages...`);

  const messages = await fetchMessages(sourceChannel, CONFIG.maxMessagesPerChannel);
  const ordered = [...messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  console.log(`Fetched ${ordered.length} messages. Starting migration...`);

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const message of ordered) {
    try {
      if (CONFIG.skipExisting) {
        const existing = await destChannel.messages.fetch({ limit: 1, around: message.id });
        if (existing.size > 0) {
          console.log(`Skipping existing message ${message.id}`);
          skipped++;
          continue;
        }
      }

      const content = buildContent(message);

      if (CONFIG.dryRun) {
        console.log(`[DRY RUN] ${message.author.tag}: ${content?.slice(0, 80) || '(embed/attachment only)'}`);
        success++;
        continue;
      }

      const filesToSend = [];

      if (message.attachments?.size) {
        for (const [attId, attachment] of message.attachments) {
          try {
            const ext = path.extname(attachment.name || attachment.url) || '.bin';
            const localPath = path.join(TEMP_DIR, `${attId}${ext}`);
            let buffer;

            if (fs.existsSync(localPath)) {
              buffer = fs.readFileSync(localPath);
            } else {
              console.log(`  Downloading ${attachment.name || attachment.url}`);
              buffer = await downloadFile(attachment.url);
              fs.writeFileSync(localPath, buffer);
            }

            filesToSend.push({
              attachment: localPath,
              name: attachment.name || `attachment_${attId}${ext}`,
            });
          } catch (err) {
            console.warn(`  Failed to process attachment ${attachment.url}: ${err.message}`);
          }
        }
      }

      const sent = await destChannel.send({
        content: content || undefined,
        files: filesToSend.length ? filesToSend : undefined,
        ...(message.stickers?.size ? { stickers: message.stickers.map(s => s.id) } : {}),
      });

      if (message.reference) {
        try {
          await sent.reply({
            content: `*Replying to ${message.reference.messageId} in #${sourceChannel.name}*`,
            allowedMention: { parse: [] },
          });
        } catch (err) {
          console.warn(`  Could not add reply reference: ${err.message}`);
        }
      }

      success++;
      console.log(`  [${success}/${ordered.length}] ${message.author.tag}`);
      await delay(CONFIG.delayMs);
    } catch (err) {
      failed++;
      console.error(`  Failed to migrate message ${message.id}: ${err.message}`);
      await delay(CONFIG.delayMs * 2);
    }
  }

  console.log(`\nChannel migration complete: ${success} sent, ${skipped} skipped, ${failed} failed.`);
}

async function run() {
  console.log('Logging in...');
  client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Mode: ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);

    for (const mapping of CONFIG.mappings) {
      await migrateChannel(mapping.source, mapping.destination);
    }

    console.log('\nAll migrations complete.');
    await client.destroy();
    process.exit(0);
  });

  client.on('error', (err) => {
    console.error('Discord client error:', err);
  });

  await client.login(CONFIG.token);
}

run();
