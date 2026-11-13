// Offline smoke test for the announcement builder.
// Fakes Discord interactions and walks the full flow:
//   /announce -> pick event -> set time -> add blocks -> ping -> undo -> send
import { loadConfig, saveConfig, buildEmbed, buildComponents, handleCommand, handleComponent, handleModal, parseHhmm } from './announce.js';
import { handleAccessCommand } from './access.js';

const ROLE_ID = '111111111111111111';

// Start from a clean config so the test is deterministic.
const base = loadConfig();
base.leader_role_ids = [];
base.role_pings = {};
base.channel_id = null;
saveConfig(base);

function fakeInteraction(kind, opts = {}) {
  const log = [];
  const it = {
    kind,
    user: { id: opts.userId || '222222222222222222', tag: 'Leader#1' },
    member: { user: { displayName: 'Leader' }, roles: { cache: new Map([[ROLE_ID, { id: ROLE_ID }]]) } },
    memberPermissions: { has: () => opts.manageGuild === true },
    guildId: '999999999999999999',
    channelId: '333333333333333333',
    guild: { roles: { fetch: async () => ({ id: ROLE_ID, name: 'War Captain', toString: () => '@War Captain' }) } },
    client: { channels: { fetch: async (id) => ({ id, isTextBased: () => true, mention: '<#333333333333333333>', send: async (p) => { log.push({ sent: true, id, ping: p.content, mentions: p.allowedMentions }); } }) } },
    options: {
      getString: () => opts.action,
      getRole: () => opts.role ?? null,
      getChannel: () => opts.channel ?? null,
    },
    values: opts.values ?? [],
    customId: opts.customId,
    fields: { getTextInputValue: (n) => (opts.fields ?? {})[n] ?? '' },
    replied: false,
    deferred: false,
    reply: async (p) => { it.replied = true; log.push({ reply: p }); },
    update: async (p) => { it.replied = true; log.push({ update: p }); },
    editReply: async (p) => { log.push({ editReply: p }); },
    followUp: async (p) => { log.push({ followUp: p }); },
    showModal: async (m) => { log.push({ modal: m.data.custom_id, title: m.data.title, json: m.toJSON() }); },
    _log: log,
  };
  return it;
}

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

// --- config round trip -----------------------------------------------------
const cfg = loadConfig();
cfg.leader_role_ids = [ROLE_ID];
cfg.role_pings = { 'War Captain': ROLE_ID };
saveConfig(cfg);
const reloaded = loadConfig();
check('config persists leader roles', reloaded.leader_role_ids.includes(ROLE_ID));
check('config persists ping roles', reloaded.role_pings['War Captain'] === ROLE_ID);
check('config persists events', Object.keys(reloaded.events).length === 8);

// Reset access so gating can be tested from a known state.
const clean = loadConfig();
clean.leader_role_ids = [];
clean.role_pings = {};
saveConfig(clean);

// --- leader gating ---------------------------------------------------------
const notLeader = fakeInteraction('command');
await handleCommand(notLeader);
check('non-leader is refused', notLeader.replied && /Leadership only/.test(notLeader._log[0].reply.content));

// Grant access through the access command, exactly as an admin would.
const grant = fakeInteraction('command', {
  manageGuild: true,
  action: 'leader-add',
  role: { id: ROLE_ID, name: 'War Captain', toString: () => '@War Captain' },
});
await handleAccessCommand(grant);
check('access grants a leader role', grant.replied && /can now use/.test(grant._log[0].reply.content));

const addPing = fakeInteraction('command', {
  manageGuild: true,
  action: 'ping-add',
  role: { id: ROLE_ID, name: 'War Captain', toString: () => '@War Captain' },
});
await handleAccessCommand(addPing);
check('access adds a ping role', addPing.replied && /Ping dropdown/.test(addPing._log[0].reply.content));

const listLeaders = fakeInteraction('command', { manageGuild: true, action: 'leader-list' });
await handleAccessCommand(listLeaders);
check('access lists leader roles', listLeaders.replied && /Roles that can use/.test(listLeaders._log[0].reply.content));

const listPings = fakeInteraction('command', { manageGuild: true, action: 'ping-list' });
await handleAccessCommand(listPings);
check('access lists ping roles', listPings.replied && /Ping roles/.test(listPings._log[0].reply.content));

const noPerm = fakeInteraction('command', { manageGuild: false, action: 'leader-add' });
await handleAccessCommand(noPerm);
check('access needs Manage Server', noPerm.replied && /Manage Server/.test(noPerm._log[0].reply.content));

const revoke = fakeInteraction('command', {
  manageGuild: true,
  action: 'leader-remove',
  role: { id: ROLE_ID, name: 'War Captain', toString: () => '@War Captain' },
});
await handleAccessCommand(revoke);
check('access revokes a leader role', revoke.replied && /can no longer use/.test(revoke._log[0].reply.content));

// Re-grant for the rest of the flow.
await handleAccessCommand(fakeInteraction('command', {
  manageGuild: true,
  action: 'leader-add',
  role: { id: ROLE_ID, name: 'War Captain', toString: () => '@War Captain' },
}));

// --- start the builder -----------------------------------------------------
const leader = fakeInteraction('command');
await handleCommand(leader);
check('leader gets the event picker', leader.replied && leader._log[0].reply.components.length === 1);

// The real session id comes from the custom id of the rendered component.
const sessionId = leader._log[0].reply.components[0].components[0].data.custom_id.split(':')[2];
check('session id is issued', !!sessionId, sessionId);

// --- pick an event ---------------------------------------------------------
const pick = fakeInteraction('component', { customId: `announce:event:${sessionId}`, values: ['dragon'] });
await handleComponent(pick);
check('event selection re-renders', pick._log.some((e) => e.update));

// --- set a time slot -------------------------------------------------------
const slot = fakeInteraction('component', { customId: `announce:slot:${sessionId}`, values: ['slot:08:00'] });
await handleComponent(slot);
check('time slot accepted', slot._log.some((e) => e.update));

// --- add a text block ------------------------------------------------------
const addText = fakeInteraction('component', { customId: `announce:add:${sessionId}`, values: ['objective'] });
await handleComponent(addText);
check('add block opens a modal', addText._log.some((e) => e.modal?.startsWith('announce-modal:text:')));

const submitText = fakeInteraction('modal', {
  customId: `announce-modal:text:objective:${sessionId}`,
  fields: { text: 'Attack Gleem at 06:50 UTC\nDefend Gloom' },
});
await handleModal(submitText);
check('text block submits', submitText._log.some((e) => e.update));

// --- add a timed step ------------------------------------------------------
const addStep = fakeInteraction('component', { customId: `announce:add:${sessionId}`, values: ['step'] });
await handleComponent(addStep);
check('add step opens a modal', addStep._log.some((e) => e.modal?.startsWith('announce-modal:step:')));

const submitStep = fakeInteraction('modal', {
  customId: `announce-modal:step:step:${sessionId}`,
  fields: { time: '07:00', text: 'Everyone attacks together' },
});
await handleModal(submitStep);
check('step submits', submitStep._log.some((e) => e.update));

// --- add an order block ----------------------------------------------------
const addOrder = fakeInteraction('component', { customId: `announce:add:${sessionId}`, values: ['order'] });
await handleComponent(addOrder);
const submitOrder = fakeInteraction('modal', {
  customId: `announce-modal:order:order:${sessionId}`,
  fields: { text: 'Japan 00:00-00:15\nSKD 00:15-00:30' },
});
await handleModal(submitOrder);
check('order block submits', submitOrder._log.some((e) => e.update));

// --- ping a role -----------------------------------------------------------
const ping = fakeInteraction('component', { customId: `announce:ping:${sessionId}`, values: ['role:War Captain'] });
await handleComponent(ping);
check('role ping selected', ping._log.some((e) => e.update));

// --- undo ------------------------------------------------------------------
const undo = fakeInteraction('component', { customId: `announce:undo:${sessionId}` });
await handleComponent(undo);
check('undo works', undo._log.some((e) => e.update));

// --- custom time modal -----------------------------------------------------
const custom = fakeInteraction('component', { customId: `announce:slot:${sessionId}`, values: ['slot:custom'] });
await handleComponent(custom);
check('custom time opens a modal', custom._log.some((e) => e.modal === `announce-modal:time:${sessionId}`));

const submitTime = fakeInteraction('modal', {
  customId: `announce-modal:time:${sessionId}`,
  fields: { start: '15:00', end: '16:00', date: '2026-11-20' },
});
await handleModal(submitTime);
check('custom time submits', submitTime._log.some((e) => e.update));

// --- title -----------------------------------------------------------------
const title = fakeInteraction('component', { customId: `announce:title:${sessionId}` });
await handleComponent(title);
const submitTitle = fakeInteraction('modal', {
  customId: `announce-modal:title:${sessionId}`,
  fields: { text: 'Season 36 War' },
});
await handleModal(submitTitle);
check('title submits', submitTitle._log.some((e) => e.update));

// --- bad time is rejected --------------------------------------------------
const badTime = fakeInteraction('modal', {
  customId: `announce-modal:time:${sessionId}`,
  fields: { start: '99:99', end: '', date: '' },
});
await handleModal(badTime);
check('invalid time is rejected', badTime._log.some((e) => e.reply && /not a valid/.test(e.reply.content)));

// --- step before time is blocked -------------------------------------------
// A different user, because there is only one builder per user per guild.
const fresh = fakeInteraction('command');
fresh.user = { id: '333333333333333333', tag: 'Newcomer#2' };
fresh.member = { user: { displayName: 'Newcomer' }, roles: { cache: new Map([[ROLE_ID, { id: ROLE_ID }]]) } };
await handleCommand(fresh);
const freshId = fresh._log[0].reply.components[0].components[0].data.custom_id.split(':')[2];
const stepFirst = fakeInteraction('component', { customId: `announce:add:${freshId}`, values: ['step'] });
stepFirst.user = fresh.user;
stepFirst.member = fresh.member;
await handleComponent(stepFirst);
check('step before time is blocked', stepFirst._log.some((e) => e.reply && /Set the event time first/.test(e.reply.content)));

// --- time can be made optional per announcement ----------------------------
// The same fresh builder, but the leader picks an event then flips the toggle.
const freshPick = fakeInteraction('component', { customId: `announce:event:${freshId}`, values: ['dragon'] });
freshPick.user = fresh.user;
freshPick.member = fresh.member;
await handleComponent(freshPick);
check('fresh builder picks an event', freshPick._log.some((e) => e.update));

const timeOpt = fakeInteraction('component', { customId: `announce:timeopt:${freshId}` });
timeOpt.user = fresh.user;
timeOpt.member = fresh.member;
await handleComponent(timeOpt);
check('time optional toggle re-renders', timeOpt._log.some((e) => e.update));

const stepNoTime = fakeInteraction('component', { customId: `announce:add:${freshId}`, values: ['step'] });
stepNoTime.user = fresh.user;
stepNoTime.member = fresh.member;
await handleComponent(stepNoTime);
check('step is allowed once time is optional', stepNoTime._log.some((e) => e.modal?.startsWith('announce-modal:step:')));

// --- send with no time, once optional --------------------------------------
const sendNoTime = fakeInteraction('component', { customId: `announce:send:${freshId}` });
sendNoTime.user = fresh.user;
sendNoTime.member = fresh.member;
await handleComponent(sendNoTime);
const sentNoTime = sendNoTime._log.find((e) => e.sent);
check('send works without a time when optional', !!sentNoTime);

// --- but send still refuses a required time --------------------------------
const strict = fakeInteraction('command');
strict.user = { id: '444444444444444444', tag: 'Strict#3' };
strict.member = { user: { displayName: 'Strict' }, roles: { cache: new Map([[ROLE_ID, { id: ROLE_ID }]]) } };
await handleCommand(strict);
const strictId = strict._log[0].reply.components[0].components[0].data.custom_id.split(':')[2];
const strictPick = fakeInteraction('component', { customId: `announce:event:${strictId}`, values: ['dragon'] });
strictPick.user = strict.user;
strictPick.member = strict.member;
await handleComponent(strictPick);
const strictSend = fakeInteraction('component', { customId: `announce:send:${strictId}` });
strictSend.user = strict.user;
strictSend.member = strict.member;
await handleComponent(strictSend);
check('send still refuses when time is required', strictSend._log.some((e) => e.reply && /Set the time first/.test(e.reply.content)));

// --- the toggle button label reflects state --------------------------------
const optSession = { event: 'dragon', title: '', start: null, end: null, items: [], ping: 'everyone', authorTag: 'T', timeOptional: true };
const optRows = buildComponents(optSession, loadConfig());
check('toggle button shows optional state', optRows[3].components.some((b) => b.data.label === 'Time: optional'));
const reqRows = buildComponents({ ...optSession, timeOptional: false }, loadConfig());
check('toggle button shows required state', reqRows[3].components.some((b) => b.data.label === 'Time: required'));

// --- every block modal must open -----------------------------------------
// Discord rejects a modal whose input label is longer than 45 characters
// with "Invalid string length", which used to break the order block.
{
  const cfg0 = loadConfig();
  const probe = fakeInteraction('command', { userId: 'aaaa111111111111' });
  await handleCommand(probe);
  const probeId = probe._log[0].reply.components[0].components[0].data.custom_id.split(':')[2];
  const probeOpts = { userId: 'aaaa111111111111' };
  await handleComponent(fakeInteraction('component', { ...probeOpts, customId: `announce:event:${probeId}`, values: ['dragon'] }));
  await handleComponent(fakeInteraction('component', { ...probeOpts, customId: `announce:slot:${probeId}`, values: ['slot:16:00'] }));

  for (const kind of Object.keys(cfg0.blocks)) {
    const add = fakeInteraction('component', { ...probeOpts, customId: `announce:add:${probeId}`, values: [kind] });
    await handleComponent(add);
    const opened = add._log.find((e) => e.modal);
    const failed = add._log.find((e) => e.reply);
    check(`modal for "${kind}" opens`, !!opened, failed ? failed.reply.content : '');
    if (opened) {
      const m = opened.json;
      check(`modal for "${kind}" title fits`, m.title.length <= 45, `${m.title.length} chars`);
      for (const row of m.components) {
        for (const comp of row.components) {
          if (comp.type === 4) {
            check(`modal for "${kind}" label fits`, comp.label.length <= 45, `${comp.label.length} chars: ${comp.label}`);
            check(`modal for "${kind}" placeholder fits`, comp.placeholder.length <= 100);
          }
        }
      }
    }
  }
}

// --- order lines with a dash and a 12-hour clock --------------------------
{
  const cfg1 = loadConfig();
  const probe = fakeInteraction('command', { userId: 'bbbb222222222222' });
  await handleCommand(probe);
  const probeId = probe._log[0].reply.components[0].components[0].data.custom_id.split(':')[2];
  const probeOpts = { userId: 'bbbb222222222222' };
  await handleComponent(fakeInteraction('component', { ...probeOpts, customId: `announce:event:${probeId}`, values: ['dragon'] }));
  await handleComponent(fakeInteraction('component', { ...probeOpts, customId: `announce:slot:${probeId}`, values: ['slot:16:00'] }));
  const sub = fakeInteraction('modal', {
    ...probeOpts,
    customId: `announce-modal:order:order:${probeId}`,
    fields: { text: 'GymSis APP — 2:29 AM\nJapan 00:00-00:15' },
  });
  await handleModal(sub);
  const upd = sub._log.find((e) => e.update);
  check('order with dash and AM/PM submits', !!upd, sub._log.find((e) => e.reply)?.reply?.content);
  if (upd) {
    const field = upd.update.embeds[0].toJSON().fields.find((f) => f.name.includes('Order'));
    check('order keeps the name', field?.value.includes('GymSis APP'), field?.value);
    check('order turns the slot into a timestamp', /<t:\d+:t>/.test(field?.value || ''), field?.value);
  }
}

// --- an announcement full of long blocks still fits Discord's limits ------
{
  const cfg2 = loadConfig();
  const full = {
    event: 'dragon', title: 'Season 36 War',
    start: new Date('2026-11-14T16:00:00Z'), end: new Date('2026-11-14T17:00:00Z'),
    ping: 'everyone', authorTag: 'Leader', timeOptional: false,
    items: Object.keys(cfg2.blocks).map((kind) => ({ kind, text: 'x'.repeat(1000) })),
  };
  const ed = buildEmbed(full, cfg2).toJSON();
  const total = (ed.title?.length || 0) + (ed.description?.length || 0)
    + (ed.footer?.text?.length || 0)
    + (ed.fields || []).reduce((n, f) => n + f.name.length + f.value.length, 0);
  check('a full announcement stays under 6000 characters', total <= 6000, `${total} characters`);
  for (const f of ed.fields || []) {
    check('field value fits 1024', f.value.length <= 1024, `${f.value.length} characters`);
  }
}

// --- send ------------------------------------------------------------------
const send = fakeInteraction('component', { customId: `announce:send:${sessionId}` });
await handleComponent(send);
const sent = send._log.find((e) => e.sent);
check('send posts to the channel', !!sent, sent ? `ping=${sent.ping}` : 'no send');
check('send restricts role mentions', !!sent && Array.isArray(sent.mentions.roles));

// --- render shape ----------------------------------------------------------
const session = { event: 'dragon', title: 'Season 36 War', start: new Date(), end: null, items: [], ping: 'everyone', authorTag: 'Leader' };
const embed = buildEmbed(session, loadConfig());
check('embed has a title', embed.data.title.includes('SEASON 36 WAR'));
const rows = buildComponents(session, loadConfig());
check('preview has 5 rows', rows.length === 5, rows.map((r) => r.components.length).join('+'));

// --- leave the real config clean -------------------------------------------
const final = loadConfig();
final.leader_role_ids = [];
final.role_pings = {};
final.channel_id = null;
saveConfig(final);

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
