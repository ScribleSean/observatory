import test from 'node:test';
import assert from 'node:assert/strict';
import { statusWord, refusalText, checkTime, sourceGroups, sourceTotals, dictationView } from '../lib/view-sources.mjs';

const now = Date.parse('2026-10-14T12:00:00Z');
const codes = ['ok', 'not-connected', 'partial', 'unavailable', 'not-found', 'stale', 'needs-auth', 'unsupported', 'rate-limited'];
const words = ['Read', 'Not connected', 'Partial coverage', 'Unavailable', 'Not found', 'Saved reading', 'Sign in required', 'Not supported', 'Usage check rate-limited'];
for (const [index, code] of codes.entries()) {
  void test(`status ${code}`, () => assert.equal(statusWord(code), words[index]));
}
for (const code of ['future-status', '', undefined, null, 4, 'constructor', '__proto__']) {
  void test(`unknown status ${String(code)}`, () => assert.equal(statusWord(code), 'Unknown'));
}
void test('refusals disclose no raw code or inferred cause', () => {
  const privateText = 'A private folder check failed, so this source was not read.';
  assert.equal(refusalText('private-folder-refused'), privateText);
  assert.equal(refusalText('ancestor-refused'), 'A private folder check failed at a parent folder, so this source was not read.');
  for (const code of ['synthetic-secret-code', '']) {
    assert.equal(refusalText(code), privateText);
    if (code) assert.ok(!refusalText(code).includes(code));
  }
  for (const code of [undefined, null, 4]) assert.equal(refusalText(code), null);
});
void test('check times preserve exact time and handle unknown and future readings', () => {
  for (const [age, label] of [[0, 'Checked just now'], [59999, 'Checked just now'], [120000, 'Checked 2m ago'], [7200000, 'Checked 2h 0m ago'], [-1, 'Checked just now'], [-120001, 'Check time is ahead of this device']]) {
    const iso = new Date(now - age).toISOString();
    assert.deepEqual(checkTime(iso, now), { label, iso,
      exact: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(now - age) });
  }
  for (const at of [undefined, null, '', 'garbage', 0]) assert.deepEqual(checkTime(at, now), { label: 'Last check: Unknown', exact: null, iso: null });
});
void test('all six source groups retain supported rows and device names', () => {
  const mac = { host: 'Mac', status: 'ok' }, win = { host: 'Windows', status: 'partial' }, other = { host: 'Other', status: 'ok' };
  const snapshot = { deviceNames: { Mac: '  Synthetic laptop  ', Windows: ' ' }, claudeLimits: mac, quota: win, peerQuota: win,
    activity: [mac, win, other], tokens: [mac, other], providerTokenSources: [{ ...win, provider: 'claude-code' }, { ...mac, provider: 'other' }],
    settings: [win], dictation: [{ ...mac, source: 'Synthetic voice' }, win] };
  const groups = sourceGroups(snapshot, now);
  assert.deepEqual(groups.map(group => group.id), ['limits', 'activity', 'codexTokens', 'claudeTokens', 'settings', 'dictation']);
  assert.deepEqual(groups.map(group => group.rows.length), [3, 2, 1, 1, 1, 2]);
  assert.deepEqual(groups[0].rows.map(row => row.device), [null, null, 'Windows']);
  assert.equal(groups[1].rows[0].device, 'Synthetic laptop (Mac)');
  assert.equal(groups[5].rows[1].name, 'Unknown');
  assert.equal(sourceGroups({ activity: [mac] }, now)[1].rows[0].device, 'macOS');
  assert.equal(sourceGroups({ peerQuota: other }, now)[0].rows.length, 0);
  for (const empty of [{}, null, undefined]) {
    const groups = sourceGroups(empty, now);
    assert.equal(groups.length, 6);
    assert.ok(groups.every(group => group.rows.length === 0));
  }
});
void test('totals exclude disconnected rows and order status words', () => {
  const groups = sourceGroups({ activity: [...codes, 'future-status', 'ok'].map(status => ({ host: 'Mac', status })) });
  assert.deepEqual(sourceTotals(groups), { read: 2, total: 10,
    byStatus: [...words.filter(word => word !== 'Not connected'), 'Unknown'].map(word => ({ word, count: word === 'Read' ? 2 : 1 })) });
  assert.deepEqual(sourceTotals(sourceGroups({})), { read: 0, total: 0, byStatus: [] });
  assert.deepEqual(sourceTotals(sourceGroups({ quota: { status: 'not-connected' } })), { read: 0, total: 0, byStatus: [] });
});
const day = { date: '2026-10-14', transcriptions: 4, wordRecords: 4, words: 120, audioRecords: 4, audioSeconds: 120 };
const source = { host: 'Mac', source: 'Synthetic A', status: 'ok', days: [day] };
const snapshot = sources => ({ timezone: 'UTC', dictation: sources });
void test('a read row shows no refusal sentence, a refused row does', () => {
  const snapshot = { activity: [
    { host: 'Mac', status: 'ok', refusal: 'private-folder-refused' },
    { host: 'Windows', status: 'unavailable', refusal: 'ancestor-refused' },
  ] };
  const [read, refused] = sourceGroups(snapshot, 0)[1].rows;
  assert.equal(read.refusal, null);
  assert.equal(refused.refusal, 'A private folder check failed at a parent folder, so this source was not read.');
});

void test('old ok device sources count as saved readings and dictation stays Unknown', () => {
  const checkedAt = new Date(now - 660000).toISOString();
  const row = { host: 'Windows', source: 'Synthetic A', status: 'ok', checkedAt, days: [] };
  const data = { activity: [row], tokens: [row], settings: [row], dictation: [row],
    providerTokenSources: [{ ...row, provider: 'claude-code' }] };
  const groups = sourceGroups(data, now);
  assert.deepEqual(sourceTotals(groups).read, 0);
  for (const group of groups) for (const source of group.rows) {
    assert.equal(source.status, 'stale');
    assert.equal(source.check.iso, checkedAt);
  }
  const result = dictationView(data, {}, now).cards[0];
  assert.deepEqual([result.records, result.words, result.audio], ['Unknown', 'Unknown', 'Unknown']);
  assert.deepEqual(result.chart, []);
});

void test('sources and dictation measure lag within an old snapshot', () => {
  for (const lag of [0, 9, 11]) {
    const collectedAt = new Date(now - 1800000).toISOString();
    const checkedAt = new Date(Date.parse(collectedAt) - lag * 60000).toISOString();
    const data = { ...snapshot([{ ...source, checkedAt }]), collectedAt };
    const result = dictationView(data, {}, now).cards[0];
    assert.equal(result.records, lag <= 10 ? '4' : 'Unknown');
    assert.equal(result.note.includes('as of'), lag > 10);
    assert.equal(result.check.label.includes('as of'), lag > 10);
    assert.equal(sourceTotals(sourceGroups(data, now)).read, lag <= 10 ? 1 : 0);
    assert.equal(dictationView(data, { period: 'day' }, now + 86400000).cards[0].records, lag <= 10 ? 'No records' : 'Unknown');
  }
});
