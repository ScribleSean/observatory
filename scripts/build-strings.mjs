import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { format } from '../lib/format.mjs';
export { format } from '../lib/format.mjs';

const root = new URL('../', import.meta.url);
const notice = '// Generated from lib/strings.json by scripts/build-strings.mjs.\n';
const upper = name => name[0].toUpperCase() + name.slice(1);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keyPattern = /^[a-z][A-Za-z0-9]*$/;

export function normalizeNewlines(text) {
  return text.replace(/\r\n?/g, '\n');
}

export function validateStrings(raw) {
  if (!object(raw)) throw new Error('Strings must be an object');
  for (const [group, entries] of Object.entries(raw)) {
    if (!keyPattern.test(group) || !object(entries)) throw new Error(`Invalid strings group: ${group}`);
    for (const [key, value] of Object.entries(entries)) {
      if (!keyPattern.test(key)) throw new Error(`Invalid strings key: ${group}.${key}`);
      // C# refuses a member named like its enclosing class.
      if (key.toLowerCase() === group.toLowerCase()) throw new Error(`A key cannot repeat its group name: ${group}.${key}`);
      if (typeof value !== 'string' || value.length === 0) throw new Error(`Expected non-empty string: ${group}.${key}`);
      if (/[\p{Cc}\u2014;]/u.test(value)) throw new Error(`Forbidden character: ${group}.${key}`);
      if (/[{}]/.test(value.replace(/\{[a-z][A-Za-z0-9]*\}/g, ''))) throw new Error(`Malformed placeholder: ${group}.${key}`);
    }
  }
  return raw;
}

export function generatedStrings() {
  const strings = validateStrings(JSON.parse(readFileSync(new URL('lib/strings.json', root), 'utf8')));
  const swift = [notice + 'enum ObservatoryStrings {'];
  const windows = [notice + 'namespace WorkspaceObservatory;\n\ninternal static class ObservatoryStrings\n{'];
  const quote = value => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const swiftQuote = value => quote(value).replace(/\\u202([89])/g, '\\u{202$1}');
  for (const [group, entries] of Object.entries(strings)) {
    swift.push(`    enum ${upper(group)} {`);
    windows.push(`    internal static class ${upper(group)}\n    {`);
    for (const [key, value] of Object.entries(entries)) {
      swift.push(`        static let \`${key}\` = ${swiftQuote(value)}`);
      windows.push(`        internal const string ${upper(key)} = ${quote(value)};`);
    }
    swift.push('    }');
    windows.push('    }');
  }
  swift.push('}', '');
  windows.push('}', '');
  const typedFormat = normalizeNewlines(format.toString()).replace('function format(template, values)', 'function format(template: string, values: Record<string, string | number>): string');
  return new Map([
    ['lib/strings.generated.ts', `${notice}export const STRINGS = ${JSON.stringify(strings, null, 2)} as const;\n\nexport ${typedFormat}\n`],
    ['native/Strings.swift', swift.join('\n')],
    ['native/windows/Strings.cs', windows.join('\n')],
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [path, content] of generatedStrings()) {
    const file = new URL(path, root);
    if (process.argv.includes('--check')) {
      let actual;
      try { actual = normalizeNewlines(readFileSync(file, 'utf8')); } catch { actual = null; }
      if (actual !== content) {
        console.error(`${path} needs regeneration`);
        process.exitCode = 1;
      }
    } else writeFileSync(file, content);
  }
}
