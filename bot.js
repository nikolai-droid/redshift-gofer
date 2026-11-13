// ===================================================================
//  RedShift's Gofer — bot entry point
//
//  Runs the Discord client and routes interactions into the feature
//  modules: the clan-war announcement builder (/announce) and its
//  admin controls (/announce-access).
//
//  Start with:  npm run bot
// ===================================================================
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { attachClient, handleCommand, handleComponent, handleModal, hydrateConfigFromDiscord } from './announce.js';
import { ACCESS_COMMAND, handleAccessCommand } from './access.js';
import { CONFIG_COMMAND, handleAutocomplete, handleConfigCommand } from './manage.js';

dotenv.config();

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const APP_ID = process.env.DISCORD_APP_ID;
// Optional: register the slash commands to one specific guild.
// If it is not set, the commands are registered to every guild the bot is in.
const GUILD_ID = process.env.DISCORD_GUILD_ID || null;

if (!TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN in .env');
  process.exit(1);
}
if (!APP_ID) {
  console.error('Missing DISCORD_APP_ID in .env (Discord Developer Portal → General Information → Application ID)');
  process.exit(1);
}

const ANNOUNCE_COMMAND = new SlashCommandBuilder()
  .setName('announce')
  .setDescription('Build and post a clan event announcement (leadership only).');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ------------------------------------------------------------------
//  Health endpoint
//
//  Free hosts (Render, Railway, Fly) need the process to listen on a
//  port, and they shut a free instance down when it goes quiet. A tiny
//  HTTP server gives them something to ping.
// ------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const server = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});
server.listen(PORT, () => console.log(`Health endpoint listening on :${PORT}`));

// ------------------------------------------------------------------
//  Slash command registration
// ------------------------------------------------------------------
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const body = [ANNOUNCE_COMMAND.toJSON(), ACCESS_COMMAND.toJSON(), CONFIG_COMMAND.toJSON()];

  const targets = GUILD_ID ? [GUILD_ID] : [...client.guilds.cache.keys()];
  if (!targets.length) {
    console.warn('No guilds found — skipping command registration.');
    return;
  }

  for (const guildId of targets) {
    await rest.put(Routes.applicationGuildCommands(APP_ID, guildId), { body });
    console.log(`Registered /announce and /announce-access for guild ${guildId}`);
  }
}

// ------------------------------------------------------------------
//  Interaction routing
// ------------------------------------------------------------------
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'announce') {
        await handleCommand(interaction);
      } else if (interaction.commandName === 'announce-access') {
        await handleAccessCommand(interaction);
      } else if (interaction.commandName === 'announce-config') {
        await handleConfigCommand(interaction);
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('announce-modal:')) {
        await handleModal(interaction);
      }
      return;
    }

    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('announce:')) {
        await handleComponent(interaction);
      }
    }
  } catch (err) {
    console.error('Interaction failed:', err);
    const msg = `⚠️ ${err.message}`;
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, flags: 64 });
      } else {
        await interaction.reply({ content: msg, flags: 64 });
      }
    } catch {
      /* interaction expired */
    }
  }
});

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  attachClient(client);
  // On a host with an ephemeral disk the config file starts empty, so the
  // live settings are restored from Discord before anything runs.
  try {
    await hydrateConfigFromDiscord();
  } catch (err) {
    console.error(`[config] could not restore the config from Discord: ${err.message}`);
  }
  try {
    await registerCommands();
  } catch (err) {
    console.error('Could not register slash commands:', err.message);
  }
  console.log('Ready. Use /announce in a server channel.');
});

client.on('error', (err) => console.error('Discord client error:', err));

await client.login(TOKEN);
