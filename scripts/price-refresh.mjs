import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPrices, priceDataModule } from './price-table.mjs';

const fields = {
  input: 'input_cost_per_token',
  cachedInput: 'cache_read_input_token_cost',
  cacheWrite: 'cache_creation_input_token_cost',
  output: 'output_cost_per_token',
};

export function mapPrices(sourceObject, currentPrices, { today, sourceUrl }) {
  if (!sourceObject || typeof sourceObject !== 'object' || Array.isArray(sourceObject)) {
    throw new Error('Source must be an object');
  }
  const selected = new Set(Object.keys(currentPrices.models));
  for (const [id, entry] of Object.entries(sourceObject)) {
    if (id.includes('/') || entry?.mode !== 'chat') continue;
    if ((/^gpt-(5\.6|6(\.\d+)?)(-[a-z]+)?$/.test(id) && entry.litellm_provider === 'openai') ||
        (/^claude-(opus|sonnet|haiku|fable)-5(-\d+)?$/.test(id) && entry.litellm_provider === 'anthropic')) {
      selected.add(id);
    }
  }
  const models = {};
  const skipped = [];
  const dropped = [];
  for (const id of [...selected].sort()) {
    let reason;
    const entry = Object.hasOwn(sourceObject, id) ? sourceObject[id] : undefined;
    if (!Object.hasOwn(sourceObject, id)) {
      reason = 'missing from source';
    } else {
      const converted = {};
      for (const [field, sourceField] of Object.entries(fields)) {
        const value = entry?.[sourceField];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          reason = `${sourceField} must be a finite non-negative number`;
          break;
        }
        converted[field] = Math.round(value * 1e12) / 1e6;
        if (!Number.isFinite(converted[field])) {
          reason = `${sourceField} exceeds the conversion range`;
          break;
        }
      }
      if (reason) skipped.push({ id, reason });
      else models[id] = converted;
    }
    if (reason && Object.hasOwn(currentPrices.models, id)) dropped.push({ id, reason });
  }
  return { prices: loadPrices({ source: sourceUrl, checkedOn: today, models }), skipped, dropped };
}

export function diffPrices(oldPrices, newPrices) {
  const lines = [];
  const ids = [...new Set([...Object.keys(oldPrices.models), ...Object.keys(newPrices.models)])].sort();
  for (const id of ids) {
    if (!Object.hasOwn(newPrices.models, id)) lines.push(`removed ${id}`);
    else if (!Object.hasOwn(oldPrices.models, id)) {
      lines.push(`added ${id} ${Object.keys(fields).map(field => `${field} ${newPrices.models[id][field]}`).join(' ')}`);
    } else {
      for (const field of Object.keys(fields)) {
        if (oldPrices.models[id][field] !== newPrices.models[id][field]) {
          lines.push(`changed ${id} ${field} ${oldPrices.models[id][field]} -> ${newPrices.models[id][field]}`);
        }
      }
    }
  }
  if (oldPrices.checkedOn !== newPrices.checkedOn) lines.push(`checkedOn ${oldPrices.checkedOn} -> ${newPrices.checkedOn}`);
  return lines;
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function main() {
  let from;
  let write = false;
  let today = localDate();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--write') write = true;
    else if (arg === '--from' || arg === '--today') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--from') from = value;
      else today = value;
    } else throw new Error(`Unknown argument ${arg}`);
  }
  const target = fileURLToPath(new URL('../native/prices.json', import.meta.url));
  const twin = fileURLToPath(new URL('./price-data.mjs', import.meta.url));
  const current = loadPrices(JSON.parse(fs.readFileSync(target, 'utf8')));
  const url = new URL(current.source);
  if (!current.source.startsWith('https://raw.githubusercontent.com/BerriAI/litellm/') ||
      url.origin !== 'https://raw.githubusercontent.com' || !url.pathname.startsWith('/BerriAI/litellm/')) {
    throw new Error('Source URL must be under https://raw.githubusercontent.com/BerriAI/litellm/');
  }
  let source;
  if (from) source = JSON.parse(fs.readFileSync(from, 'utf8'));
  else {
    const response = await fetch(current.source, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
    if (!response.ok) throw new Error(`Source request failed with status ${response.status}`);
    source = await response.json();
  }
  const { prices, skipped, dropped } = mapPrices(source, current, { today, sourceUrl: current.source });
  for (const line of diffPrices(current, prices)) console.log(line);
  for (const { label, list } of [{ label: 'Skipped', list: skipped }, { label: 'Dropped', list: dropped }]) {
    console.log(`${label}: ${list.length}`);
    for (const { id, reason } of list) console.log(`${id}: ${reason}`);
  }
  if (!write) {
    console.log('Dry run. Pass --write to save.');
    return;
  }
  const pending = [];
  try {
    for (const [file, contents] of [[target, JSON.stringify(prices, null, 2) + '\n'], [twin, priceDataModule(prices)]]) {
      const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
      fs.writeFileSync(temporary, contents, { flag: 'wx' });
      pending.push({ file, temporary });
    }
    for (const { file, temporary } of pending) fs.renameSync(temporary, file);
  } finally {
    for (const { temporary } of pending) fs.rmSync(temporary, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
