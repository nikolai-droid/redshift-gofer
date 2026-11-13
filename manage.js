// ===================================================================
//  /announce-config — admin controls for the announcement content
//
//  Lets a server admin add or remove event types, change their time
//  slots, and add or remove content blocks — all from inside Discord.
//
//  Everything is written to announce_config.json next to the bot and
//  takes effect on the next /announce, with no restart.
// ===================================================================
import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { loadConfig, saveConfig, parseHhmm } from './announce.js';

// ------------------------------------------------------------------
//  Command definition
// ------------------------------------------------------------------
const EVENT_NAME = {
  name: 'event',
  description: 'The event to change',
  required: true,
  autocomplete: true,
};

const BLOCK_NAME = {
  name: 'block',
  description: 'The block to change',
  required: true,
  autocomplete: true,
};

export const CONFIG_COMMAND = new SlashCommandBuilder()
  .setName('announce-config')
  .setDescription('Add or remove events, time slots, and content blocks.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

  // ---- events ----
  .addSubcommandGroup((group) =>
    group
      .setName('event')
      .setDescription('Event types you can announce')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Create a new event type')
          .addStringOption((opt) =>
            opt.setName('key').setDescription('Short id, e.g. holy_city').setRequired(true).setMaxLength(40))
          .addStringOption((opt) =>
            opt.setName('label').setDescription('Shown in the menu, e.g. Holy City').setMaxLength(100))
          .addStringOption((opt) =>
            opt.setName('emoji').setDescription('Emoji for the menu, e.g. 🏛️').setMaxLength(8))
          .addStringOption((opt) =>
            opt.setName('color').setDescription('Embed colour as #RRGGBB').setMaxLength(9))
          .addStringOption((opt) =>
            opt.setName('slots').setDescription('Time slots in UTC, comma separated: 05:00, 13:00').setMaxLength(200))
          .addIntegerOption((opt) =>
            opt.setName('duration').setDescription('Event length in minutes (0 = no end time)').setMinValue(0).setMaxValue(1440))
          .addBooleanOption((opt) =>
            opt.setName('needs_time').setDescription('Require a time before posting. Default: true')))
      .addSubcommand((sub) =>
        sub
          .setName('edit')
          .setDescription('Change an event type')
          .addStringOption((opt) =>
            opt.setName('event').setDescription('The event to change').setRequired(true).setAutocomplete(true))
          .addStringOption((opt) =>
            opt.setName('label').setDescription('New label').setMaxLength(100))
          .addStringOption((opt) =>
            opt.setName('emoji').setDescription('New emoji').setMaxLength(8))
          .addStringOption((opt) =>
            opt.setName('color').setDescription('New embed colour as #RRGGBB').setMaxLength(9))
          .addIntegerOption((opt) =>
            opt.setName('duration').setDescription('New length in minutes (0 = no end time)').setMinValue(0).setMaxValue(1440))
          .addBooleanOption((opt) =>
            opt.setName('needs_time').setDescription('Require a time before posting')))
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Delete an event type')
          .addStringOption((opt) =>
            opt.setName('event').setDescription('The event to delete').setRequired(true).setAutocomplete(true)))
      .addSubcommand((sub) =>
        sub
          .setName('slots')
          .setDescription('Set the full list of time slots for an event')
          .addStringOption((opt) =>
            opt.setName('event').setDescription('The event to change').setRequired(true).setAutocomplete(true))
          .addStringOption((opt) =>
            opt.setName('slots').setDescription('All slots in UTC, comma separated: 05:00, 13:00, 21:00').setRequired(true).setMaxLength(200)))
      .addSubcommand((sub) =>
        sub
          .setName('slot-add')
          .setDescription('Add one time slot to an event')
          .addStringOption((opt) =>
            opt.setName('event').setDescription('The event to change').setRequired(true).setAutocomplete(true))
          .addStringOption((opt) =>
            opt.setName('time').setDescription('Time in UTC, e.g. 21:00').setRequired(true).setMaxLength(10)))
      .addSubcommand((sub) =>
        sub
          .setName('slot-remove')
          .setDescription('Remove one time slot from an event')
          .addStringOption((opt) =>
            opt.setName('event').setDescription('The event to change').setRequired(true).setAutocomplete(true))
          .addStringOption((opt) =>
            opt.setName('time').setDescription('Time in UTC, e.g. 21:00').setRequired(true).setMaxLength(10)))
      .addSubcommand((sub) =>
        sub
          .setName('list')
          .setDescription('Show every event with its slots and time rule')))

  // ---- blocks ----
  .addSubcommandGroup((group) =>
    group
      .setName('block')
      .setDescription('Content blocks that appear in the post')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Create a new content block')
          .addStringOption((opt) =>
            opt.setName('key').setDescription('Short id, e.g. rewards').setRequired(true).setMaxLength(40))
          .addStringOption((opt) =>
            opt.setName('type').setDescription('How it is filled in').setRequired(true).addChoices(
              { name: 'Text — one bullet per line', value: 'text' },
              { name: 'Step — a UTC time plus text', value: 'step' },
              { name: 'Order — name plus time range', value: 'order' },
            ))
          .addStringOption((opt) =>
            opt.setName('label').setDescription('Shown in the menu, e.g. Rewards').setMaxLength(100))
          .addStringOption((opt) =>
            opt.setName('emoji').setDescription('Emoji for the menu, e.g. 🎁').setMaxLength(8))
          .addStringOption((opt) =>
            opt.setName('section').setDescription('Heading in the post, e.g. 🎁 Rewards').setMaxLength(100))
          .addStringOption((opt) =>
            opt.setName('hint').setDescription('Placeholder text in the input box').setMaxLength(100)))
      .addSubcommand((sub) =>
        sub
          .setName('edit')
          .setDescription('Change a content block')
          .addStringOption((opt) =>
            opt.setName('block').setDescription('The block to change').setRequired(true).setAutocomplete(true))
          .addStringOption((opt) =>
            opt.setName('label').setDescription('New label').setMaxLength(100))
          .addStringOption((opt) =>
            opt.setName('emoji').setDescription('New emoji').setMaxLength(8))
          .addStringOption((opt) =>
            opt.setName('section').setDescription('New heading in the post').setMaxLength(100))
          .addStringOption((opt) =>
            opt.setName('type').setDescription('How it is filled in').addChoices(
              { name: 'Text — one bullet per line', value: 'text' },
              { name: 'Step — a UTC time plus text', value: 'step' },
              { name: 'Order — name plus time range', value: 'order' },
            ))
          .addStringOption((opt) =>
            opt.setName('hint').setDescription('New placeholder text').setMaxLength(100)))
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Delete a content block')
          .addStringOption((opt) =>
            opt.setName('block').setDescription('The block to delete').setRequired(true).setAutocomplete(true)))
      .addSubcommand((sub) =>
        sub
          .setName('list')
          .setDescription('Show every content block')));

// ------------------------------------------------------------------
//  Helpers
// ------------------------------------------------------------------

/** Turn "holy city" or "HolyCity" into a safe key. */
function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/** Parse "05:00, 13:00" into ["05:00", "13:00"]. Throws on a bad time. */
function parseSlots(raw) {
  const parts = String(raw).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Give at least one time, e.g. "05:00, 13:00".');
  const out = [];
  for (const part of parts) {
    const { h, m } = parseHhmm(part);
    const norm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (!out.includes(norm)) out.push(norm);
  }
  if (out.length > 24) throw new Error('That is more than 24 slots — Discord menus top out at 25 options.');
  return out;
}

/** Parse "#RRGGBB" into a number. */
function parseColor(raw) {
  const hex = String(raw).trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) throw new Error('Colour must look like #7C3AED.');
  return parseInt(hex, 16);
}

/** Fetch an event by key or by label, so "dragon" and "Dragon Round" both work. */
function findEvent(cfg, query) {
  const q = String(query).trim().toLowerCase();
  if (cfg.events[q]) return [q, cfg.events[q]];
  const byLabel = Object.entries(cfg.events).find(
    ([, e]) => e.label.toLowerCase() === q || slugify(e.label) === slugify(q),
  );
  return byLabel || null;
}

/** Fetch a block by key or by label. */
function findBlock(cfg, query) {
  const q = String(query).trim().toLowerCase();
  if (cfg.blocks[q]) return [q, cfg.blocks[q]];
  const byLabel = Object.entries(cfg.blocks).find(
    ([, b]) => b.label.toLowerCase() === q || slugify(b.label) === slugify(q),
  );
  return byLabel || null;
}

// ------------------------------------------------------------------
//  Autocomplete — event and block pickers
// ------------------------------------------------------------------
export async function handleAutocomplete(interaction) {
  const cfg = loadConfig();
  const focused = interaction.options.getFocused(true);
  const query = String(focused.value || '').toLowerCase();

  let choices = [];
  if (focused.name === 'event') {
    choices = Object.entries(cfg.events).map(([key, e]) => ({
      name: `${e.emoji} ${e.label}`.slice(0, 100),
      value: key,
    }));
  } else if (focused.name === 'block') {
    choices = Object.entries(cfg.blocks).map(([key, b]) => ({
      name: `${b.emoji} ${b.label}`.slice(0, 100),
      value: key,
    }));
  }

  const filtered = choices
    .filter((c) => c.name.toLowerCase().includes(query) || c.value.toLowerCase().includes(query))
    .slice(0, 25);

  await interaction.respond(filtered);
}

// ------------------------------------------------------------------
//  Main handler
// ------------------------------------------------------------------
export async function handleConfigCommand(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: '🔒 You need **Manage Server** to change these settings.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const cfg = loadConfig();
  const group = interaction.options.getSubcommandGroup();
  const sub = interaction.options.getSubcommand();

  const done = (msg) => {
    saveConfig(cfg);
    return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
  };

  // ---- event list ----
  if (group === 'event' && sub === 'list') {
    const entries = Object.entries(cfg.events);
    if (!entries.length) {
      return interaction.reply({ content: '📋 **No events yet.** Add one with `/announce-config event add`.', flags: MessageFlags.Ephemeral });
    }
    const lines = [];
    for (const [key, ev] of entries) {
      const slots = ev.slots.length ? ev.slots.join(', ') : 'none (custom time only)';
      const dur = ev.dur ? `${ev.dur} min` : 'no fixed end';
      const timeRule = ev.needs_time ? 'time required' : 'time optional';
      lines.push(`${ev.emoji} **${ev.label}** \`${key}\`\n   slots: ${slots}\n   length: ${dur} · ${timeRule}`);
    }
    return interaction.reply({
      content: `📋 **Events**\n${lines.join('\n')}\n\nChange one with \`/announce-config event edit\` or \`event slots\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // ---- event add ----
  if (group === 'event' && sub === 'add') {
    const rawKey = interaction.options.getString('key');
    const key = slugify(rawKey);
    if (!key) return interaction.reply({ content: '⚠️ That key has no usable characters. Use letters and numbers.', flags: MessageFlags.Ephemeral });
    if (cfg.events[key]) {
      return interaction.reply({ content: `⚠️ An event called \`${key}\` already exists. Use \`event edit\` instead.`, flags: MessageFlags.Ephemeral });
    }

    let slots = [];
    if (interaction.options.getString('slots')) {
      try {
        slots = parseSlots(interaction.options.getString('slots'));
      } catch (err) {
        return interaction.reply({ content: `⚠️ ${err.message}`, flags: MessageFlags.Ephemeral });
      }
    }

    let color = 0x95a5a6;
    if (interaction.options.getString('color')) {
      try {
        color = parseColor(interaction.options.getString('color'));
      } catch (err) {
        return interaction.reply({ content: `⚠️ ${err.message}`, flags: MessageFlags.Ephemeral });
      }
    }

    const label = interaction.options.getString('label') || rawKey;
    const emoji = interaction.options.getString('emoji') || '📣';
    const duration = interaction.options.getInteger('duration') ?? 60;
    const needsTime = interaction.options.getBoolean('needs_time') ?? true;

    cfg.events[key] = { label, emoji, color, slots, dur: duration, needs_time: needsTime };
    return done(
      `✅ Added **${emoji} ${label}** (\`${key}\`).\n`
      + `Slots: ${slots.length ? slots.join(', ') : '*none — use the Custom time option*'}\n`
      + `Duration: ${duration ? `${duration} min` : 'no fixed end'} · time required: ${needsTime ? 'yes' : 'no'}\n\n`
      + `It appears in the /announce menu straight away.`,
    );
  }

  // ---- event edit ----
  if (group === 'event' && sub === 'edit') {
    const found = findEvent(cfg, interaction.options.getString('event'));
    if (!found) return interaction.reply({ content: '⚠️ No event with that name.', flags: MessageFlags.Ephemeral });
    const [, ev] = found;
    const changes = [];

    const label = interaction.options.getString('label');
    if (label) { ev.label = label; changes.push(`label → ${label}`); }

    const emoji = interaction.options.getString('emoji');
    if (emoji) { ev.emoji = emoji; changes.push(`emoji → ${emoji}`); }

    const colorRaw = interaction.options.getString('color');
    if (colorRaw) {
      try {
        ev.color = parseColor(colorRaw);
        changes.push(`colour → ${colorRaw}`);
      } catch (err) {
        return interaction.reply({ content: `⚠️ ${err.message}`, flags: MessageFlags.Ephemeral });
      }
    }

    const duration = interaction.options.getInteger('duration');
    if (duration !== null) { ev.dur = duration; changes.push(`duration → ${duration ? `${duration} min` : 'no fixed end'}`); }

    const needsTime = interaction.options.getBoolean('needs_time');
    if (needsTime !== null) { ev.needs_time = needsTime; changes.push(`time required → ${needsTime ? 'yes' : 'no'}`); }

    if (!changes.length) return interaction.reply({ content: '⚠️ Nothing to change — set at least one field.', flags: MessageFlags.Ephemeral });
    return done(`✅ Updated **${ev.emoji} ${ev.label}**\n${changes.map((c) => `• ${c}`).join('\n')}`);
  }

  // ---- event remove ----
  if (group === 'event' && sub === 'remove') {
    const found = findEvent(cfg, interaction.options.getString('event'));
    if (!found) return interaction.reply({ content: '⚠️ No event with that name.', flags: MessageFlags.Ephemeral });
    const [key, ev] = found;
    delete cfg.events[key];
    return done(`🗑️ Removed **${ev.emoji} ${ev.label}** (\`${key}\`).`);
  }

  // ---- event slots (replace) ----
  if (group === 'event' && sub === 'slots') {
    const found = findEvent(cfg, interaction.options.getString('event'));
    if (!found) return interaction.reply({ content: '⚠️ No event with that name.', flags: MessageFlags.Ephemeral });
    const [key, ev] = found;
    let slots;
    try {
      slots = parseSlots(interaction.options.getString('slots'));
    } catch (err) {
      return interaction.reply({ content: `⚠️ ${err.message}`, flags: MessageFlags.Ephemeral });
    }
    ev.slots = slots;
    return done(`🕒 **${ev.label}** now has ${slots.length} slot${slots.length === 1 ? '' : 's'}: ${slots.join(', ')}`);
  }

  // ---- event slot-add ----
  if (group === 'event' && sub === 'slot-add') {
    const found = findEvent(cfg, interaction.options.getString('event'));
    if (!found) return interaction.reply({ content: '⚠️ No event with that name.', flags: MessageFlags.Ephemeral });
    const [key, ev] = found;
    let slots;
    try {
      slots = parseSlots(interaction.options.getString('time'));
    } catch (err) {
      return interaction.reply({ content: `⚠️ ${err.message}`, flags: MessageFlags.Ephemeral });
    }
    for (const s of slots) if (!ev.slots.includes(s)) ev.slots.push(s);
    ev.slots.sort();
    return done(`🕒 **${ev.label}** now has ${ev.slots.length} slot${ev.slots.length === 1 ? '' : 's'}: ${ev.slots.join(', ')}`);
  }

  // ---- event slot-remove ----
  if (group === 'event' && sub === 'slot-remove') {
    const found = findEvent(cfg, interaction.options.getString('event'));
    if (!found) return interaction.reply({ content: '⚠️ No event with that name.', flags: MessageFlags.Ephemeral });
    const [key, ev] = found;
    let slots;
    try {
      slots = parseSlots(interaction.options.getString('time'));
    } catch (err) {
      return interaction.reply({ content: `⚠️ ${err.message}`, flags: MessageFlags.Ephemeral });
    }
    const before = ev.slots.length;
    ev.slots = ev.slots.filter((s) => !slots.includes(s));
    if (ev.slots.length === before) {
      return interaction.reply({ content: `⚠️ **${ev.label}** did not have ${slots.join(' or ')}.`, flags: MessageFlags.Ephemeral });
    }
    return done(`🕒 **${ev.label}** now has ${ev.slots.length} slot${ev.slots.length === 1 ? '' : 's'}: ${ev.slots.join(', ') || 'none'}`);
  }

  // ---- block list ----
  if (group === 'block' && sub === 'list') {
    const entries = Object.entries(cfg.blocks);
    if (!entries.length) {
      return interaction.reply({ content: '📋 **No blocks yet.** Add one with `/announce-config block add`.', flags: MessageFlags.Ephemeral });
    }
    const typeNames = { text: 'text', step: 'timed step', order: 'slot order' };
    const lines = [];
    for (const [key, b] of entries) {
      lines.push(`${b.emoji} **${b.label}** \`${key}\` — ${typeNames[b.type] || b.type}\n   heading: ${b.section}`);
    }
    return interaction.reply({
      content: `📋 **Content blocks**\n${lines.join('\n')}\n\nChange one with \`/announce-config block edit\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // ---- block add ----
  if (group === 'block' && sub === 'add') {
    const rawKey = interaction.options.getString('key');
    const key = slugify(rawKey);
    if (!key) return interaction.reply({ content: '⚠️ That key has no usable characters. Use letters and numbers.', flags: MessageFlags.Ephemeral });
    if (cfg.blocks[key]) {
      return interaction.reply({ content: `⚠️ A block called \`${key}\` already exists. Use \`block edit\` instead.`, flags: MessageFlags.Ephemeral });
    }

    const label = interaction.options.getString('label') || rawKey;
    const emoji = interaction.options.getString('emoji') || '📝';
    const type = interaction.options.getString('type');
    const hint = interaction.options.getString('hint') || '';
    const section = interaction.options.getString('section') || `${emoji} ${label}`;

    cfg.blocks[key] = { label, emoji, section, hint, type };
    return done(
      `✅ Added block **${emoji} ${label}** (\`${key}\`).\n`
      + `Heading in post: ${section}\n`
      + `Type: ${type}\n\n`
      + `It appears in the "Add a block" menu straight away.`,
    );
  }

  // ---- block edit ----
  if (group === 'block' && sub === 'edit') {
    const found = findBlock(cfg, interaction.options.getString('block'));
    if (!found) return interaction.reply({ content: '⚠️ No block with that name.', flags: MessageFlags.Ephemeral });
    const [, blk] = found;
    const changes = [];

    const label = interaction.options.getString('label');
    if (label) { blk.label = label; changes.push(`label → ${label}`); }

    const emoji = interaction.options.getString('emoji');
    if (emoji) { blk.emoji = emoji; changes.push(`emoji → ${emoji}`); }

    const section = interaction.options.getString('section');
    if (section) { blk.section = section; changes.push(`heading → ${section}`); }

    const type = interaction.options.getString('type');
    if (type) { blk.type = type; changes.push(`type → ${type}`); }

    const hint = interaction.options.getString('hint');
    if (hint !== null) { blk.hint = hint; changes.push('hint updated'); }

    if (!changes.length) return interaction.reply({ content: '⚠️ Nothing to change — set at least one field.', flags: MessageFlags.Ephemeral });
    return done(`✅ Updated block **${blk.emoji} ${blk.label}**\n${changes.map((c) => `• ${c}`).join('\n')}`);
  }

  // ---- block remove ----
  if (group === 'block' && sub === 'remove') {
    const found = findBlock(cfg, interaction.options.getString('block'));
    if (!found) return interaction.reply({ content: '⚠️ No block with that name.', flags: MessageFlags.Ephemeral });
    const [key, blk] = found;
    delete cfg.blocks[key];
    return done(`🗑️ Removed block **${blk.emoji} ${blk.label}** (\`${key}\`).`);
  }

  return interaction.reply({ content: '⚠️ Unknown command.', flags: MessageFlags.Ephemeral });
}
