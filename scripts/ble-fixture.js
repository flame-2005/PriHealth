#!/usr/bin/env node
/**
 * Turns a tshark ATT dump of a Bluetooth HCI snoop log into a protocol fixture.
 *
 *   tshark -r btsnoop_hci.log -Y "btatt && bluetooth.addr==<watch address>" \
 *     -T fields -e frame.time_epoch -e btatt.opcode -e btatt.handle -e btatt.uuid16 -e btatt.uuid128 -e btatt.value \
 *     > captures/icon-plus-sync.tsv
 *   node scripts/ble-fixture.js captures/icon-plus-sync.tsv __tests__/fixtures/moyoung/sync.json
 *
 * Handles are mapped to UUIDs from the Read By Type / Find Information responses in the same dump;
 * add `--map 0x0012=fee2,0x0015=fee3` for handles the dump never declares. Writes become `tx`,
 * notifications and indications `rx`, read responses `rd`. Raw captures hold health data: keep them
 * in the git-ignored captures/ folder and commit only the trimmed fixture.
 */
const fs = require('fs');

const [, , input, output, ...rest] = process.argv;
if (!input || !output) {
  console.error('usage: node scripts/ble-fixture.js <tshark.tsv> <fixture.json> [--map 0x0012=fee2,...]');
  process.exit(2);
}

const map = new Map();
const mapArg = rest.indexOf('--map');
if (mapArg >= 0 && rest[mapArg + 1]) {
  for (const pair of rest[mapArg + 1].split(',')) {
    const [h, u] = pair.split('=');
    map.set(Number(h), u.toLowerCase());
  }
}

// ATT opcodes
const WRITE_REQ = 0x12;
const WRITE_CMD = 0x52;
const NOTIFY = 0x1b;
const INDICATE = 0x1d;
const READ_RSP = 0x0b;
const READ_REQ = 0x0a;

const lines = fs.readFileSync(input, 'utf8').split(/\r?\n/).filter(Boolean);
const frames = [];
let lastReadHandle = null;
for (const line of lines) {
  const [t, opcodeRaw, handleRaw, uuid16, uuid128, valueRaw] = line.split('\t');
  const opcode = Number(opcodeRaw);
  const handle = handleRaw ? Number(handleRaw.split(',')[0]) : null;
  const uuid = (uuid128 || uuid16 || '').split(',')[0].toLowerCase().replace(/^0x/, '');
  if (handle != null && uuid && !map.has(handle)) map.set(handle, uuid);
  const hex = (valueRaw || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (opcode === READ_REQ) lastReadHandle = handle;
  const dir = opcode === WRITE_REQ || opcode === WRITE_CMD ? 'tx' : opcode === NOTIFY || opcode === INDICATE ? 'rx' : opcode === READ_RSP ? 'rd' : null;
  if (!dir || !hex) continue;
  const h = dir === 'rd' ? lastReadHandle : handle;
  frames.push({ t: Number(t), dir, uuid: map.get(h) || `handle:${h}`, hex });
}

fs.writeFileSync(output, JSON.stringify({ source: input, frames }, null, 2) + '\n');
console.log(`${frames.length} frames -> ${output}`);
const unmapped = frames.filter(f => f.uuid.startsWith('handle:')).length;
if (unmapped) console.warn(`${unmapped} frames have no UUID; pass --map handle=uuid for them.`);
