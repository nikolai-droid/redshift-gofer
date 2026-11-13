// Check every Discord payload the bot can produce against Discord's API limits.
// Drives the real code paths (component presses and modal submissions).
import {
  loadConfig, buildEmbed, buildComponents,
  handleCommand, handleComponent, handleModal,
} from './announce.js';

const L = {
  modalTitle: 45,
  inputLabel: 45,
  placeholder: 100,
  customId: 100,
  optionLabel: 100,
  optionValue: 100,
  optionDesc: 100,
  selectPlaceholder: 150,
  buttonLabel: 80,
  embedTitle: 256,
  embedDescription: 4096,
  embedFieldName: 256,
  embedFieldValue: 1024,
  embedFooter: 2048,
  embedTotal: 6000,
  content: 2000,
};

const problems = [];
function check(where, value, max) {
  if (typeof value !== 'string') return;
  if (value.length > max) {
    problems.push(`${where}: ${value.length} > ${max} — ${JSON.stringify(value.slice(0, 70))}`);
  }
}

function fakeInteraction(kind, opts = {}) {
  const log = [];
  const it = {
    kind,
    user: { id: '222222222222222222', tag: 'Leader#1' },
    member: { user: { displayName: 'Leader' }, roles: { cache: new Map() } },
    memberPermissions: { has: () => true },
    guildId: '999999999999999999',
    channelId: '333333333333333333',
    guild: { roles: { fetch: async () => ({ id: '1', name: 'R', toString: () => '@R' }) } },
    client: { channels: { fetch: async () => null } },
    options: { getString: () => opts.action, getRole: () => null, getChannel: () => null },
    values: opts.values ?? [],
    customId: opts.customId,
    fields: { getTextInputValue: (n) => (opts.fields ?? {})[n] ?? '' },
    replied: false,
    deferred: false,
    reply: async (p) => { it.replied = true; log.push({ reply: p }); },
    update: async (p) => { it.replied = true; log.push({ update: p }); },
    editReply: async (p) => { log.push({ editReply: p }); },
    followUp: async (p) => { log.push({ followUp: p }); },
    showModal: async (m) => { log.push({ modal: m.toJSON() }); },
    _log: log,
  };
  return it;
}

const cfg = loadConfig();

// ---- every block modal must open without tripping a Discord limit -------
const leader = fakeInteraction('command');
await handleCommand(leader);
const sessionId = leader._log[0].reply.components[0].components[0].data.custom_id.split(':')[2];
await handleComponent(fakeInteraction('component', { customId: `announce:event:${sessionId}`, values: ['dragon'] }));
await handleComponent(fakeInteraction('component', { customId: `announce:slot:${sessionId}`, values: ['slot:16:00'] }));

for (const kind of Object.keys(cfg.blocks)) {
  const it = fakeInteraction('component', { customId: `announce:add:${sessionId}`, values: [kind] });
  await handleComponent(it);
  const opened = it._log.find((e) => e.modal);
  if (!opened) {
    problems.push(`modal for block "${kind}" did not open: ${JSON.stringify(it._log.find((e) => e.reply)?.reply?.content)}`);
    continue;
  }
  const m = opened.modal;
  check(`modal(${kind}).title`, m.title, L.modalTitle);
  for (const row of m.components) {
    for (const comp of row.components) {
      check(`modal(${kind}).custom_id`, comp.custom_id, L.customId);
      if (comp.type === 4) {
        check(`modal(${kind}).label`, comp.label, L.inputLabel);
        check(`modal(${kind}).placeholder`, comp.placeholder, L.placeholder);
      }
    }
  }
}

// ---- component limits for every event ------------------------------------
for (const evKey of Object.keys(cfg.events)) {
  const s = {
    id: 'abcd1234', event: evKey, title: 'Season 36 War',
    start: new Date('2026-11-14T16:00:00Z'), end: new Date('2026-11-14T17:00:00Z'),
    items: [], ping: 'everyone', authorTag: 'Leader', timeOptional: false,
  };
  buildComponents(s, cfg).forEach((row, ri) => {
    row.components.forEach((c) => {
      const d = c.toJSON();
      check(`components[${evKey}][${ri}].custom_id`, d.custom_id, L.customId);
      if (d.type === 9 || d.type === 3) {
        check(`components[${evKey}][${ri}].placeholder`, d.placeholder, L.selectPlaceholder);
        (d.options || []).forEach((o, oi) => {
          check(`components[${evKey}][${ri}].opt${oi}.label`, o.label, L.optionLabel);
          check(`components[${evKey}][${ri}].opt${oi}.value`, o.value, L.optionValue);
          check(`components[${evKey}][${ri}].opt${oi}.description`, o.description, L.optionDesc);
        });
        if ((d.options || []).length > 25) {
          problems.push(`components[${evKey}][${ri}] has ${d.options.length} options (> 25)`);
        }
      }
      if (d.type === 2) check(`components[${evKey}][${ri}].label`, d.label, L.buttonLabel);
    });
  });
}

// ---- embed limits, including a worst case --------------------------------
const worst = {
  id: 'abcd1234', event: 'dragon', title: 'Season 36 War',
  start: new Date('2026-11-14T16:00:00Z'), end: new Date('2026-11-14T17:00:00Z'),
  ping: 'everyone', authorTag: 'Leader', timeOptional: false,
  items: Object.keys(cfg.blocks).map((kind) => ({ kind, text: 'x'.repeat(1000) })),
};
const ed = buildEmbed(worst, cfg).toJSON();
check('embed.title', ed.title, L.embedTitle);
check('embed.description', ed.description, L.embedDescription);
check('embed.footer.text', ed.footer?.text, L.embedFooter);
(ed.fields || []).forEach((f, i) => {
  check(`embed.field${i}.name`, f.name, L.embedFieldName);
  check(`embed.field${i}.value`, f.value, L.embedFieldValue);
});
const total = (ed.title?.length || 0) + (ed.description?.length || 0)
  + (ed.footer?.text?.length || 0)
  + (ed.fields || []).reduce((n, f) => n + f.name.length + f.value.length, 0);
console.log(`worst-case embed total: ${total} (limit ${L.embedTotal})`);
if (total > L.embedTotal) problems.push(`embed total: ${total} > ${L.embedTotal}`);

// ---- the order modal must accept the leader's own notation --------------
const order = fakeInteraction('modal', {
  customId: `announce-modal:order:order:${sessionId}`,
  fields: { text: 'GymSis APP — 2:29 AM\nJapan 00:00-00:15' },
});
await handleModal(order);
const upd = order._log.find((e) => e.update);
if (!upd) {
  problems.push(`order submit failed: ${JSON.stringify(order._log.find((e) => e.reply)?.reply?.content)}`);
} else {
  const fields = upd.update.embeds[0].toJSON().fields || [];
  console.log('\norder field:', JSON.stringify(fields.map((f) => f.value)));
}

// ---- report --------------------------------------------------------------
console.log('\n--- problems ---');
if (!problems.length) console.log('none');
for (const p of problems) console.log(' -', p);
process.exitCode = problems.length ? 1 : 0;
