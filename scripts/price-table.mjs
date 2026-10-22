import rawPrices from './price-data.mjs';

const fields = ['input', 'cachedInput', 'cacheWrite', 'output'];

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function loadPrices(raw) {
  if (!isPlainObject(raw)) throw new Error('Prices must be a plain object');
  if (Reflect.ownKeys(raw).some(key => !['source', 'checkedOn', 'models'].includes(key))) {
    throw new Error('Prices contain an unknown field');
  }
  if (!Object.hasOwn(raw, 'source') || typeof raw.source !== 'string' || !raw.source.startsWith('https://')) {
    throw new Error('Source must start with https://');
  }
  if (!Object.hasOwn(raw, 'checkedOn') || typeof raw.checkedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.checkedOn)) {
    throw new Error('Checked date must be a valid YYYY-MM-DD date');
  }
  const date = new Date(`${raw.checkedOn}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw.checkedOn) {
    throw new Error('Checked date must be a valid YYYY-MM-DD date');
  }
  if (!Object.hasOwn(raw, 'models') || !isPlainObject(raw.models) || Reflect.ownKeys(raw.models).length === 0) {
    throw new Error('Models must be a non-empty plain object');
  }
  const models = {};
  for (const model of Reflect.ownKeys(raw.models)) {
    if (typeof model !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(model)) {
      throw new Error('Model id is invalid');
    }
    const entry = raw.models[model];
    if (!isPlainObject(entry)) throw new Error('Model prices must be a plain object');
    if (Reflect.ownKeys(entry).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(entry, key))) {
      throw new Error('Model prices must contain exactly the four price fields');
    }
    const copy = {};
    for (const key of Reflect.ownKeys(entry)) {
      const value = entry[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error('Price must be a finite non-negative number');
      }
      copy[key] = value;
    }
    models[model] = Object.freeze(copy);
  }
  return Object.freeze({ source: raw.source, checkedOn: raw.checkedOn, models: Object.freeze(models) });
}

export const prices = loadPrices(rawPrices);

