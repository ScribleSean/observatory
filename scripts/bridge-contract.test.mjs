import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { contract, ACTIONS, validateMessage, validateArgs, encodeMessage } from '../lib/bridge-contract.mjs';
import { generatedBridgeContract, swiftLiteral, csLiteral, validateContract } from './build-bridge-contract.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const vectors = [];
const add = (name, text, expect) => vectors.push({ name, text, expect });
const message = (action, args, id = 1) => JSON.stringify({ id, action, args });
const accepted = (action, args) => ({ action, args });
const sample = rule => {
  switch (rule.type) {
    case 'boolean': return true;
    case 'integer': return rule.min;
    case 'enum': return rule.values[0];
    case 'hex64': return 'a'.repeat(64);
    case 'skin': return rule.bundled[0];
    case 'deviceName': return 'Example';
    case 'address': return '10.0.0.1';
    case 'invitation': return rule.prefix + 'Ab09-_';
    default: throw new Error('Unknown test rule');
  }
};
for (const action of ACTIONS) {
  const rules = contract.actions[action].args;
  const args = Object.fromEntries(Object.entries(rules).map(([key, rule]) => [key, sample(rule)]));
  add(`${action} accepted`, message(action, args), accepted(action, args));
  add(`${action} unknown action`, message(action + '-unknown', args), 'refused');
  add(`${action} extra argument`, message(action, { ...args, extra: true }), 'refused');
  for (const [key, rule] of Object.entries(rules)) {
    const missing = { ...args }; delete missing[key];
    add(`${action} missing ${key}`, message(action, missing), 'refused');
    const wrong = rule.type === 'boolean' ? [1, 'true', null, {}, []] : rule.type === 'integer' ? ['1024', true, null, {}, []] : [true, 1, {}, [], ...(rule.nullable ? [] : [null])];
    for (const value of wrong) add(`${action} ${key} wrong type ${JSON.stringify(value)}`, message(action, { ...args, [key]: value }), 'refused');
    if (rule.type === 'integer') {
      for (const value of [rule.min - 1, rule.max + 1]) add(`${action} ${key} bound ${value}`, message(action, { ...args, [key]: value }), 'refused');
      for (const value of [rule.min, rule.max]) add(`${action} ${key} inclusive ${value}`, message(action, { ...args, [key]: value }), accepted(action, { ...args, [key]: value }));
      for (const literal of ['1.0', '1e3', '1024.0', '1024e0', '-0', '9'.repeat(500)]) {
        const text = message(action, { ...args, [key]: 'REPLACE' }).replace('"REPLACE"', literal);
        add(`${action} ${key} literal ${literal.slice(0, 20)}`, text, 'refused');
      }
    } else if (rule.type !== 'boolean') {
      for (const value of ['x'.repeat(rule.maxLength ? rule.maxLength + 1 : rule.maxUtf16 ? rule.maxUtf16 + 1 : 100), '../x', 'C:\\x', '/etc/passwd', 'a/b']) {
        add(`${action} ${key} invalid string ${value.slice(0, 16)}`, message(action, { ...args, [key]: value }), 'refused');
      }
      for (const cp of [0, 31, 127, 133, 159]) {
        const value = String.fromCodePoint(cp);
        add(`${action} ${key} control escaped ${cp}`, message(action, { ...args, [key]: 'REPLACE' }).replace('REPLACE', '\\u' + cp.toString(16).padStart(4, '0')), 'refused');
        add(`${action} ${key} control raw ${cp}`, message(action, { ...args, [key]: 'REPLACE' }).replace('REPLACE', value), cp < 32 ? 'ignore' : 'refused');
      }
      for (const escape of ['\\uD800', '\\uDC00', '\\uD800x', '\\uD800\\uD800', '\\uDC00\\uD800']) {
        add(`${action} ${key} surrogate ${escape}`, message(action, { ...args, [key]: 'REPLACE' }).replace('REPLACE', escape), 'refused');
      }
    }
  }
}
for (const [name, action, args] of [
  ['slash combining mark', 'set-device-name', { name: 'a/\u0301b' }],
  ['backslash combining mark', 'set-device-name', { name: 'a\\\u0301' }],
  ['colon combining mark', 'set-device-name', { name: 'a:\u0301' }],
  ['mode combining mark', 'set-appearance', { mode: 'dark\u0301' }],
  ['skin Kelvin sign', 'set-skin', { skin: '\u212A' }],
  ['channel combining mark', 'set-sharing', { channel: 'codex-limits\u0301', enabled: false }],
  ['invitation suffix combining mark', 'pairing-join-claim', { invitation: 'observatory-pair:v1:\u0301Ab' }],
  ['invitation prefix combining mark', 'pairing-join-claim', { invitation: 'observatory-pair:v1\u0301:Ab' }],
  ['IPv6 combining mark', 'pairing-host-start', { address: 'fd00:\u0301:1', port: 1024 }],
  ['IPv4 combining mark', 'pairing-host-start', { address: '10.0.0.1\u0301', port: 1024 }],
  ['argument key combining mark', 'set-startup', { 'enabled\u0301': true }],
]) add(name, message(action, args), 'refused');
add('action key combining mark', JSON.stringify({ id: 1, 'action\u0301': 'status', args: {} }), 'refused');
add('name combining mark unchanged', message('set-device-name', { name: 'e\u0301x' }), accepted('set-device-name', { name: 'e\u0301x' }));
const sharing = { channel: 'codex-limits', enabled: false };
add('sharing disabled', message('set-sharing', sharing), accepted('set-sharing', sharing));
add('sharing disabled token', message('set-sharing', { ...sharing, token: 'a'.repeat(64) }), 'refused');
add('sharing uppercase', message('set-sharing', { ...sharing, enabled: true, token: 'A'.repeat(64) }), 'refused');
add('sharing condition numeric', message('set-sharing', { ...sharing, enabled: 1, token: 'a'.repeat(64) }), 'refused');
for (const [name, value, normalized] of [
  ['null', null, null], ['trimmed', '\u3000\u00a0 Example \u00a0\u3000', 'Example'],
  ['32 units', 'x'.repeat(32), 'x'.repeat(32)], ['emoji 32 units', 'x'.repeat(30) + '😀', 'x'.repeat(30) + '😀'],
  ['16 emoji', '😀'.repeat(16), '😀'.repeat(16)], ['combining', 'e\u0301', 'e\u0301']
]) add(`name ${name}`, message('set-device-name', { name: value }), accepted('set-device-name', { name: normalized }));
for (const value of ['x'.repeat(33), 'x'.repeat(31) + '😀', '😀'.repeat(17), '\u200b', '/', '\\', ':', '', '\u3000\u00a0 ', '\tExample', '\u0085Example']) add(`name refused ${JSON.stringify(value)}`, message('set-device-name', { name: value }), 'refused');
add('surrogate pair escape', '{"id":1,"action":"set-device-name","args":{"name":"\\ud83d\\ude00"}}', accepted('set-device-name', { name: '😀' }));
for (const skin of [...contract.actions['set-skin'].args.skin.bundled, 'Custom Skin-2', 'a'.repeat(32)]) add(`skin ${skin}`, message('set-skin', { skin }), accepted('set-skin', { skin }));
for (const skin of ['a'.repeat(33), ' leading', '-leading', '', 'é']) add(`skin refused ${skin}`, message('set-skin', { skin }), 'refused');
const addresses = [
  ['10.0.0.0', true], ['10.255.255.255', true], ['11.0.0.0', false], ['9.255.255.255', false],
  ['172.15.255.255', false], ['172.16.0.0', true], ['172.16.0.1', true], ['172.31.255.255', true], ['172.32.0.0', false],
  ['100.63.255.255', false], ['100.64.0.0', true], ['100.64.0.1', true], ['100.127.255.255', true], ['100.128.0.0', false],
  ['192.167.255.255', false], ['192.168.0.0', true], ['192.168.1.1', true], ['192.168.255.255', true], ['192.169.0.0', false],
  ['10.01.0.1', false], ['10.0.0.0.1', false], ['10.0.0.256', false], ['8.8.8.8', false], ['10..0.1', false],
  ['fd12::1', true], ['fd12:0:1:2:3:4:5:6', true], ['fc00::1', true], ['fdff::1', true], ['FDFF::ABCD', true],
  ['fbff::1', false], ['fe00::1', false], ['::1', false], ['fd00:::1', false], ['fd00::1::2', false],
  ['fd00::1%en0', false], ['fd00::10.0.0.1', false], ['f'.repeat(40), false], ['fd00::', false],
  ['fd00:1::', true], ['fd00:1:2:3:4:5:6::', true], ['fd00:1:2:3:4:5:6:7::', false],
  ['fd00:1:2:3:4:5:6:', false], ['fd00:1:2:3:4:5:6', false], [':fd00:1:2:3:4:5:6', false],
  ['fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true]
];
for (const [address, ok] of addresses) {
  const args = { address, port: 1024 };
  add(`address ${address}`, message('pairing-host-start', args), ok ? accepted('pairing-host-start', args) : 'refused');
}
const prefix = contract.actions['pairing-join-claim'].args.invitation.prefix;
for (const [invitation, ok] of [[prefix + 'abc-_', true], ['wrong:abc', false], [prefix, false], [prefix + 'a=', false], [prefix + 'a.', false], [prefix + 'a'.repeat(2048 - prefix.length), true], [prefix + 'a'.repeat(2049 - prefix.length), false]]) {
  const args = { invitation };
  add(`invitation ${invitation.length} ${invitation.slice(-3)}`, message('pairing-join-claim', args), ok ? accepted('pairing-join-claim', args) : 'refused');
}
for (const [name, text, expect] of [
  ['reserved', message('complete-setup', {}), 'refused'],
  ['duplicate action', '{"id":1,"action":"status","action":"status","args":{}}', 'refused'],
  ['duplicate args', '{"id":1,"action":"status","args":{},"args":{}}', 'refused'],
  ['duplicate argument', '{"id":1,"action":"set-startup","args":{"enabled":true,"enabled":false}}', 'refused'],
  ['escaped duplicate', '{"id":1,"action":"set-startup","args":{"enabled":true,"enabl\\u0065d":false}}', 'refused'],
  ['duplicate deep', '{"id":1,"action":"status","args":{"extra":[{"x":1,"x":2}]}}', 'refused'],
  ['duplicate id', '{"id":1,"id":1,"action":"status","args":{}}', 'ignore'],
  ['escaped duplicate id', '{"id":1,"i\\u0064":2,"action":"status","args":{}}', 'ignore'],
  ['extra top key', '{"id":1,"action":"status","args":{},"extra":1}', 'refused'],
  ['missing args', '{"id":1,"action":"status"}', 'refused'],
  ['missing action', '{"id":1,"args":{}}', 'refused'],
  ['action number', '{"id":1,"action":1,"args":{}}', 'refused'],
  ['args array', message('status', []), 'refused'],
  ['args null', message('status', null), 'refused'],
  ['id missing', '{"action":"status","args":{}}', 'ignore'],
  ['id decimal', '{"id":1.0,"action":"status","args":{}}', 'ignore'],
  ['id exponent', '{"id":1e0,"action":"status","args":{}}', 'ignore'],
  ['id negative zero', '{"id":-0,"action":"status","args":{}}', 'ignore'],
  ['id huge', '{"id":' + '9'.repeat(500) + ',"action":"status","args":{}}', 'ignore'],
  ['top array', '[]', 'ignore'], ['invalid JSON', '{', 'ignore'], ['BOM', '\ufeff' + message('status', {}), 'ignore'],
  ['trailing comma', '{"id":1,"action":"status","args":{},}', 'ignore'],
  ['argument trailing comma', '{"id":1,"action":"status","args":{"x":1,}}', 'ignore'],
  ['trailing value', message('status', {}) + ' false', 'ignore'], ['comment', message('status', {}) + '//comment', 'ignore'],
  ['non JSON whitespace', message('status', {}) + '\u00a0', 'ignore'],
  ['single quotes', "{'id':1}", 'ignore'], ['NaN', '{"id":1,"action":"status","args":{"x":NaN}}', 'ignore'],
  ['leading zero', '{"id":01,"action":"status","args":{}}', 'ignore'],
  ['invalid escape', '{"id":1,"action":"status","args":{"x":"\\x00"}}', 'ignore'],
  ['short unicode escape', '{"id":1,"action":"status","args":{"x":"\\u123"}}', 'ignore'],
  ['trailing JSON whitespace', message('status', {}) + ' \r\n\t', accepted('status', {})],
  ['escaped keys', '{"i\\u0064":1,"action":"stat\\u0075s","args":{}}', accepted('status', {})],
  ['prototype key', '{"id":1,"action":"__proto__","args":{}}', 'refused'],
  ['prototype arg', '{"id":1,"action":"status","args":{"__proto__":{}}}', 'refused']
]) add(name, text, expect);
for (const id of [0, 2147483648, '1', 1.5, true, null, -1]) add(`invalid id ${JSON.stringify(id)}`, message('status', {}, id), 'ignore');
add('maximum id', message('status', {}, 2147483647), accepted('status', {}));
for (const size of [4096, 4097]) {
  const base = message('set-device-name', { name: 'é' });
  const text = base.replace('é', 'é' + 'x'.repeat(size - Buffer.byteLength(base)));
  assert.equal(Buffer.byteLength(text), size);
  add(`UTF8 ${size}`, text, size === 4096 ? 'refused' : 'ignore');
}
for (const [label, raw] of [['high', '\ud800'], ['low', '\udfff'], ['high followed by ASCII', '\ud800x']]) {
  add(`raw ${label} argument`, message('set-device-name', { name: 'REPLACE' }).replace('REPLACE', raw), 'refused');
  add(`raw ${label} argument key`, message('set-device-name', { REPLACE: 'Example' }).replace('REPLACE', raw), 'refused');
  add(`raw ${label} top key`, message('status', {}).replace('action', 'action' + raw), 'refused');
  add(`raw ${label} id key`, message('status', {}).replace('id', 'id' + raw), 'ignore');
  add(`raw ${label} id value`, message('status', {}, 'REPLACE').replace('REPLACE', raw), 'ignore');
}
for (const raw of ['\ud800', '\udfff', '😀']) {
  const base = message('set-device-name', { name: 'REPLACE' }).replace('REPLACE', raw);
  for (const size of [4096, 4097]) {
    const text = base + ' '.repeat(size - Buffer.byteLength(base));
    add(`raw UTF8 ${raw.charCodeAt(0)} bytes ${size}`, text, size > 4096 ? 'ignore' : raw.isWellFormed() ? accepted('set-device-name', { name: raw }) : 'refused');
  }
}
for (const depth of [16, 17]) {
  const text = '{"id":1,"action":"status","args":{"x":' + '['.repeat(depth - 2) + '0' + ']'.repeat(depth - 2) + '}}';
  add(`depth ${depth}`, text, depth === 16 ? 'refused' : 'ignore');
}

function expected(vector) {
  const outcome = typeof vector.expect === 'string' ? vector.expect : 'accepted';
  if (outcome === 'ignore') return { outcome };
  const id = vector.name === 'maximum id' ? 2147483647 : 1;
  return outcome === 'refused' ? { outcome, id } : { outcome, id, ...vector.expect };
}
for (const vector of vectors) test(vector.name, () => assert.deepEqual(validateMessage(vector.text), expected(vector)));

test('non-string inputs are ignored', () => {
  for (const value of [null, undefined, true, 1, {}, [], new String(message('status', {}))]) assert.deepEqual(validateMessage(value), { outcome: 'ignore' });
});
test('raw lone surrogates count as three UTF8 bytes', () => {
  const base = message('set-device-name', { name: 'REPLACE' }).replace('REPLACE', '\ud800');
  assert.deepEqual(validateMessage(base), { outcome: 'refused', id: 1 });
  const atLimit = base + ' '.repeat(4096 - Buffer.byteLength(base));
  assert.equal(validateMessage(atLimit).outcome, 'refused');
  assert.equal(validateMessage(atLimit + ' ').outcome, 'ignore');
});
test('generated files and check command are current', () => {
  const run = spawnSync(process.execPath, ['scripts/build-bridge-contract.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  for (const [path, content] of generatedBridgeContract()) assert.equal(readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n'), content);
});
test('generator rejects malformed data and checks normalized output', async () => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'bridge-generator-')));
  for (const path of ['scripts', 'lib', 'native/windows']) mkdirSync(join(temp, path), { recursive: true });
  const script = join(temp, 'scripts/build-bridge-contract.mjs');
  const dataPath = join(temp, 'lib/bridge-contract.json');
  writeFileSync(script, readFileSync(join(root, 'scripts/build-bridge-contract.mjs')));
  writeFileSync(dataPath, JSON.stringify(contract));
  const generator = await import(pathToFileURL(script).href);
  const mutations = [
    data => { data.extra = true; },
    data => { delete data.codes; },
    data => { data.message.maxBytes = '4096'; },
    data => { data.message.maxDepth = 1.5; },
    data => { data.message.id.max = 0; },
    data => { data.message.keys.push('extra'); },
    data => { data.limits.extra = 1; },
    data => { data.whiteSpace.push(0xd800); },
    data => { data.address.ipv4[0] = ['10.01.0.0', 8]; },
    data => { data.address.ipv4[0][1] = 33; },
    data => { data.values.appearance = [true]; },
    data => { data.actions.status.reserved = 1; },
    data => { data.actions.status.extra = true; },
    data => { data.actions['set-skin'].args.skin.type = 'unknown'; },
    data => { data.actions['set-skin'].args.skin.extra = true; },
    data => { data.actions['set-skin'].args.skin.maxLength = null; },
    data => { data.actions['set-source'].args.source.values = []; },
    data => { data.actions['set-device-name'].args.name.nullable = 'true'; },
    data => { data.actions['set-device-name'].args.name.forbidden = ['xx']; },
    data => { data.actions['set-sharing'].args.token.presentWhen = null; },
    data => { data.actions['set-sharing'].args.token.presentWhen.equals = 1; },
    data => { data.actions['set-sharing'].args.token.presentWhen.key = 'channel'; },
    data => { data.actions['pairing-join-claim'].args.invitation.prefix = ''; }
  ];
  for (const mutate of mutations) {
    const data = structuredClone(contract);
    mutate(data);
    writeFileSync(dataPath, JSON.stringify(data));
    assert.throws(() => generator.generatedBridgeContract(), /Invalid bridge contract data/);
  }
  writeFileSync(dataPath, JSON.stringify(contract));
  assertRun(spawnSync(process.execPath, [script], { encoding: 'utf8' }));
  for (const [path, content] of generator.generatedBridgeContract()) writeFileSync(join(temp, path), content.replace(/\n/g, '\r\n'));
  assertRun(spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' }));
  writeFileSync(join(temp, 'native/BridgeContract.swift'), 'stale');
  const stale = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /native\/BridgeContract\.swift needs regeneration/);
});
test('page helpers validate and round trip', () => {
  assert.deepEqual(validateArgs('set-device-name', { name: ' Example ' }), { ok: true, args: { name: 'Example' } });
  assert.deepEqual(validateMessage(encodeMessage(1, 'set-device-name', { name: ' Example ' })), { outcome: 'accepted', id: 1, action: 'set-device-name', args: { name: 'Example' } });
  for (const [action, args] of [['set-startup', { enabled: 1 }], ['set-startup', { enabled: 'true' }], ['pairing-host-start', { address: '10.0.0.1', port: -0 }], ['status', []], ['status', new Date()], ['status', { toJSON() { return {}; } }], ['status', { get x() { throw new Error('Getter called'); } }], ['status', { [Symbol('x')]: true }], ['complete-setup', {}], ['unknown', {}]]) {
    assert.deepEqual(validateArgs(action, args), { ok: false });
    assert.throws(() => encodeMessage(1, action, args), TypeError);
  }
  assert.throws(() => encodeMessage(0, 'status', {}), TypeError);
  assert.throws(() => encodeMessage(1.5, 'status', {}), TypeError);
  assert.deepEqual(validateArgs('status', Object.create(null)), { ok: true, args: {} });
});

const swiftHarness = String.raw`import Foundation
func outputFor(_ result: BridgeValidation) throws -> Data {
    var output: [String: Any] = [:]
    switch result {
    case .ignore: output["outcome"] = "ignore"
    case .refused(let id): output = ["outcome": "refused", "id": id]
    case .accepted(let id, let action, let args):
        var values: [String: Any] = [:]
        for (key, value) in args {
            switch value {
            case .bool(let v): values[key] = v
            case .integer(let v): values[key] = v
            case .string(let v): values[key] = v
            case .null: values[key] = NSNull()
            }
        }
        output = ["outcome": "accepted", "id": id, "action": action, "args": values]
    }
    let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
    return data
}
while let line = readLine() {
    let bytes = Array(Data(base64Encoded: line)!)
    var units: [UInt16] = []
    for i in stride(from: 0, to: bytes.count, by: 2) {
        let low = UInt16(bytes[i])
        let high = UInt16(bytes[i + 1]) << 8
        units.append(low | high)
    }
    let data = try outputFor(BridgeContract.validate(utf16: units))
    let text = units.withUnsafeBufferPointer { NSString(characters: $0.baseAddress!, length: $0.count) }
    let nsData = try outputFor(BridgeContract.validate(text))
    precondition(nsData == data)
    print(String(decoding: data, as: UTF8.self))
}
`;
const csHarness = String.raw`using System;
using System.Collections.Generic;
using System.Text.Json;
using WorkspaceObservatory;
string? line;
while ((line = Console.ReadLine()) is not null)
{
    var bytes = Convert.FromBase64String(line);
    var units = new char[bytes.Length / 2];
    for (int i = 0; i < units.Length; i++) units[i] = (char)(bytes[2 * i] | bytes[2 * i + 1] << 8);
    var result = BridgeContract.Validate(new string(units));
    var output = new Dictionary<string, object?> { ["outcome"] = result.Outcome };
    if (result.Id.HasValue) output["id"] = result.Id.Value;
    if (result.Outcome == "accepted")
    {
        output["action"] = result.Action;
        var args = new Dictionary<string, object?>();
        foreach (var pair in result.Args!)
        {
            var value = pair.Value;
            args[pair.Key] = value.Kind switch { "bool" => value.Boolean, "integer" => value.Integer, "string" => value.Text, _ => null };
        }
        output["args"] = args;
    }
    Console.WriteLine(JsonSerializer.Serialize(output));
}
`;
function assertRun(run) { assert.equal(run.status, 0, `${run.error ?? ''}\n${run.stdout}\n${run.stderr}`); }
function compare(run) {
  assertRun(run);
  const lines = run.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, vectors.length);
  for (let i = 0; i < vectors.length; i++) assert.deepEqual(JSON.parse(lines[i]), validateMessage(vectors[i].text), vectors[i].name);
}
const input = vectors.map(v => Buffer.from(v.text, 'utf16le').toString('base64')).join('\n') + '\n';
test('Swift matches every shared vector', { timeout: 180000 }, t => {
  if (!swiftAvailable(t)) return;
  const temp = mkdtempSync(join(tmpdir(), 'bridge-swift-'));
  writeFileSync(join(temp, 'main.swift'), swiftHarness);
  const compile = spawnSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-module-cache-path', join(temp, 'cache'), join(root, 'native/BridgeContract.swift'), join(temp, 'main.swift'), '-o', join(temp, 'bridge')], { encoding: 'utf8', env: process.env, timeout: 150000 });
  assertRun(compile);
  compare(spawnSync(join(temp, 'bridge'), [], { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30000 }));
  t.diagnostic(`${vectors.length} vectors compared through both Swift entries, ${vectors.filter(v => !v.text.isWellFormed()).length} with raw lone surrogates`);
});
test('C# matches every shared vector', { timeout: 360000 }, t => {
  const executable = process.platform === 'win32' ? 'dotnet.exe' : 'dotnet';
  const folders = [
    process.env.DOTNET_ROOT, process.env.DOTNET_ROOT_X64,
    ...(process.env.PATH ?? '').split(delimiter),
    ...(process.platform === 'win32' ? [process.env.ProgramFiles && join(process.env.ProgramFiles, 'dotnet')] : []),
    ...(process.platform === 'darwin' ? ['/usr/local/share/dotnet', '/opt/homebrew/opt/dotnet/libexec'] : []),
    join(homedir(), '.dotnet')
  ];
  const dotnet = folders.filter(Boolean).map(dir => join(dir, executable)).find(path => existsSync(path));
  if (!dotnet) {
    assert.ok(!(process.env.CI === 'true' && process.platform === 'win32'), 'dotnet is required in CI on Windows');
    return t.skip('dotnet not available');
  }
  const temp = mkdtempSync(join(tmpdir(), 'bridge-csharp-'));
  const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_CLI_HOME: temp };
  const sdk = spawnSync(dotnet, ['--version'], { cwd: temp, encoding: 'utf8', env, timeout: 30000 });
  assertRun(sdk);
  const major = Number(sdk.stdout.trim().split('.')[0]);
  assert.ok(major >= 6, 'C# 10 requires .NET SDK 6 or newer');
  writeFileSync(join(temp, 'Bridge.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net${major}.0</TargetFramework><LangVersion>10</LangVersion><Nullable>enable</Nullable><TreatWarningsAsErrors>true</TreatWarningsAsErrors><ImplicitUsings>disable</ImplicitUsings></PropertyGroup></Project>`);
  writeFileSync(join(temp, 'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>');
  writeFileSync(join(temp, 'BridgeContract.cs'), readFileSync(join(root, 'native/windows/BridgeContract.cs')));
  writeFileSync(join(temp, 'Program.cs'), csHarness);
  assertRun(spawnSync(dotnet, ['build', join(temp, 'Bridge.csproj'), '-o', join(temp, 'out'), '--nologo'], { cwd: temp, encoding: 'utf8', env, timeout: 300000 }));
  compare(spawnSync(dotnet, [join(temp, 'out/Bridge.dll')], { input: vectors.map(v => Buffer.from(v.text, 'utf16le').toString('base64')).join('\n') + '\n', encoding: 'utf8', env, maxBuffer: 8 * 1024 * 1024, timeout: 30000 }));
});

function swiftAvailable(t) {
  if (process.platform === 'darwin' && existsSync('/usr/bin/xcrun')) return true;
  assert.ok(!(process.env.CI === 'true' && process.platform === 'darwin'), 'xcrun is required in CI on macOS');
  t.skip('Swift requires darwin and /usr/bin/xcrun');
  return false;
}

const literalSamples = ['\\u0041', '"', '\\', '\u0001', '\u2028', '\u00e9', '😀'];
function decodeCsLiteral(literal) {
  assert.equal(literal[0], '"');
  assert.equal(literal.at(-1), '"');
  let result = '';
  for (let i = 1; i < literal.length - 1; i++) {
    if (literal[i] !== '\\') { result += literal[i]; continue; }
    const escape = literal[++i];
    if (escape === '"' || escape === '\\') result += escape;
    else {
      assert.equal(escape, 'u');
      const hex = literal.slice(i + 1, i + 5);
      assert.match(hex, /^[0-9a-f]{4}$/i);
      result += String.fromCharCode(parseInt(hex, 16));
      i += 4;
    }
  }
  return result;
}
test('native literals escape each unit without rewriting literal backslashes', () => {
  const swift = ['"\\\\u0041"', '"\\\""', '"\\\\"', '"\\u{0001}"', '"\\u{2028}"', '"\\u{00e9}"', '"\\u{1f600}"'];
  literalSamples.forEach((value, i) => {
    assert.equal(swiftLiteral(value), swift[i]);
    assert.equal(decodeCsLiteral(csLiteral(value)), value);
  });
  for (let unit = 0; unit <= 0xffff; unit++) {
    const value = String.fromCharCode(unit);
    assert.equal(decodeCsLiteral(csLiteral(value)), value);
    if (unit >= 0xd800 && unit <= 0xdfff) assert.throws(() => swiftLiteral(value), /Lone surrogate/);
  }
});
test('Swift literal output matches original bytes', { timeout: 180000 }, t => {
  if (!swiftAvailable(t)) return;
  const temp = mkdtempSync(join(tmpdir(), 'bridge-literals-'));
  writeFileSync(join(temp, 'main.swift'), literalSamples.map(value => `print(${swiftLiteral(value)})`).join('\n'));
  assertRun(spawnSync('/usr/bin/xcrun', ['swiftc', '-module-cache-path', join(temp, 'cache'), join(temp, 'main.swift'), '-o', join(temp, 'literals')], { encoding: 'utf8', timeout: 150000 }));
  const run = spawnSync(join(temp, 'literals'), [], { timeout: 30000 });
  assertRun(run);
  assert.deepEqual(run.stdout, Buffer.from(literalSamples.join('\n') + '\n'));
});
test('contract rejects controls and lone surrogates anywhere including keys', () => {
  for (const value of ['\u0000', '\u001f', '\u007f', '\u0085', '\u009f', '\ud800', '\udfff', '\ud800x']) {
    for (const mutate of [
      data => { data.source = value; },
      data => { data.values.appearance.push(value); },
      data => { data.actions['set-device-name'].args.name.forbidden = [value]; },
      data => { data.actions.status.args[value] = { type: 'boolean' }; }
    ]) {
      const data = structuredClone(contract);
      mutate(data);
      assert.throws(() => validateContract(data), /Invalid bridge contract data/);
    }
  }
  const data = structuredClone(contract);
  data.source = literalSamples.filter(value => value !== '\u0001').join('');
  assert.doesNotThrow(() => validateContract(data));
});
test('status limits are required positive integers and generated for every language', () => {
  const generated = generatedBridgeContract();
  const swift = generated.get('native/BridgeContract.swift');
  const cs = generated.get('native/windows/BridgeContract.cs');
  assert.ok(swift.includes('static let status = data["status"]'));
  for (const [key, value] of Object.entries(contract.status)) {
    assert.ok(generated.get('lib/bridge-contract.generated.ts').includes(`"${key}": ${value}`));
    assert.ok(swift.includes(`("${key}", BridgeNode("number", "${value}"))`));
    assert.ok(cs.includes(`new KeyValuePair<string, BridgeNode>("${key}", new BridgeNode("number", "${value}"))`));
    const name = 'Status' + key[0].toUpperCase() + key.slice(1);
    assert.ok(cs.includes(`${name} = Data["status"]["${key}"].Number`));
    for (const invalid of [0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1, undefined]) {
      const data = structuredClone(contract);
      data.status[key] = invalid;
      assert.throws(() => validateContract(data), /Invalid bridge contract data/);
    }
  }
  const data = structuredClone(contract);
  delete data.status;
  assert.throws(() => validateContract(data), /Invalid bridge contract data/);
});

test('contract numbers anywhere stay within nonnegative Int32 bounds', () => {
  const visit = (value, path = []) => {
    for (const [key, child] of Object.entries(value)) {
      const next = [...path, key];
      if (typeof child === 'number') {
        for (const invalid of [-1, 2147483648]) {
          const data = structuredClone(contract);
          const parent = next.slice(0, -1).reduce((node, part) => node[part], data);
          parent[key] = invalid;
          assert.throws(() => validateContract(data), /Invalid bridge contract data/, next.join('.'));
        }
      } else if (child !== null && typeof child === 'object') visit(child, next);
    }
  };
  visit(contract);
  const data = structuredClone(contract);
  data.limits.queue = 2147483647;
  assert.doesNotThrow(() => validateContract(data));
});
