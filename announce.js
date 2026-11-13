// ===================================================================
//  Clan war announcement builder  —  RedShift's Gofer
//  Feature module for the /announce slash command.
//
//  Leaders pick an event type, fill in blocks, and the bot renders a
//  consistent embed. Times are entered in UTC and posted as Discord
//  timestamps, so every member sees them in their own timezone.
//
//  All customisable options live in announce_config.json next to the
//  bot. It is re-read on every use, so edits take effect immediately.
//  Admins can also manage access from inside Discord with
//  /announce-access.
// ===================================================================
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH =
  process.env.ANNOUNCE_CONFIG_PATH || path.join(__dirname, 'announce_config.json');

// ------------------------------------------------------------------
//  Defaults — written to announce_config.json on first run
// ------------------------------------------------------------------
const DEFAULT_EVENTS = {
  crimson_moon: {
    label: 'Crimson Moon', emoji: '🌙', color: 0xb0173a,
    slots: ['05:00', '13:00', '21:00'], dur: 60, needs_time: true,
  },
  egg_hunt: {
    label: 'Egg Hunt', emoji: '🥚', color: 0xf2c94c,
    slots: ['07:00', '15:00', '23:00'], dur: 60, needs_time: true,
  },
  dragon: {
    label: 'Dragon Round', emoji: '🐉', color: 0xe67e22,
    slots: ['00:00', '08:00', '16:00'], dur: 60, needs_time: true,
  },
  spider: {
    label: 'Spider Round', emoji: '🕷️', color: 0x7f8c8d,
    slots: ['00:00', '08:00', '16:00'], dur: 60, needs_time: true,
  },
  reset: {
    label: 'Reset & Diplomacy', emoji: '📢', color: 0x3498db,
    slots: ['00:00'], dur: 0, needs_time: true,
  },
  dragon_share: {
    label: 'Dragon Sharing Agreement', emoji: '🤝', color: 0x2ecc71,
    slots: ['00:00', '08:00', '16:00'], dur: 60, needs_time: true,
  },
  general: {
    label: 'General Announcement', emoji: '📣', color: 0x95a5a6,
    slots: [], dur: 0, needs_time: false,
  },
};

// Block types = the "Add a block" menu AND the section titles in the post.
//   type "text"  -> text box, one bullet per line
//   type "step"  -> asks for a UTC time + text
//   type "order" -> lines like "Japan 00:00-00:15" (offsets from event start)
const DEFAULT_BLOCKS = {
  objective: {
    label: 'Objective', emoji: '🎯', section: '🎯 Objectives',
    hint: 'Attack Gleem at the start, then return and defend Gloom', type: 'text',
  },
  step: {
    label: 'Timed step', emoji: '⏱', section: '⏱ Timeline',
    hint: 'Time in UTC + what happens', type: 'step',
  },
  morale: {
    label: 'Morale', emoji: '😴', section: '😴 Morale',
    hint: 'Save all morale for the dragon', type: 'text',
  },
  do: {
    label: 'Do', emoji: '✅', section: '✅ Do',
    hint: 'Keep our path to base clear', type: 'text',
  },
  dont: {
    label: "Don't", emoji: '❌', section: "❌ Don't",
    hint: 'Do NOT attack Gloom', type: 'text',
  },
  diplomacy: {
    label: 'Diplomacy', emoji: '🤝', section: '🤝 Diplomacy',
    hint: 'We give Gloom to HK for 24 hours', type: 'text',
  },
  order: {
    label: 'Slot order', emoji: '👥', section: '👥 Order / Slots',
    hint: 'Japan 00:00-00:15', type: 'order',
  },
  note: {
    label: 'Free note', emoji: '📝', section: '📝 Notes',
    hint: '', type: 'text',
  },
};

const DEFAULT_CONFIG = {
  events: DEFAULT_EVENTS,
  blocks: DEFAULT_BLOCKS,
  // Extra entries for the Ping dropdown: { "War Marshall": "123456789" }
  role_pings: {},
  // Role IDs allowed to use /announce. Managed with /announce-access.
  leader_role_ids: [],
  // Where announcements are posted. null = the channel /announce was used in.
  channel_id: null,
};

// ------------------------------------------------------------------
//  Config file
// ------------------------------------------------------------------
function toColor(c) {
  if (typeof c === 'number') return c;
  if (typeof c === 'string') return parseInt(c.replace('#', ''), 16) || 0x95a5a6;
  return 0x95a5a6;
}

function colorToHex(c) {
  return `#${toColor(c).toString(16).padStart(6, '0')}`;
}

/**
 * The live config also lives in Discord, so it survives a host with an
 * ephemeral disk (free containers, serverless) and a restart.
 *
 * The config is gzipped and base64-encoded into a single message in the
 * channel named by ANNOUNCE_CONFIG_CHANNEL_ID.
 */
const CONFIG_MARKER = '```bot-config';
let botClient = null;

/** Give the module access to the Discord client (set once at startup). */
export function attachClient(client) {
  botClient = client;
}

function configChannelId() {
  return String(process.env.ANNOUNCE_CONFIG_CHANNEL_ID || '').trim();
}

/** Write the config back to disk. */
export function saveConfig(cfg) {
  const out = {
    ...cfg,
    events: Object.fromEntries(
      Object.entries(cfg.events).map(([k, v]) => [k, { ...v, color: colorToHex(v.color) }]),
    ),
  };
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  // Mirror it into Discord so a restart on a throwaway disk keeps the setup.
  persistConfigToDiscord(out).catch((err) => {
    console.error(`[config] could not save the config to Discord: ${err.message}`);
  });
}

/** Store the config as one message in the config channel. */
async function persistConfigToDiscord(cfg) {
  const channelId = configChannelId();
  if (!channelId || !botClient) return false;
  const channel = await botClient.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;

  const packed = zlib.gzipSync(Buffer.from(JSON.stringify(cfg), 'utf8')).toString('base64');
  const content = `${CONFIG_MARKER}\n${packed}\n\`\`\``;
  if (content.length > 2000) {
    console.error('[config] the config is too big to store in a Discord message');
    return false;
  }

  const existing = await findConfigMessage(channel);
  if (existing) await existing.edit(content);
  else await channel.send(content);
  return true;
}

/** Find the message that holds the stored config, if there is one. */
async function findConfigMessage(channel) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return null;
  let found = null;
  for (const m of messages.values()) {
    if (typeof m.content === 'string' && m.content.startsWith(CONFIG_MARKER)) found = m;
  }
  return found;
}

/**
 * Pull the config back out of Discord and write it to disk. Used at
 * startup so a fresh container picks up the live settings.
 */
export async function hydrateConfigFromDiscord() {
  const channelId = configChannelId();
  if (!channelId || !botClient) return false;
  const channel = await botClient.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.warn(`[config] channel ${channelId} is not reachable — using the local file`);
    return false;
  }
  const message = await findConfigMessage(channel);
  if (!message) return false;

  const packed = message.content
    .slice(CONFIG_MARKER.length)
    .replace(/^```[a-z-]*\n?/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const json = zlib.gunzipSync(Buffer.from(packed, 'base64')).toString('utf8');
  const cfg = JSON.parse(json);
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  console.log('[config] restored the live config from Discord');
  return true;
}

/** Read the config file fresh. A broken file is ignored so the bot keeps working. */
export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const fresh = structuredClone(DEFAULT_CONFIG);
    saveConfig(fresh);
    return fresh;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const events = {};
    for (const [k, v] of Object.entries(raw.events || {}).slice(0, 24)) {
      events[k] = {
        label: String(v.label ?? k),
        emoji: String(v.emoji ?? '📣'),
        color: toColor(v.color),
        slots: (v.slots || []).map(String).slice(0, 24),
        dur: Number(v.dur ?? 60),
        needs_time: v.needs_time !== false,
      };
    }
    const blocks = {};
    for (const [k, v] of Object.entries(raw.blocks || {}).slice(0, 25)) {
      const type = ['text', 'step', 'order'].includes(v.type) ? v.type : 'text';
      blocks[k] = {
        label: String(v.label ?? k),
        emoji: String(v.emoji ?? '📝'),
        section: String(v.section ?? v.label ?? k),
        hint: String(v.hint ?? ''),
        type,
      };
    }
    const rolePings = {};
    for (const [name, id] of Object.entries(raw.role_pings || {})) rolePings[String(name)] = String(id);
    return {
      events: Object.keys(events).length ? events : structuredClone(DEFAULT_EVENTS),
      blocks: Object.keys(blocks).length ? blocks : structuredClone(DEFAULT_BLOCKS),
      role_pings: rolePings,
      leader_role_ids: (raw.leader_role_ids || []).map(String),
      channel_id: raw.channel_id ? String(raw.channel_id) : null,
    };
  } catch (err) {
    console.error(`[config] ${CONFIG_PATH} is broken, using defaults: ${err.message}`);
    return structuredClone(DEFAULT_CONFIG);
  }
}

// ------------------------------------------------------------------
//  Time helpers
// ------------------------------------------------------------------
// ------------------------------------------------------------------
//  Discord API limits
//
//  Discord rejects a payload with "Invalid string length" the moment
//  one of its strings is over the limit, so everything the bot builds
//  is capped here.
// ------------------------------------------------------------------
const LIMITS = {
  modalTitle: 45,      // modal title
  inputLabel: 45,     // text input label
  placeholder: 100,    // text input placeholder
  embedTitle: 256,
  embedDescription: 4096,
  embedFieldName: 256,
  embedFieldValue: 1024,
  embedFooter: 2048,
  embedTotal: 6000,    // title + description + field names + values + footer
};

/** Cut a string down to a Discord limit. */
function cap(text, max) {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max) : s;
}

/** Cut a string down to a limit, preferring to end on a line break. */
function capText(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const brk = cut.lastIndexOf('\n');
  return `${(brk > max * 0.5 ? cut.slice(0, brk) : cut).trimEnd()}…`;
}

// ------------------------------------------------------------------
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Discord timestamp. style: t short time, f date+time, D date, R relative. */
function ts(date, style = 't') {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

/** Parse "HH:MM" (or "H.MM") into {h, m}. Throws on bad input. */
export function parseHhmm(s) {
  const m = /^\s*(\d{1,2})[:.]?(\d{2})\s*$/.exec(String(s));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    throw new Error(`"${s}" is not a valid HH:MM time (use 24-hour UTC, e.g. 06:50)`);
  }
  return { h: Number(m[1]), m: Number(m[2]) };
}

/**
 * An order line: a name and the slot it plays.
 *
 *   "Japan 00:00-00:15"      name + a range of minutes from the event start
 *   "GymSis APP — 2:29 AM"   a dash between the name and a single slot
 *
 * The dash may be a hyphen, en dash or em dash, and a 12-hour clock is
 * accepted next to the slot time.
 */
const ORDER_LINE = /^(.+?)\s*[-–—]?\s*(\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?)(?:\s*[-–—]\s*(\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?))?$/i;

/** Minutes for a slot time: "2:29", "02:29" or "2:29 PM". Null if unusable. */
function parseSlotTime(raw) {
  const s = String(raw).trim();
  const twelve = /^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i.exec(s);
  if (twelve) {
    let h = Number(twelve[1]);
    const m = Number(twelve[2]);
    if (h < 1 || h > 12 || m > 59) return null;
    const pm = twelve[3].toLowerCase() === 'p';
    h = pm ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h);
    return h * 60 + m;
  }
  const plain = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!plain) return null;
  const h = Number(plain[1]);
  const m = Number(plain[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** The occurrence of HH:MM UTC closest to ref. */
function nearest(ref, h, m) {
  const base = new Date(Date.UTC(
    ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), h, m, 0, 0,
  ));
  return [-1, 0, 1]
    .map((d) => new Date(base.getTime() + d * DAY))
    .reduce((best, c) => (Math.abs(c - ref) < Math.abs(best - ref) ? c : best));
}

/**
 * Turn "06:50 UTC" or "07:00-08:00 UTC" typed inside free text into
 * Discord timestamps so it shows in each reader's own timezone.
 */
function convertUtc(text, ref) {
  return String(text).replace(
    /\b(\d{1,2}):(\d{2})(?:\s*[-–]\s*(\d{1,2}):(\d{2}))?\s*UTC\b/gi,
    (match, h1, m1, h2, m2) => {
      try {
        const start = nearest(ref, Number(h1), Number(m1));
        if (!h2) return ts(start);
        const end = nearest(new Date(start.getTime() + 30 * MINUTE), Number(h2), Number(m2));
        return `${ts(start)}–${ts(end)}`;
      } catch {
        return match;
      }
    },
  );
}

// ------------------------------------------------------------------
//  Sessions — one builder per leader per guild
// ------------------------------------------------------------------
const sessions = new Map();
const SESSION_TTL = 3 * HOUR;

function sessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getSession(guildId, userId) {
  const key = sessionKey(guildId, userId);
  const found = sessions.get(key);
  if (found && Date.now() - found.touched < SESSION_TTL) {
    found.touched = Date.now();
    return found;
  }
  const session = {
    id: Math.random().toString(36).slice(2, 10),
    key,
    userId,
    guildId,
    channelId: null,
    authorTag: '',
    event: null,
    title: '',
    start: null,
    end: null,
    items: [],          // { kind, text }
    ping: 'everyone',   // everyone | here | none | role:<name>
    // Whether a time is required before posting. Starts from the event's
    // own setting, but the leader can flip it for this announcement.
    timeOptional: false,
    touched: Date.now(),
  };
  sessions.set(key, session);
  return session;
}

function dropSession(session) {
  sessions.delete(session.key);
}

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL;
  for (const [key, s] of sessions) if (s.touched < cutoff) sessions.delete(key);
}, 10 * MINUTE).unref?.();

// ------------------------------------------------------------------
//  Permissions
// ------------------------------------------------------------------
/** True if the user may use /announce (server manager, or a granted leader role). */
export function isLeader(interaction, cfg) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const roles = interaction.member?.roles?.cache;
  if (!roles) return false;
  return (cfg.leader_role_ids || []).some((id) => roles.has(id));
}

// ------------------------------------------------------------------
//  Rendering
// ------------------------------------------------------------------
function pingLabel(key, cfg) {
  if (key === 'everyone') return '@everyone';
  if (key === 'here') return '@here';
  if (key === 'none') return 'No ping';
  if (key.startsWith('role:')) {
    const name = key.slice(5);
    return `@${name}`;
  }
  return key;
}

function pingContent(session, cfg) {
  if (session.ping === 'none') return { content: null, allowedMentions: { parse: [] } };
  if (session.ping === 'everyone') return { content: '@everyone', allowedMentions: { parse: ['everyone'] } };
  if (session.ping === 'here') return { content: '@here', allowedMentions: { parse: ['everyone'] } };
  const name = session.ping.slice(5);
  const roleId = cfg.role_pings?.[name];
  if (!roleId) return { content: null, allowedMentions: { parse: [] } };
  return { content: `<@&${roleId}>`, allowedMentions: { roles: [roleId], parse: [] } };
}

/** Build the embed shown in the preview and in the final post. */
export function buildEmbed(session, cfg) {
  const ev = cfg.events[session.event];
  if (!ev) {
    return new EmbedBuilder()
      .setTitle('📣 New announcement')
      .setDescription('Pick the type of announcement you want to post.')
      .setColor(0x95a5a6);
  }

  const title = cap(`${ev.emoji} ${(session.title || ev.label).toUpperCase()}`, LIMITS.embedTitle);
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(ev.color);

  let description = '';
  if (session.start) {
    const lines = [];
    if (session.end) {
      lines.push(`🕒 **${ts(session.start, 'f')} – ${ts(session.end, 't')}** · ${ts(session.start, 'D')} · starts ${ts(session.start, 'R')}`);
      lines.push(`\`${fmtUtc(session.start)} – ${fmtUtc(session.end)} UTC\``);
    } else {
      lines.push(`🕒 **Effective ${ts(session.start, 'f')}** · ${ts(session.start, 'D')} · starts ${ts(session.start, 'R')}`);
      lines.push(`\`${fmtUtc(session.start)} UTC\``);
    }
    lines.push('*times above show in your own timezone*');
    description = capText(lines.join('\n'), LIMITS.embedDescription);
  } else if (ev.needs_time && !session.timeOptional) {
    description = capText(
      '⚠️ **Time not set yet** — or tap **Time: optional** below if this one has no fixed time.',
      LIMITS.embedDescription,
    );
  }
  if (description) embed.setDescription(description);

  const footer = cap(`Posted by ${session.authorTag || 'a leader'}`, LIMITS.embedFooter);

  // Discord caps the whole embed at 6000 characters, so the blocks share
  // whatever is left after the title, description and footer.
  const blocks = [];
  for (const [kind, blk] of Object.entries(cfg.blocks)) {
    const texts = session.items.filter((i) => i.kind === kind).map((i) => i.text);
    if (!texts.length) continue;
    blocks.push({
      name: cap(blk.section, LIMITS.embedFieldName),
      lines: texts.map((t) => `• ${t}`),
    });
  }

  let budget = LIMITS.embedTotal - title.length - description.length - footer.length;

  // Room kept aside for the "… +N more" note.
  const NOTE_RESERVE = 12;
  // Every block gets a fair share of the space, so a full announcement
  // shows all of its sections instead of dropping the last ones.
  const share = blocks.length ? Math.floor(budget / blocks.length) : budget;
  const fields = [];

  for (const [index, blk] of blocks.entries()) {
    // Space this field may use, both on its own and in the whole embed.
    const later = blocks.length - index - 1;
    const room = Math.min(
      LIMITS.embedFieldValue,
      budget - blk.name.length - later * share,
    );
    if (room <= 0) continue;

    const fill = (capLen) => {
      const kept = [];
      let used = 0;
      for (const line of blk.lines) {
        const add = line.length + (kept.length ? 1 : 0);
        if (used + add > capLen) {
          // Cut the line short rather than dropping the section entirely.
          const roomLeft = capLen - used - (kept.length ? 1 : 0);
          if (roomLeft > 3) {
            kept.push(`${line.slice(0, roomLeft - 1)}…`);
            used += roomLeft;
          }
          break;
        }
        kept.push(line);
        used += add;
      }
      return kept;
    };

    let kept = fill(room);
    if (!kept.length) continue;

    let value;
    const dropped = blk.lines.length - kept.length;
    if (dropped > 0) {
      // Refill with room left for the note, so nothing is lost to it.
      kept = fill(Math.max(0, room - NOTE_RESERVE));
      const left = blk.lines.length - kept.length;
      const note = `… +${left} more`;
      value = kept.length ? `${kept.join('\n')}\n${note}` : note;
      if (value.length > room) value = value.slice(0, room);
    } else {
      value = kept.join('\n');
    }

    fields.push({ name: blk.name, value });
    budget -= blk.name.length + value.length;
  }

  // Last guard: the whole embed must stay inside Discord's limit.
  const used = () => title.length + description.length + footer.length
    + fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
  while (fields.length && used() > LIMITS.embedTotal) {
    const last = fields[fields.length - 1];
    const over = used() - LIMITS.embedTotal;
    if (last.value.length > over) {
      last.value = last.value.slice(0, last.value.length - over);
      break;
    }
    fields.pop();
  }
  if (fields.length) embed.addFields(fields);

  embed.setFooter({ text: footer });
  return embed;
}

function fmtUtc(d) {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** The dropdowns and buttons under the preview. */
export function buildComponents(session, cfg) {
  const rows = [];

  if (!session.event) {
    const pick = new StringSelectMenuBuilder()
      .setCustomId(`announce:event:${session.id}`)
      .setPlaceholder('📣 What are you announcing?')
      .addOptions(
        Object.entries(cfg.events).map(([k, e]) => ({
          label: e.label.slice(0, 100),
          value: k,
          emoji: e.emoji,
        })),
      );
    rows.push(new ActionRowBuilder().addComponents(pick));
    return rows;
  }

  const ev = cfg.events[session.event];

  // 1. Add a block
  const add = new StringSelectMenuBuilder()
    .setCustomId(`announce:add:${session.id}`)
    .setPlaceholder('➕ Add a block…')
    .addOptions(
      Object.entries(cfg.blocks).map(([k, b]) => ({
        label: b.label.slice(0, 100),
        value: k,
        emoji: b.emoji,
        description: b.hint ? b.hint.slice(0, 100) : undefined,
      })),
    );
  rows.push(new ActionRowBuilder().addComponents(add));

  // 2. Time slot
  const slotOptions = ev.slots.map((s) => ({ label: `${s} UTC`, value: `slot:${s}` }));
  slotOptions.push({ label: 'Custom time / date…', value: 'slot:custom', emoji: '🕒' });
  const slot = new StringSelectMenuBuilder()
    .setCustomId(`announce:slot:${session.id}`)
    .setPlaceholder('🕒 Set time (UTC)')
    .addOptions(slotOptions.slice(0, 25));
  rows.push(new ActionRowBuilder().addComponents(slot));

  // 3. Ping
  const pingOptions = [
    { label: '@everyone', value: 'everyone' },
    { label: '@here', value: 'here' },
    { label: 'No ping', value: 'none' },
    ...Object.keys(cfg.role_pings || {}).map((name) => ({
      label: `@${String(name).slice(0, 90)}`,
      value: `role:${name}`,
    })),
  ];
  const ping = new StringSelectMenuBuilder()
    .setCustomId(`announce:ping:${session.id}`)
    .setPlaceholder(`🔔 Ping — currently ${pingLabel(session.ping, cfg)}`)
    .addOptions(pingOptions.slice(0, 25));
  rows.push(new ActionRowBuilder().addComponents(ping));

  // 4 + 5. Buttons
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`announce:title:${session.id}`)
      .setLabel('Title')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`announce:timeopt:${session.id}`)
      .setLabel(session.timeOptional ? 'Time: optional' : 'Time: required')
      .setEmoji(session.timeOptional ? '✅' : '⏰')
      .setStyle(session.timeOptional ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`announce:undo:${session.id}`)
      .setLabel('Undo last')
      .setEmoji('↩️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`announce:clear:${session.id}`)
      .setLabel('Clear all')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Secondary),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`announce:send:${session.id}`)
      .setLabel('Send')
      .setEmoji('🚀')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`announce:cancel:${session.id}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger),
  ));

  return rows;
}

function previewPayload(session, cfg) {
  const ev = cfg.events[session.event];
  const timeState = session.start
    ? 'time set'
    : session.timeOptional
      ? 'no time (optional)'
      : 'no time yet';
  return {
    content: `**Preview** — only you can see this · type: \`${ev ? ev.label : 'not picked'}\` · ${timeState} · ping: \`${pingLabel(session.ping, cfg)}\``,
    embeds: [buildEmbed(session, cfg)],
    components: buildComponents(session, cfg),
  };
}

// ------------------------------------------------------------------
//  Modals
// ------------------------------------------------------------------
function blockModal(kind, blk, session) {
  const title = cap(`${blk.emoji} ${blk.label}`, LIMITS.modalTitle);

  if (blk.type === 'step') {
    return new ModalBuilder()
      .setCustomId(`announce-modal:step:${kind}:${session.id}`)
      .setTitle(title)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('time')
            .setLabel(cap('Time (UTC, HH:MM)', LIMITS.inputLabel))
            .setPlaceholder('06:50')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(10),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('text')
            .setLabel(cap('What happens', LIMITS.inputLabel))
            .setPlaceholder(cap(blk.hint || 'Clear the area', LIMITS.placeholder))
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000),
        ),
      );
  }

  if (blk.type === 'order') {
    return new ModalBuilder()
      .setCustomId(`announce-modal:order:${kind}:${session.id}`)
      .setTitle(title)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('text')
            .setLabel(cap('One per line: Name HH:MM-HH:MM', LIMITS.inputLabel))
            .setPlaceholder(cap('Japan 00:00-00:15\nGymSis APP — 2:29 AM', LIMITS.placeholder))
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000),
        ),
      );
  }

  return new ModalBuilder()
    .setCustomId(`announce-modal:text:${kind}:${session.id}`)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('text')
          .setLabel(cap('One item per line (times as 06:50 UTC)', LIMITS.inputLabel))
          .setPlaceholder(cap(blk.hint || 'One line per bullet', LIMITS.placeholder))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000),
      ),
    );
}

function customTimeModal(session) {
  return new ModalBuilder()
    .setCustomId(`announce-modal:time:${session.id}`)
    .setTitle('Custom time (UTC)')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('start')
          .setLabel(cap('Start (UTC, HH:MM)', LIMITS.inputLabel))
          .setPlaceholder('15:00')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('end')
          .setLabel(cap('End (UTC, HH:MM) — blank = default length', LIMITS.inputLabel))
          .setPlaceholder('16:00')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(10),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('date')
          .setLabel(cap('Date YYYY-MM-DD — blank = next occurrence', LIMITS.inputLabel))
          .setPlaceholder('2026-11-13')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(10),
      ),
    );
}

function titleModal(session) {
  return new ModalBuilder()
    .setCustomId(`announce-modal:title:${session.id}`)
    .setTitle('Custom title')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('text')
          .setLabel(cap('Title (blank = default)', LIMITS.inputLabel))
          .setPlaceholder('EGG HUNT')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100)
          .setValue(session.title || ''),
      ),
    );
}

// ------------------------------------------------------------------
//  Time window
// ------------------------------------------------------------------
function setWindow(session, cfg, startStr, endStr = null, dateStr = null) {
  const ev = cfg.events[session.event];
  const { h, m } = parseHhmm(startStr);
  const now = new Date();

  let day;
  if (dateStr) {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
    if (!dm) throw new Error('Date must be YYYY-MM-DD');
    day = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]));
  } else {
    day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  let start = new Date(day + h * HOUR + m * MINUTE);
  let end = null;
  if (endStr) {
    const e = parseHhmm(endStr);
    end = new Date(day + e.h * HOUR + e.m * MINUTE);
    if (end <= start) end = new Date(end.getTime() + DAY);
  } else if (ev.dur) {
    end = new Date(start.getTime() + ev.dur * MINUTE);
  }

  // A slot that already passed today means the next occurrence.
  if (!dateStr && start <= now) {
    start = new Date(start.getTime() + DAY);
    if (end) end = new Date(end.getTime() + DAY);
  }
  session.start = start;
  session.end = end;
}

// ------------------------------------------------------------------
//  Handlers
// ------------------------------------------------------------------

/** /announce — start a builder. */
export async function handleCommand(interaction) {
  const cfg = loadConfig();
  if (!isLeader(interaction, cfg)) {
    return interaction.reply({
      content: '🔒 Leadership only. Ask an admin to grant you access with `/announce-access`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const session = getSession(interaction.guildId, interaction.user.id);
  session.event = null;
  session.title = '';
  session.start = null;
  session.end = null;
  session.items = [];
  session.ping = 'everyone';
  session.channelId = interaction.channelId;
  session.authorTag = interaction.member?.user?.displayName || interaction.user.tag;

  await interaction.reply({
    content: '📣 **New announcement** — choose the type:',
    embeds: [buildEmbed(session, cfg)],
    components: buildComponents(session, cfg),
    flags: MessageFlags.Ephemeral,
  });
}

/** Refresh the preview after a change. */
async function render(interaction, session, cfg, extra = {}) {
  const data = { ...previewPayload(session, cfg), ...extra };
  try {
    await interaction.update(data);
  } catch (err) {
    console.error('preview update failed:', err);
    try {
      await interaction.editReply(data);
    } catch (err2) {
      console.error('preview edit failed:', err2);
      // Say what went wrong instead of leaving a dead preview behind.
      const msg = `⚠️ Could not update the preview: ${err2.message}`;
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }
      } catch {
        /* interaction expired */
      }
    }
  }
}

/** Dropdown and button presses. */
export async function handleComponent(interaction) {
  const cfg = loadConfig();
  const [, action, sessionId] = interaction.customId.split(':');
  const session = [...sessions.values()].find((s) => s.id === sessionId);

  if (!session) {
    return interaction.reply({
      content: '⏳ This announcement builder has expired. Run `/announce` again.',
      flags: MessageFlags.Ephemeral,
    });
  }
  if (interaction.user.id !== session.userId) {
    return interaction.reply({
      content: '🔒 This preview belongs to someone else.',
      flags: MessageFlags.Ephemeral,
    });
  }
  session.touched = Date.now();

  try {
    switch (action) {
      case 'event': {
        const key = interaction.values[0];
        if (!cfg.events[key]) throw new Error('Unknown event type');
        session.event = key;
        session.title = '';
        session.start = null;
        session.end = null;
        session.items = [];
        // Start from the event's own setting; the leader can still flip it.
        session.timeOptional = !cfg.events[key].needs_time;
        return await render(interaction, session, cfg);
      }

      case 'add': {
        const kind = interaction.values[0];
        const blk = cfg.blocks[kind];
        if (!blk) throw new Error('Unknown block');
        if (blk.type === 'step' && !session.start && !session.timeOptional) {
          throw new Error('Set the event time first (needed to place the step on the right day), or tap **Time: optional**.');
        }
        return await interaction.showModal(blockModal(kind, blk, session));
      }

      case 'slot': {
        const raw = interaction.values[0].replace(/^slot:/, '');
        if (raw === 'custom') return await interaction.showModal(customTimeModal(session));
        setWindow(session, cfg, raw);
        return await render(interaction, session, cfg);
      }

      case 'ping': {
        session.ping = interaction.values[0];
        return await render(interaction, session, cfg);
      }

      case 'title': {
        return await interaction.showModal(titleModal(session));
      }

      case 'timeopt': {
        // Flipping to optional never wipes a time the leader already set.
        session.timeOptional = !session.timeOptional;
        return await render(interaction, session, cfg);
      }

      case 'undo': {
        session.items.pop();
        return await render(interaction, session, cfg);
      }

      case 'clear': {
        session.items = [];
        return await render(interaction, session, cfg);
      }

      case 'cancel': {
        dropSession(session);
        return await interaction.update({ content: 'Cancelled.', embeds: [], components: [] });
      }

      case 'send': {
        const ev = session.event ? cfg.events[session.event] : null;
        if (!ev) throw new Error('Pick an event type first.');
        if (ev.needs_time && !session.timeOptional && !session.start) {
          throw new Error('Set the time first — or tap **Time: optional** if this one has no fixed time.');
        }

        const targetId = cfg.channel_id || session.channelId;
        const target = await interaction.client.channels.fetch(targetId).catch(() => null);
        if (!target || !target.isTextBased()) throw new Error('Announcement channel not found.');

        const ping = pingContent(session, cfg);
        await target.send({
          content: ping.content || undefined,
          embeds: [buildEmbed(session, cfg)],
          allowedMentions: ping.allowedMentions,
        });

        dropSession(session);
        return await interaction.update({
          content: `✅ Sent to ${target.mention}`,
          embeds: [],
          components: [],
        });
      }

      default:
        throw new Error('Unknown action');
    }
  } catch (err) {
    console.error(`interaction failed: ${err.message}`);
    const msg = `⚠️ ${err.message}`;
    if (interaction.replied || interaction.deferred) {
      return interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
  }
}

/** Modal submissions. */
export async function handleModal(interaction) {
  const cfg = loadConfig();
  const parts = interaction.customId.split(':');
  const kind = parts[1];
  const session = [...sessions.values()].find((s) => s.id === parts[parts.length - 1]);

  if (!session) {
    return interaction.reply({
      content: '⏳ This announcement builder has expired. Run `/announce` again.',
      flags: MessageFlags.Ephemeral,
    });
  }
  if (interaction.user.id !== session.userId) {
    return interaction.reply({
      content: '🔒 This preview belongs to someone else.',
      flags: MessageFlags.Ephemeral,
    });
  }
  session.touched = Date.now();

  const ref = session.start || new Date();

  try {
    if (kind === 'time') {
      setWindow(
        session, cfg,
        interaction.fields.getTextInputValue('start'),
        interaction.fields.getTextInputValue('end') || null,
        interaction.fields.getTextInputValue('date') || null,
      );
    } else if (kind === 'title') {
      session.title = interaction.fields.getTextInputValue('text').trim();
    } else if (kind === 'step') {
      const blockKind = parts[2];
      const { h, m } = parseHhmm(interaction.fields.getTextInputValue('time'));
      // With no event time, anchor the step to today instead of the event day.
      const anchor = session.start || ref;
      const when = nearest(anchor, h, m);
      const what = convertUtc(interaction.fields.getTextInputValue('text').trim(), ref);
      session.items.push({ kind: blockKind, text: `${ts(when, 'f')} — ${what}` });
    } else if (kind === 'order') {
      const blockKind = parts[2];
      // Slot times are offsets from the event start ("00:00-00:15" = first 15 min).
      const base = session.start || ref;
      for (const raw of interaction.fields.getTextInputValue('text').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const mt = ORDER_LINE.exec(line);
        const so = mt ? parseSlotTime(mt[2]) : null;
        const eo = mt && mt[3] ? parseSlotTime(mt[3]) : null;
        if (!mt || so === null || (mt[3] && eo === null)) {
          // Not a slot line — keep it as written.
          session.items.push({ kind: blockKind, text: convertUtc(line, ref) });
          continue;
        }
        const name = mt[1].trim();
        const s = new Date(base.getTime() + so * MINUTE);
        if (eo === null) {
          session.items.push({ kind: blockKind, text: `**${name}**: ${ts(s, 't')}` });
          continue;
        }
        let end = eo;
        if (end <= so) end += 24 * 60;
        const e = new Date(base.getTime() + end * MINUTE);
        session.items.push({ kind: blockKind, text: `**${name}**: ${ts(s, 't')} – ${ts(e, 't')}` });
      }
    } else if (kind === 'text') {
      const blockKind = parts[2];
      for (const raw of interaction.fields.getTextInputValue('text').split(/\r?\n/)) {
        const line = raw.trim();
        if (line) session.items.push({ kind: blockKind, text: convertUtc(line, ref) });
      }
    } else {
      throw new Error('Unknown modal');
    }

    return await render(interaction, session, cfg);
  } catch (err) {
    console.error(`interaction failed: ${err.message}`);
    const msg = `⚠️ ${err.message}`;
    if (interaction.replied || interaction.deferred) {
      return interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
  }
}
