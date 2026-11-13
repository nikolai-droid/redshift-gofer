// ===================================================================
//  /announce-access — admin controls for the announcement builder
//
//  Lets a server admin decide who may use /announce, which roles can
//  be pinged from the Ping dropdown, and which channel announcements
//  are posted to — without editing announce_config.json by hand.
//
//  Everything is stored in announce_config.json next to the bot.
// ===================================================================
import { SlashCommandBuilder } from 'discord.js';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { loadConfig, saveConfig } from './announce.js';

export const ACCESS_COMMAND = new SlashCommandBuilder()
  .setName('announce-access')
  .setDescription('Manage who can use /announce, ping roles, and the posting channel.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((opt) =>
    opt
      .setName('action')
      .setDescription('What to change')
      .setRequired(true)
      .addChoices(
        { name: 'Grant leader role', value: 'leader-add' },
        { name: 'Revoke leader role', value: 'leader-remove' },
        { name: 'List leader roles', value: 'leader-list' },
        { name: 'Add ping role', value: 'ping-add' },
        { name: 'Remove ping role', value: 'ping-remove' },
        { name: 'List ping roles', value: 'ping-list' },
        { name: 'Set posting channel', value: 'channel-set' },
        { name: 'Reset posting channel', value: 'channel-reset' },
      ))
  .addRoleOption((opt) =>
    opt
      .setName('role')
      .setDescription('The role to grant, revoke, or add as a ping option'))
  .addChannelOption((opt) =>
    opt
      .setName('channel')
      .setDescription('Where announcements get posted')
      .addChannelTypes(0, 5, 10, 11, 12));

/** Turn a role ID list into readable @mentions, resolving names where possible. */
async function describeRoles(guild, ids) {
  if (!ids.length) return '*(none)*';
  const lines = [];
  for (const id of ids) {
    const role = await guild.roles.fetch(id).catch(() => null);
    lines.push(role ? `• ${role} (\`${id}\`)` : `• \`${id}\` *(deleted role)*`);
  }
  return lines.join('\n');
}

/** Handle the /announce-access command. */
export async function handleAccessCommand(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: '🔒 You need **Manage Server** to change these settings.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const cfg = loadConfig();
  const action = interaction.options.getString('action');
  const role = interaction.options.getRole('role');
  const channel = interaction.options.getChannel('channel');

  const save = (msg) => {
    saveConfig(cfg);
    return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
  };

  switch (action) {
    case 'leader-add': {
      if (!role) return interaction.reply({ content: '⚠️ Pick a role to grant.', flags: MessageFlags.Ephemeral });
      if (cfg.leader_role_ids.includes(role.id)) {
        return interaction.reply({ content: `⚠️ ${role} already has access.`, flags: MessageFlags.Ephemeral });
      }
      cfg.leader_role_ids.push(role.id);
      return save(`✅ ${role} can now use \`/announce\`.`);
    }

    case 'leader-remove': {
      if (!role) return interaction.reply({ content: '⚠️ Pick a role to revoke.', flags: MessageFlags.Ephemeral });
      if (!cfg.leader_role_ids.includes(role.id)) {
        return interaction.reply({ content: `⚠️ ${role} did not have access.`, flags: MessageFlags.Ephemeral });
      }
      cfg.leader_role_ids = cfg.leader_role_ids.filter((id) => id !== role.id);
      return save(`✅ ${role} can no longer use \`/announce\`.`);
    }

    case 'leader-list': {
      const list = await describeRoles(interaction.guild, cfg.leader_role_ids);
      return interaction.reply({
        content: `👑 **Roles that can use \`/announce\`**\n${list}\n\nAnyone with **Manage Server** can always use it.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    case 'ping-add': {
      if (!role) return interaction.reply({ content: '⚠️ Pick a role to add as a ping option.', flags: MessageFlags.Ephemeral });
      const name = role.name;
      if (cfg.role_pings[name] === role.id) {
        return interaction.reply({ content: `⚠️ ${role} is already a ping option.`, flags: MessageFlags.Ephemeral });
      }
      // A renamed role keeps its old label; make sure names stay unique.
      for (const [existing, id] of Object.entries(cfg.role_pings)) {
        if (id === role.id) delete cfg.role_pings[existing];
      }
      cfg.role_pings[name] = role.id;
      return save(`✅ ${role} is now available in the Ping dropdown.`);
    }

    case 'ping-remove': {
      if (!role) return interaction.reply({ content: '⚠️ Pick a role to remove.', flags: MessageFlags.Ephemeral });
      const entries = Object.entries(cfg.role_pings);
      const hit = entries.find(([, id]) => id === role.id);
      if (!hit) return interaction.reply({ content: `⚠️ ${role} is not a ping option.`, flags: MessageFlags.Ephemeral });
      delete cfg.role_pings[hit[0]];
      return save(`✅ ${role} removed from the Ping dropdown.`);
    }

    case 'ping-list': {
      const entries = Object.entries(cfg.role_pings);
      if (!entries.length) {
        return interaction.reply({
          content: '🔔 **Ping roles**\n*(none)*\n\nUse `/announce-access action:Add ping role` to add one.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const lines = [];
      for (const [name, id] of entries) {
        const r = await interaction.guild.roles.fetch(id).catch(() => null);
        lines.push(r ? `• @${name} — ${r}` : `• @${name} — \`${id}\` *(deleted role)*`);
      }
      return interaction.reply({
        content: `🔔 **Ping roles**\n${lines.join('\n')}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    case 'channel-set': {
      if (!channel) return interaction.reply({ content: '⚠️ Pick a channel.', flags: MessageFlags.Ephemeral });
      if (!channel.isTextBased()) {
        return interaction.reply({ content: '⚠️ That channel cannot receive messages.', flags: MessageFlags.Ephemeral });
      }
      cfg.channel_id = channel.id;
      return save(`✅ Announcements will be posted to ${channel}.`);
    }

    case 'channel-reset': {
      cfg.channel_id = null;
      return save('✅ Announcements will be posted in the channel where `/announce` was used.');
    }

    default:
      return interaction.reply({ content: '⚠️ Unknown action.', flags: MessageFlags.Ephemeral });
  }
}
