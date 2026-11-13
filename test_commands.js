// Validates the slash command payloads against Discord's API rules.
// The main one: required options must come before optional ones.
import { SlashCommandBuilder } from 'discord.js';
import { ACCESS_COMMAND } from './access.js';
import { CONFIG_COMMAND } from './manage.js';

const ANNOUNCE_COMMAND = new SlashCommandBuilder()
  .setName('announce')
  .setDescription('Build and post a clan event announcement (leadership only).');

let failed = false;

function checkOptions(label, options) {
  let seenOptional = false;
  for (const opt of options) {
    if (opt.required) {
      if (seenOptional) {
        console.log(`FAIL  ${label}: required option "${opt.name}" comes after an optional one`);
        failed = true;
      }
    } else {
      seenOptional = true;
    }
  }
}

function checkCommand(cmd) {
  const json = cmd.toJSON();
  console.log(`\n/${json.name}`);
  checkOptions(`/${json.name}`, json.options || []);

  for (const group of json.options || []) {
    if (group.type !== 2) continue;
    console.log(`  group "${group.name}"`);
    for (const sub of group.options || []) {
      console.log(`    ${sub.name}`);
      checkOptions(`/${json.name} ${group.name} ${sub.name}`, sub.options || []);
    }
  }
}

for (const cmd of [ANNOUNCE_COMMAND, ACCESS_COMMAND, CONFIG_COMMAND]) checkCommand(cmd);

console.log(failed ? '\nCOMMAND PAYLOADS INVALID' : '\nALL COMMAND PAYLOADS VALID');
process.exit(failed ? 1 : 0);
