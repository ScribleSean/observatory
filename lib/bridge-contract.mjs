import contract from './bridge-contract.json' with { type: 'json' };

export { contract };
export const ACTIONS = Object.keys(contract.actions).filter(name => !contract.actions[name].reserved);
const own = (object, key) => Object.hasOwn(object, key);
const plain = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

// Keep number spelling and ordered object entries until validation is complete.
class Parser {
  constructor(text) { this.text = text; this.at = 0; this.duplicate = false; }
  fail() { throw new SyntaxError('Invalid bridge JSON'); }
  space() { while (' \t\r\n'.includes(this.text[this.at] ?? '\0')) this.at++; }
  take(char) { if (this.text[this.at] !== char) return false; this.at++; return true; }
  string() {
    if (!this.take('"')) this.fail();
    let value = '';
    while (this.at < this.text.length) {
      const char = this.text[this.at++];
      if (char === '"') return value;
      if (char.charCodeAt(0) < 32) this.fail();
      if (char !== '\\') { value += char; continue; }
      const escape = this.text[this.at++];
      const escapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      if (own(escapes, escape)) value += escapes[escape];
      else if (escape === 'u') {
        const hex = this.text.slice(this.at, this.at + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail();
        value += String.fromCharCode(parseInt(hex, 16)); this.at += 4;
      } else this.fail();
    }
    this.fail();
  }
  value(depth = 0) {
    this.space();
    const char = this.text[this.at];
    if (char === '{' || char === '[') {
      if (depth >= contract.message.maxDepth) this.fail();
      this.at++;
      const object = char === '{', end = object ? '}' : ']', values = [], keys = new Set();
      this.space();
      if (this.take(end)) return { kind: object ? 'object' : 'array', value: values };
      for (;;) {
        this.space();
        let key;
        if (object) {
          key = this.string(); this.space(); if (!this.take(':')) this.fail();
          if (keys.has(key)) this.duplicate = true;
          keys.add(key);
        }
        const value = this.value(depth + 1);
        values.push(object ? [key, value] : value);
        this.space(); if (this.take(end)) break;
        if (!this.take(',')) this.fail();
      }
      return { kind: object ? 'object' : 'array', value: values };
    }
    if (char === '"') return { kind: 'string', value: this.string() };
    for (const [word, value] of [['true', true], ['false', false], ['null', null]]) {
      if (this.text.startsWith(word, this.at)) { this.at += word.length; return { kind: word === 'null' ? 'null' : 'boolean', value }; }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(this.text.slice(this.at));
    if (!number) this.fail();
    this.at += number[0].length;
    return { kind: 'number', value: number[0] };
  }
  parse() { const node = this.value(); this.space(); if (this.at !== this.text.length) this.fail(); return node; }
}

function integer(node, min, max) {
  if (node?.kind !== 'number' || !/^-?(?:0|[1-9][0-9]*)$/.test(node.value) || node.value === '-0') return undefined;
  if (node.value.length > Math.max(String(min).length, String(max).length)) return undefined;
  const value = Number(node.value);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
}
function cleanString(text) {
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp < 32 || (cp >= 127 && cp <= 159) || (cp >= 0xd800 && cp <= 0xdfff)) return false;
  }
  return true;
}
const asciiDigit = char => char >= '0' && char <= '9';
const asciiLetter = char => (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z');
function ipv4(text) {
  const parts = text.split('.');
  if (parts.length !== 4 || parts.some(p => p.length < 1 || p.length > 3 || ![...p].every(asciiDigit) || (p.length > 1 && p[0] === '0') || Number(p) > 255)) return undefined;
  return parts.reduce((sum, p) => sum * 256 + Number(p), 0);
}
function address(text) {
  if ([...text].length > contract.address.maxLength) return false;
  if (!text.includes(':')) {
    const value = ipv4(text);
    return value !== undefined && contract.address.ipv4.some(([base, prefix]) => Math.floor(value / 2 ** (32 - prefix)) === Math.floor(ipv4(base) / 2 ** (32 - prefix)));
  }
  if (text.startsWith(':') || text.includes('%') || text.includes('.')) return false;
  const halves = text.split('::');
  if (halves.length > 2) return false;
  const groups = halves.flatMap(part => part === '' ? [] : part.split(':'));
  if (groups.length < (halves.length === 2 ? 2 : 8) || groups.length > (halves.length === 2 ? 7 : 8) || groups.some(p => !/^[0-9a-fA-F]{1,4}$/.test(p))) return false;
  const first = parseInt(groups[0], 16);
  return first >= contract.address.ipv6FirstGroup.min && first <= contract.address.ipv6FirstGroup.max;
}
function checked(rule, node) {
  if (rule.type === 'boolean') return node.kind === 'boolean' ? { value: node.value } : null;
  if (rule.type === 'integer') { const value = integer(node, rule.min, rule.max); return value === undefined ? null : { value }; }
  if (rule.type === 'deviceName' && rule.nullable && node.kind === 'null') return { value: null };
  if (node.kind !== 'string' || !cleanString(node.value)) return null;
  let value = node.value;
  const chars = [...value];
  switch (rule.type) {
    case 'enum': if (!rule.values.includes(value)) return null; break;
    case 'hex64': if (!/^[0-9a-f]{64}$/.test(value)) return null; break;
    case 'skin':
      if (!rule.bundled.includes(value) && !(chars.length >= 1 && chars.length <= rule.maxLength && chars.every((c, i) => asciiLetter(c) || asciiDigit(c) || (i > 0 && (c === ' ' || c === '-'))))) return null;
      break;
    case 'deviceName': {
      while (chars.length && contract.whiteSpace.includes(chars[0].codePointAt(0))) chars.shift();
      while (chars.length && contract.whiteSpace.includes(chars.at(-1).codePointAt(0))) chars.pop();
      value = chars.join('');
      if (value.length < rule.minUtf16 || value.length > rule.maxUtf16 || /[\p{Cc}\p{Cf}]/u.test(value) || rule.forbidden.some(c => value.includes(c))) return null;
      break;
    }
    case 'address': if (!address(value)) return null; break;
    case 'invitation':
      if (chars.length > rule.maxLength || !value.startsWith(rule.prefix) || value.length === rule.prefix.length || !Array.from(value.slice(rule.prefix.length)).every(c => asciiLetter(c) || asciiDigit(c) || c === '-' || c === '_')) return null;
      break;
    default: return null;
  }
  return { value };
}
function checkArgs(action, node) {
  if (!own(contract.actions, action) || contract.actions[action].reserved || node.kind !== 'object') return { ok: false };
  const rules = contract.actions[action].args, entries = new Map(node.value), args = {};
  if (entries.size !== node.value.length || [...entries.keys()].some(k => !own(rules, k))) return { ok: false };
  for (const [key, rule] of Object.entries(rules)) {
    const when = rule.presentWhen;
    const required = !when || (entries.get(when.key)?.kind === 'boolean' && entries.get(when.key).value === when.equals);
    if (entries.has(key) !== required) return { ok: false };
    if (!required) continue;
    const result = checked(rule, entries.get(key));
    if (!result) return { ok: false };
    Object.defineProperty(args, key, { value: result.value, enumerable: true, writable: true, configurable: true });
  }
  return { ok: true, args };
}
export function validateMessage(text) {
  const ignore = { outcome: 'ignore' };
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > contract.message.maxBytes) return ignore;
  let parser, node;
  try { parser = new Parser(text); node = parser.parse(); } catch { return ignore; }
  if (node.kind !== 'object') return ignore;
  const ids = node.value.filter(([key]) => key === 'id');
  if (ids.length !== 1) return ignore;
  const id = integer(ids[0][1], contract.message.id.min, contract.message.id.max);
  if (id === undefined) return ignore;
  const refused = { outcome: 'refused', id }, entries = new Map(node.value);
  if (parser.duplicate || entries.size !== contract.message.keys.length || [...entries.keys()].some(k => !contract.message.keys.includes(k))) return refused;
  const action = entries.get('action'), args = entries.get('args');
  if (action?.kind !== 'string' || !args) return refused;
  const result = checkArgs(action.value, args);
  return result.ok ? { outcome: 'accepted', id, action: action.value, args: result.args } : refused;
}
export function validateArgs(action, args) {
  if (typeof action !== 'string' || !plain(args)) return { ok: false };
  const entries = [];
  for (const key of Reflect.ownKeys(args)) {
    const descriptor = Object.getOwnPropertyDescriptor(args, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !own(descriptor, 'value')) return { ok: false };
    const value = descriptor.value;
    let node;
    if (typeof value === 'boolean') node = { kind: 'boolean', value };
    else if (typeof value === 'string') node = { kind: 'string', value };
    else if (value === null) node = { kind: 'null', value };
    else if (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)) node = { kind: 'number', value: String(value) };
    else return { ok: false };
    entries.push([key, node]);
  }
  return checkArgs(action, { kind: 'object', value: entries });
}
export function encodeMessage(id, action, args) {
  const result = validateArgs(action, args);
  if (!result.ok || !Number.isInteger(id) || id < contract.message.id.min || id > contract.message.id.max) throw new TypeError('Invalid bridge message');
  const text = JSON.stringify({ id, action, args: result.args });
  if (validateMessage(text).outcome !== 'accepted') throw new TypeError('Invalid bridge message');
  return text;
}
