// Offline smoke test for /announce-config (the content manager).
import { loadConfig, saveConfig, buildComponents } from './announce.js';
import { handleAutocomplete, handleConfigCommand } from './manage.js';

const before = JSON.stringify(loadConfig());

function fakeCommand(group, sub, opts = {}) {
  const log = [];
  const it = {
    kind: 'command',
    user: { id: '555555555555555555', tag: 'Admin#1' },
    memberPermissions: { has: (p) => opts.manageGuild !== false },
    guildId: '999999999999999999',
    channelId: '333333333333333333',
    options: {
      getSubcommandGroup: () => group,
      getSubcommand: () => sub,
      getString: (n) => (opts.strings ?? {})[n] ?? null,
      getInteger: (n) => (opts.integers ?? {})[n] ?? null,
      getBoolean: (n) => (opts.booleans ?? {})[n] ?? null,
      getRole: () => opts.role ?? null,
      getChannel: () => opts.channel ?? null,
      getFocused: () => opts.focused ?? { name: 'event', value: '' },
    },
    replied: false,
    deferred: false,
    reply: async (p) => { it.replied = true; log.push(p); },
    followUp: async (p) => { log.push(p); },
    update: async (p) => { log.push(p); },
    _log: log,
  };
  return it;
}

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

// --- add an event ----------------------------------------------------------
const add = fakeCommand('event', 'add', {
  strings: { key: 'Holy City', label: 'Holy City', emoji: '🏛️', color: '#7C3AED', slots: '05:00, 13:00, 21:00' },
  integers: { duration: 90 },
});
await handleConfigCommand(add);
check('event add succeeds', add.replied && /Added/.test(add._log[0].content), add._log[0].content);

let cfg = loadConfig();
check('event is saved under a slug key', !!cfg.events.holy_city);
check('event keeps its slots', JSON.stringify(cfg.events.holy_city?.slots) === JSON.stringify(['05:00', '13:00', '21:00']));
check('event keeps its colour', cfg.events.holy_city?.color === 0x7c3aed);
check('event keeps its duration', cfg.events.holy_city?.dur === 90);
check('event defaults needs_time to true', cfg.events.holy_city?.needs_time === true);

// --- duplicate is rejected -------------------------------------------------
const dup = fakeCommand('event', 'add', { strings: { key: 'holy_city', label: 'Nope' } });
await handleConfigCommand(dup);
check('duplicate event is rejected', /already exists/.test(dup._log[0].content));

// --- bad colour is rejected ------------------------------------------------
const badColor = fakeCommand('event', 'add', { strings: { key: 'zzz', color: 'nothex' } });
await handleConfigCommand(badColor);
check('bad colour is rejected', /Colour must look like/.test(badColor._log[0].content));

// --- bad time is rejected --------------------------------------------------
const badTime = fakeCommand('event', 'add', { strings: { key: 'zzz', slots: '99:99' } });
await handleConfigCommand(badTime);
check('bad slot time is rejected', /not a valid/.test(badTime._log[0].content));

// --- edit ------------------------------------------------------------------
const edit = fakeCommand('event', 'edit', {
  strings: { event: 'holy_city', label: 'Holy City Siege', emoji: '⛪' },
  integers: { duration: 45 },
});
await handleConfigCommand(edit);
check('event edit succeeds', /Updated/.test(edit._log[0].content));
cfg = loadConfig();
check('edit changes the label', cfg.events.holy_city?.label === 'Holy City Siege');
check('edit changes the duration', cfg.events.holy_city?.dur === 45);

// --- edit by label works too ----------------------------------------------
const editByLabel = fakeCommand('event', 'edit', { strings: { event: 'Holy City Siege', color: '#FF0000' } });
await handleConfigCommand(editByLabel);
check('event can be found by label', /Updated/.test(editByLabel._log[0].content));
cfg = loadConfig();
check('edit by label changes the colour', cfg.events.holy_city?.color === 0xff0000);

// --- add a slot ------------------------------------------------------------
const slotAdd = fakeCommand('event', 'slot-add', { strings: { event: 'holy_city', time: '23:30' } });
await handleConfigCommand(slotAdd);
cfg = loadConfig();
check('slot-add adds a slot', cfg.events.holy_city?.slots.includes('23:30'));
check('slot-add keeps the others', cfg.events.holy_city?.slots.includes('05:00'));

// --- remove a slot ---------------------------------------------------------
const slotRemove = fakeCommand('event', 'slot-remove', { strings: { event: 'holy_city', time: '23:30' } });
await handleConfigCommand(slotRemove);
cfg = loadConfig();
check('slot-remove drops the slot', !cfg.events.holy_city?.slots.includes('23:30'));

// --- replace all slots -----------------------------------------------------
const slots = fakeCommand('event', 'slots', { strings: { event: 'holy_city', slots: '01:00,02:00' } });
await handleConfigCommand(slots);
cfg = loadConfig();
check('slots replaces the whole list', JSON.stringify(cfg.events.holy_city?.slots) === JSON.stringify(['01:00', '02:00']));

// --- remove an event -------------------------------------------------------
const remove = fakeCommand('event', 'remove', { strings: { event: 'holy_city' } });
await handleConfigCommand(remove);
cfg = loadConfig();
check('event remove deletes it', !cfg.events.holy_city);

// --- add a block -----------------------------------------------------------
const addBlock = fakeCommand('block', 'add', {
  strings: { key: 'rewards', label: 'Rewards', emoji: '🎁', section: '🎁 Rewards', type: 'text', hint: 'Win 50k' },
});
await handleConfigCommand(addBlock);
check('block add succeeds', /Added block/.test(addBlock._log[0].content));
cfg = loadConfig();
check('block is saved', !!cfg.blocks.rewards);
check('block keeps its type', cfg.blocks.rewards?.type === 'text');

// --- edit a block ----------------------------------------------------------
const editBlock = fakeCommand('block', 'edit', { strings: { block: 'rewards', label: 'Prize', type: 'step' } });
await handleConfigCommand(editBlock);
cfg = loadConfig();
check('block edit changes the label', cfg.blocks.rewards?.label === 'Prize');
check('block edit changes the type', cfg.blocks.rewards?.type === 'step');

// --- remove a block --------------------------------------------------------
const removeBlock = fakeCommand('block', 'remove', { strings: { block: 'rewards' } });
await handleConfigCommand(removeBlock);
cfg = loadConfig();
check('block remove deletes it', !cfg.blocks.rewards);

// --- event list ------------------------------------------------------------
const listEvents = fakeCommand('event', 'list', {});
await handleConfigCommand(listEvents);
check('event list succeeds', listEvents.replied && /Events/.test(listEvents._log[0].content));
check('event list shows the time rule', /time (required|optional)/.test(listEvents._log[0].content));
check('event list shows slots', /slots:/.test(listEvents._log[0].content));

// --- block list ------------------------------------------------------------
const listBlocks = fakeCommand('block', 'list', {});
await handleConfigCommand(listBlocks);
check('block list succeeds', listBlocks.replied && /Content blocks/.test(listBlocks._log[0].content));
check('block list shows headings', /heading:/.test(listBlocks._log[0].content));

// --- permissions -----------------------------------------------------------
const noPerm = fakeCommand('event', 'add', { manageGuild: false, strings: { key: 'nope' } });
await handleConfigCommand(noPerm);
check('config needs Manage Server', /Manage Server/.test(noPerm._log[0].content));

// --- autocomplete ----------------------------------------------------------
const acLog = [];
const ac = {
  options: {
    getFocused: () => ({ name: 'event', value: 'drag' }),
  },
  respond: async (choices) => { acLog.push(choices); },
};
await handleAutocomplete(ac);
check('autocomplete filters events', acLog[0].some((c) => c.value === 'dragon'));

const acBlock = {
  options: { getFocused: () => ({ name: 'block', value: 'obj' }) },
  respond: async (choices) => { acLog.push(choices); },
};
await handleAutocomplete(acBlock);
check('autocomplete filters blocks', acLog[1].some((c) => c.value === 'objective'));

// --- the new event reaches the /announce menu ------------------------------
const cfg2 = loadConfig();
cfg2.events.holy_city = { label: 'Holy City', emoji: '🏛️', color: 0x7c3aed, slots: ['05:00'], dur: 60, needs_time: true };
saveConfig(cfg2);
const session = { event: null, title: '', start: null, end: null, items: [], ping: 'everyone', authorTag: 'T' };
const rows = buildComponents(session, loadConfig());
const menu = rows[0].components[0];
check('new event shows in the picker', menu.options.some((o) => o.data.value === 'holy_city'));

// --- restore the original config -------------------------------------------
saveConfig(JSON.parse(before));
const restored = loadConfig();
check('config restored to the original', !restored.events.holy_city && !restored.blocks.rewards);

console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
