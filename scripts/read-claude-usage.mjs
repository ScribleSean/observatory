// Read numeric Claude Code usage metadata without exporting conversation data.
// This is a port of read-claude-usage.py and returns the same result.
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { TIME_ZONE } from '../lib/timezone.mjs';

// These limits are a coarse guard on the reader's time and memory, and the line limit
// also bounds requests held in memory. A history over any limit reads unavailable,
// never partial.
export const MAX_FILES = 10_000;
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_LINE_BYTES = 4 * 1024 * 1024;
export const MAX_LINES = 3_000_000;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const FIELDS = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens'];
const OUTPUT_KEYS = ['inputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'outputTokens', 'totalTokens'];
const MODEL = /^claude-[a-z0-9][a-z0-9.-]{0,98}$/;
const WINDOWS = process.platform === 'win32';
// The callback realpath walks links itself like Python's resolve, without case changes.
const realpath = promisify(fs.realpath);
// Errors that Python's pathlib treats as "does not exist" rather than raising.
const IGNORED = new Set(['ENOENT', 'ENOTDIR', 'EBADF', 'ELOOP']);

class Unavailable extends Error {}

const unavailable = () => ({ provider: 'claude-code', status: 'unavailable' });
const notFound = () => ({ provider: 'claude-code', status: 'not-found' });

// A JSON float literal, kept apart from integers as Python does.
class PyFloat {
  constructor(value) {
    this.value = value;
  }
}

function reviver(_key, value, context) {
  if (typeof value !== 'number') return value;
  const source = context?.source ?? String(value);
  if (/[.eE]/.test(source)) return new PyFloat(value);
  return Number.isSafeInteger(value) ? value : BigInt(source);
}

// Python's json also accepts NaN, Infinity and -Infinity. This slower parser
// runs only when JSON.parse rejects a line.
function parsePythonJson(text) {
  let index = 0;
  const space = () => {
    while (index < text.length && ' \t\n\r'.includes(text[index])) index++;
  };
  const fail = () => {
    throw new SyntaxError('Invalid JSON');
  };
  const value = () => {
    space();
    const char = text[index];
    if (char === '{') {
      index++;
      const object = {};
      space();
      if (text[index] === '}') {
        index++;
        return object;
      }
      for (;;) {
        space();
        if (text[index] !== '"') fail();
        const key = string();
        space();
        if (text[index++] !== ':') fail();
        Object.defineProperty(object, key, { value: value(), enumerable: true, writable: true, configurable: true });
        space();
        const next = text[index++];
        if (next === '}') return object;
        if (next !== ',') fail();
      }
    }
    if (char === '[') {
      index++;
      const array = [];
      space();
      if (text[index] === ']') {
        index++;
        return array;
      }
      for (;;) {
        array.push(value());
        space();
        const next = text[index++];
        if (next === ']') return array;
        if (next !== ',') fail();
      }
    }
    if (char === '"') return string();
    for (const [word, result] of [
      ['NaN', () => new PyFloat(Number.NaN)],
      ['Infinity', () => new PyFloat(Number.POSITIVE_INFINITY)],
      ['-Infinity', () => new PyFloat(Number.NEGATIVE_INFINITY)],
      ['true', () => true],
      ['false', () => false],
      ['null', () => null],
    ]) {
      if (text.startsWith(word, index)) {
        index += word.length;
        return result();
      }
    }
    const match = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?/y;
    match.lastIndex = index;
    const found = match.exec(text);
    if (!found) fail();
    index = match.lastIndex;
    return JSON.parse(found[0], reviver);
  };
  const string = () => {
    // JSON strings refuse raw control characters, as Python's json does.
    // oxlint-disable-next-line no-control-regex
    const pattern = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
    pattern.lastIndex = index;
    const found = pattern.exec(text);
    if (!found) fail();
    index = pattern.lastIndex;
    return JSON.parse(found[0]);
  };
  const result = value();
  space();
  if (index !== text.length) fail();
  return result;
}

function parseLine(text) {
  try {
    return JSON.parse(text, reviver);
  } catch {
    return parsePythonJson(text);
  }
}

const isDict = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof PyFloat);
const get = (object, key) => (Object.hasOwn(object, key) ? object[key] : undefined);
const isNone = (value) => value === undefined || value === null;
const number = (value) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_SAFE ? value : null);

function codePointLength(text) {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

// Python equality, where True == 1 == 1.0 and containers compare deeply.
function pyEqual(a, b) {
  const numeric = (value) =>
    typeof value === 'boolean' ? Number(value) : value instanceof PyFloat ? value.value : value;
  const kind = (value) => {
    if (isNone(value)) return 'none';
    if (typeof value === 'string') return 'string';
    if (Array.isArray(value)) return 'list';
    if (isDict(value)) return 'dict';
    return 'number';
  };
  const ka = kind(a);
  if (ka !== kind(b)) return false;
  if (ka === 'none') return true;
  if (ka === 'string') return a === b;
  // Loose equality compares BigInt and Number values exactly.
  // eslint-disable-next-line eqeqeq
  if (ka === 'number') return numeric(a) == numeric(b);
  if (ka === 'list') return a.length === b.length && a.every((value, index) => pyEqual(value, b[index]));
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && pyEqual(a[key], b[key]));
}

function daysFromCivil(year, month, day) {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(days) {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return [month <= 2 ? yoe + era * 400 + 1 : yoe + era * 400, month, day];
}

const daysInMonth = (year, month) =>
  month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
const US_PER_DAY = 86_400_000_000n;
const MIN_INSTANT = BigInt(daysFromCivil(1, 1, 1)) * US_PER_DAY;
const MAX_INSTANT = BigInt(daysFromCivil(9999, 12, 31) + 1) * US_PER_DAY - 1n;

// The parsers below follow CPython 3.9's C datetime.fromisoformat byte by byte,
// over UTF-8 bytes with a NUL terminator, including its lenient corners.
function parseDigits(bytes, position, count) {
  let value = 0;
  for (let offset = 0; offset < count; offset++) {
    const byte = bytes[position + offset];
    if (byte === undefined || byte < 48 || byte > 57) return null;
    value = value * 10 + byte - 48;
  }
  return [position + count, value];
}

function parseHourMinuteSecond(bytes, start, end) {
  const values = [0, 0, 0, 0];
  let position = start;
  for (let index = 0; index < 3; index++) {
    const found = parseDigits(bytes, position, 2);
    if (!found) return { code: -3 };
    [position, values[index]] = found;
    const char = bytes[position++];
    if (position >= end) return { code: char !== 0 ? 1 : 0, values };
    if (char === 58) continue;
    if (char === 46) break;
    return { code: -4 };
  }
  const remaining = end - position;
  if (remaining !== 6 && remaining !== 3) return { code: -3 };
  const found = parseDigits(bytes, position, remaining);
  if (!found) return { code: -3 };
  [position, values[3]] = found;
  if (remaining === 3) values[3] *= 1000;
  return { code: bytes[position] !== 0 ? 1 : 0, values };
}

function parseTime(bytes, start, end) {
  let tzPosition = start;
  do {
    if (bytes[tzPosition] === 43 || bytes[tzPosition] === 45) break;
  } while (++tzPosition < end);
  const time = parseHourMinuteSecond(bytes, start, tzPosition);
  if (time.code < 0) return { code: time.code };
  if (tzPosition === end) return time.code === 1 ? { code: -5 } : { code: 0, values: time.values };
  const tzLength = end - tzPosition;
  if (tzLength !== 6 && tzLength !== 9 && tzLength !== 16) return { code: -5 };
  const sign = bytes[tzPosition] === 45 ? -1 : 1;
  const zone = parseHourMinuteSecond(bytes, tzPosition + 1, end);
  if (zone.code !== 0) return { code: -5 };
  const [hour, minute, second, micro] = zone.values;
  return { code: 1, values: time.values, offset: sign * (hour * 3600 + minute * 60 + second), offsetMicro: sign * micro };
}

// Return UTC microseconds since 1970, null for an invalid value, or throw when
// Python would raise outside its ValueError handling.
function timestamp(value) {
  if (typeof value !== 'string' || codePointLength(value) > 80) return null;
  // Python indexes by code point, not UTF-16 unit.
  // oxlint-disable-next-line typescript/no-misused-spread
  const points = [...value.replaceAll('Z', '+00:00')];
  if (points.length > 10 && /^[\uD800-\uDFFF]$/.test(points[10])) points[10] = 'T';
  if (points.some((point) => /^[\uD800-\uDFFF]$/.test(point))) return null;
  const text = Buffer.from(points.join(''), 'utf8');
  const bytes = new Uint8Array(text.length + 1);
  bytes.set(text);
  const year = parseDigits(bytes, 0, 4);
  if (!year || bytes[4] !== 45) return null;
  const month = parseDigits(bytes, 5, 2);
  if (!month || bytes[7] !== 45) return null;
  const day = parseDigits(bytes, 8, 2);
  if (!day || text.length <= 10) return null;
  const lead = bytes[10];
  const start = (lead & 0x80) === 0 ? 11 : (lead & 0xf0) === 0xe0 ? 13 : (lead & 0xf0) === 0xf0 ? 14 : 12;
  const time = parseTime(bytes, start, text.length);
  if (time.code < 0) return null;
  const [y, m, d] = [year[1], month[1], day[1]];
  const [hour, minute, second, micro] = time.values;
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m) || hour > 23 || minute > 59 || second > 59) return null;
  // A time without a zone is naive and refused.
  if (time.code !== 1) return null;
  let offset = 0n;
  if (time.offset !== 0) {
    offset = BigInt(time.offset) * 1_000_000n + BigInt(time.offsetMicro);
    if (offset <= -US_PER_DAY || offset >= US_PER_DAY) return null;
  }
  const local =
    BigInt(daysFromCivil(y, m, d)) * US_PER_DAY + BigInt(((hour * 60 + minute) * 60 + second) * 1_000_000 + micro);
  const instant = local - offset;
  // Python raises OverflowError here, which the reader does not catch.
  if (instant < MIN_INSTANT || instant > MAX_INSTANT) throw new Unavailable();
  return instant;
}

const newYork = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const offsets = new Map();

// The New York offset in seconds. Zone changes fall on whole UTC hours.
function newYorkOffset(seconds) {
  const hourKey = Math.floor(seconds / 3600);
  if (offsets.has(hourKey)) return offsets.get(hourKey);
  const parts = Object.fromEntries(newYork.formatToParts(new Date(hourKey * 3_600_000)).map((part) => [part.type, part.value]));
  const localOfDay = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  const utcOfDay = ((hourKey * 3600) % 86400 + 86400) % 86400;
  let offset = localOfDay - utcOfDay;
  if (offset > 43200) offset -= 86400;
  if (offset <= -43200) offset += 86400;
  offsets.set(hourKey, offset);
  return offset;
}

function newYorkDayAndHour(instant) {
  let seconds = instant / 1_000_000n;
  if (instant % 1_000_000n < 0n) seconds -= 1n;
  const utcSeconds = Number(seconds);
  const local = utcSeconds + newYorkOffset(utcSeconds);
  const days = Math.floor(local / 86400);
  if (BigInt(days) * US_PER_DAY < MIN_INSTANT) throw new Unavailable();
  const [year, month, day] = civilFromDays(days);
  const pad = (value, width) => String(value).padStart(width, '0');
  return [`${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`, Math.floor((local - days * 86400) / 3600)];
}

function modelName(value) {
  return typeof value === 'string' && MODEL.test(value) ? value : 'unknown';
}

// Path helpers that mirror pathlib: parts comparison, case-insensitive on Windows.
const pathApi = WINDOWS ? path.win32 : path.posix;
const pathParts = (value) => {
  const parsed = pathApi.parse(value);
  const rest = value.slice(parsed.root.length).split(WINDOWS ? /[\\/]+/ : /\/+/).filter((part) => part && part !== '.');
  return [parsed.root, ...rest].map((part) => (WINDOWS ? part.toLowerCase() : part));
};
function compareText(a, b) {
  const left = [...a];
  const right = [...b];
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const difference = left[index].codePointAt(0) - right[index].codePointAt(0);
    if (difference) return difference;
  }
  return left.length - right.length;
}
function compareParts(a, b) {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = compareText(a[index], b[index]);
    if (difference) return difference;
  }
  return a.length - b.length;
}
const samePath = (a, b) => compareParts(pathParts(a), pathParts(b)) === 0;
function beneath(child, root) {
  const childParts = pathParts(child);
  const rootParts = pathParts(root);
  return rootParts.length <= childParts.length && compareParts(childParts.slice(0, rootParts.length), rootParts) === 0;
}
function purePath(value) {
  const parsed = pathApi.parse(value);
  const rest = value.slice(parsed.root.length).split(WINDOWS ? /[\\/]+/ : /\/+/).filter((part) => part && part !== '.');
  const joined = parsed.root + rest.join(pathApi.sep);
  return joined || '.';
}

async function statOrIgnored(file, follow) {
  try {
    return await (follow ? fs.promises.stat(file) : fs.promises.lstat(file));
  } catch (error) {
    if (IGNORED.has(error?.code)) return null;
    throw error;
  }
}
const isSymlink = async (file) => (await statOrIgnored(file, false))?.isSymbolicLink() ?? false;
const isDir = async (file) => (await statOrIgnored(file, true))?.isDirectory() ?? false;
const isFile = async (file) => (await statOrIgnored(file, true))?.isFile() ?? false;

async function walk(directory, projects, found, limits) {
  if ((await isSymlink(directory)) || !beneath(await realpath(directory), projects)) throw new Unavailable();
  // Read through fs.promises at call time so tests can simulate failures.
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const folders = [];
  for (const entry of entries) {
    const full = pathApi.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      // Python lists a link to a folder as a folder and refuses it.
      let target = null;
      try {
        target = await fs.promises.stat(full);
      } catch {
        target = null;
      }
      if (target?.isDirectory() || entry.name.endsWith('.jsonl')) throw new Unavailable();
      continue;
    }
    if (entry.isDirectory()) {
      folders.push(full);
      continue;
    }
    if (!entry.name.endsWith('.jsonl')) continue;
    if ((await isSymlink(full)) || !(await isFile(full))) throw new Unavailable();
    found.totalBytes += (await fs.promises.stat(full)).size;
    if (found.totalBytes > limits.MAX_TOTAL_BYTES) throw new Unavailable();
    found.files.push(full);
    if (found.files.length > limits.MAX_FILES) throw new Unavailable();
  }
  for (const folder of folders) await walk(folder, projects, found, limits);
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const BLANK = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0b, 0x0c]);

function addRecord(records, event) {
  if (!isDict(event)) return false;
  if (get(event, 'type') !== 'assistant') return false;
  const message = get(event, 'message');
  if (!isDict(message) || get(message, 'role') !== 'assistant') throw new Unavailable();
  const usage = get(message, 'usage');
  if (!isDict(usage)) throw new Unavailable();
  const values = FIELDS.map((field) => number(get(usage, field)));
  const id = get(message, 'id');
  const requestId = get(event, 'requestId');
  const instant = timestamp(get(event, 'timestamp'));
  if (typeof id !== 'string' || !(codePointLength(id) > 0 && codePointLength(id) <= 256) || instant === null || values.includes(null))
    throw new Unavailable();
  const rawModel = get(message, 'model');
  // Client-generated API errors carry no recorded request usage.
  // The client also writes placeholder replies with no request identity.
  const clientFlag = get(event, 'isApiErrorMessage');
  if (rawModel === '<synthetic>' && values.every((value) => value === 0) && (clientFlag === true || (clientFlag === false && isNone(requestId))))
    return true;
  if (typeof requestId !== 'string' || !(codePointLength(requestId) > 0 && codePointLength(requestId) <= 256)) throw new Unavailable();
  const key = JSON.stringify([id, requestId]);
  const current = { instant, model: modelName(rawModel), raw: rawModel, values };
  const prior = records.get(key);
  if (!prior) {
    records.set(key, current);
    return true;
  }
  if (!pyEqual(prior.raw, current.raw)) throw new Unavailable();
  const earliest = prior.instant <= current.instant ? prior.instant : current.instant;
  const before = prior.values;
  const after = current.values;
  if (before.every((value, index) => value === after[index])) {
    records.set(key, { ...prior, instant: earliest });
  } else if (after.every((value, index) => value >= before[index])) {
    // A streamed request can finish after local midnight.
    // Keep its earliest retained timestamp for its day and hour.
    records.set(key, { ...current, instant: earliest });
  } else if (!after.every((value, index) => value <= before[index])) {
    throw new Unavailable();
  } else {
    records.set(key, { ...prior, instant: earliest });
  }
  return true;
}

async function readFile(file, state, records, limits) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let pending = [];
    let pendingLength = 0;
    const handleLine = (line) => {
      state.lines += 1;
      state.bytesRead += line.length;
      if (state.lines > limits.MAX_LINES || line.length > limits.MAX_LINE_BYTES || state.bytesRead > limits.MAX_TOTAL_BYTES)
        throw new Unavailable();
      if (line.every((byte) => BLANK.has(byte))) return;
      let event;
      try {
        event = parseLine(decoder.decode(line));
      } catch {
        throw new Unavailable();
      }
      if (addRecord(records, event)) state.sawAssistant = true;
    };
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      let start = 0;
      for (;;) {
        const newline = chunk.indexOf(0x0a, start);
        if (newline === -1 || newline >= bytesRead) break;
        const piece = chunk.subarray(start, newline + 1);
        const line = pendingLength ? Buffer.concat([...pending, piece]) : Buffer.from(piece);
        pending = [];
        pendingLength = 0;
        handleLine(line);
        start = newline + 1;
      }
      if (start < bytesRead) {
        pending.push(Buffer.from(chunk.subarray(start, bytesRead)));
        pendingLength += bytesRead - start;
        if (pendingLength > limits.MAX_LINE_BYTES) throw new Unavailable();
      }
    }
    if (pendingLength) handleLine(Buffer.concat(pending));
  } finally {
    await handle.close();
  }
}

function summarize(records) {
  const days = new Map();
  for (const { instant, model, values } of records.values()) {
    const [date, hour] = newYorkDayAndHour(instant);
    if (!days.has(date)) {
      days.set(date, {
        date,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        requestCount: 0,
        models: new Map(),
        hours: Array(24).fill(0),
      });
    }
    const row = days.get(date);
    if (!row.models.has(model)) {
      row.models.set(model, {
        model,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        requestCount: 0,
      });
    }
    const modelRow = row.models.get(model);
    const amounts = [...values, values.reduce((total, value) => total + value, 0)];
    row.hours[hour] += amounts[4];
    for (const target of [row, modelRow]) {
      OUTPUT_KEYS.forEach((key, index) => {
        // Inexact float sums still compare correctly against the safe limit.
        if (target[key] + amounts[index] > MAX_SAFE) throw new Unavailable();
        target[key] += amounts[index];
      });
      if (target.requestCount >= MAX_SAFE) throw new Unavailable();
      target.requestCount += 1;
    }
  }
  return [...days.keys()].sort(compareText).map((date) => {
    const row = days.get(date);
    row.models = [...row.models.keys()].sort(compareText).map((name) => row.models.get(name));
    return row;
  });
}

/** Return complete, deduplicated daily numeric usage or a fail-closed status. */
// `now` is accepted for a common reader signature. This reader does not use the clock.
// `limits` lets tests lower the caps.
export async function collectClaudeUsage(claudeFolder, { now = new Date(), limits = {} } = {}) {
  void now;
  const caps = { MAX_FILES, MAX_TOTAL_BYTES, MAX_LINE_BYTES, MAX_LINES, ...limits };
  try {
    if (typeof claudeFolder !== 'string') return unavailable();
    const supplied = purePath(claudeFolder);
    if ((await isSymlink(supplied)) || !(await isDir(supplied))) return unavailable();
    const root = await realpath(supplied);
    const projects = pathApi.join(root, 'projects');
    if (!(await statOrIgnored(projects, true))) return notFound();
    if ((await isSymlink(projects)) || !(await isDir(projects)) || !samePath(await realpath(projects), projects)) return unavailable();
    const found = { files: [], totalBytes: 0 };
    await walk(projects, projects, found, caps);
    if (!found.files.length) return notFound();
    const records = new Map();
    const state = { sawAssistant: false, lines: 0, bytesRead: 0 };
    const sorted = found.files.map((file) => [pathParts(file), file]).sort((a, b) => compareParts(a[0], b[0]));
    for (const [, file] of sorted) {
      if ((await isSymlink(file)) || !(await isFile(file))) return unavailable();
      const resolved = await realpath(file);
      if (!beneath(resolved, projects) || !samePath(resolved, file)) return unavailable();
      const before = await fs.promises.stat(file, { bigint: true });
      await readFile(file, state, records, caps);
      const after = await fs.promises.stat(file, { bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs)
        return unavailable();
    }
    if (!state.sawAssistant || !records.size) return unavailable();
    return { provider: 'claude-code', status: 'ok', scope: 'Recorded Claude Code requests', days: summarize(records) };
  } catch {
    return unavailable();
  }
}

// Serialize like Python's json.dumps, with ", " and ": " separators.
export function pythonJson(value) {
  if (Array.isArray(value)) return `[${value.map(pythonJson).join(', ')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${pythonJson(item)}`).join(', ')}}`;
  return JSON.stringify(value);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const folder = process.argv[2];
  const result = folder === undefined ? unavailable() : await collectClaudeUsage(folder);
  process.stdout.write(`${pythonJson(result)}\n`);
}
