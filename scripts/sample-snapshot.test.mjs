import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleSnapshot, SAMPLE_UNKNOWN } from '../lib/sample-snapshot.mjs';
import { demoSnapshot, devices, limits, totals } from '../lib/panel-data.mjs';

const sum = values => values.reduce((total, value) => total + value, 0);
const fields = ['inputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} versus ${expected}`);

for (const stamp of ['2026-10-14T00:00:30Z', '2026-10-14T00:01:59Z', '2026-10-14T00:30:00Z', '2026-10-14T18:45:00Z']) {
  test(`shared sample invariants at ${stamp}`, () => {
    const now = Date.parse(stamp), snapshot = sampleSnapshot(now);
    assert.equal(demoSnapshot, sampleSnapshot);
    assert.deepEqual(snapshot, sampleSnapshot(now));
    assert.equal(snapshot.demo, true);
    assert.equal(snapshot.timezone, 'UTC');
    const read = now - Math.min(120000, now - new Date(now).setUTCHours(0, 0, 0, 0));
    assert.equal(snapshot.collectedAt, new Date(read).toISOString());
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of ['/Users/', '/home/', 'C:\\', '@', 'http://']) assert.ok(!serialized.includes(forbidden));
    assert.deepEqual([...new Set(serialized.match(/https:\/\/[^" ]+/g))], ['https://example.invalid/model-prices.json']);
    for (const name of Object.values(snapshot.deviceNames)) {
      assert.equal(typeof name, 'string');
      // 1 to 32 UTF-16 code units, as the Snapshot additions design sets.
      assert.ok(name.length >= 1 && name.length <= 32);
    }
    assert.deepEqual(devices(snapshot).map(row => row.label), ['Studio', 'Desk']);
    assert.deepEqual(limits(snapshot, now).map(row => row.remaining), [64, 12, 81, 47]);
    assert.equal(snapshot.claudeLimits.status, 'stale');
    assert.deepEqual(snapshot.claudeLimits.windows.map(row => Date.parse(row.resetsAt) - now), [130 * 60000, 3 * 86400000]);
    assert.deepEqual(snapshot.quota.windows.map(row => Date.parse(row.resetsAt) - now), [225 * 60000, 5 * 86400000]);
    assert.deepEqual(snapshot.quota.pace, [{ bucket: 'codex', window: 'primary', asOf: new Date(now - 90000).toISOString(),
      status: 'projected', estimatedExhaustionAt: new Date(now + 170 * 60000).toISOString() }]);
    const tokenSources = [...snapshot.tokens, ...snapshot.providerTokenSources, snapshot.combinedTokens];
    const readDate = new Date(read).toISOString().slice(0, 10);
    for (const source of [...tokenSources, ...snapshot.activity, snapshot.combined, ...snapshot.activityHistory]) {
      assert.equal(source.days[0].date, new Date(now).toISOString().slice(0, 10));
      assert.equal(source.days.length, 40);
      assert.equal(new Set(source.days.map(day => day.date)).size, 40);
      if (source === snapshot.combinedTokens) {
        assert.ok(source.days.every(day => day.hours === undefined));
        continue;
      }
      for (const day of source.days) {
        assert.equal(day.hours.length, 24);
        assert.ok(day.hours.every(value => Number.isFinite(value) && value >= 0));
        assert.equal(sum(day.hours), day.totalTokens ?? day.seconds);
        if (day.date === readDate) assert.ok(day.hours.slice(new Date(read).getUTCHours() + 1).every(value => value === 0));
      }
    }
    for (const source of tokenSources) for (const day of source.days) {
      assert.equal(day.models.length, 2);
      for (const field of fields) assert.equal(day[field], sum(day.models.map(model => model[field])));
      for (const row of [day, ...day.models]) {
        assert.equal(row.totalTokens, sum(fields.slice(0, 4).map(field => row[field])));
        assert.ok(row.reasoningOutputTokens <= row.outputTokens);
        const estimate = row.apiEstimate;
        assert.deepEqual(Object.keys(estimate).sort(), ['usd', 'parts', 'coveredTokens', 'excluded', 'checked'].sort());
        assert.deepEqual(Object.keys(estimate.parts), ['input', 'cached', 'cacheWrites', 'output']);
        assert.ok(Object.values(estimate.parts).every(value => Number.isFinite(value) && value >= 0));
        close(estimate.usd, sum(Object.values(estimate.parts)));
        assert.equal(estimate.coveredTokens, row.totalTokens);
        assert.equal(estimate.excluded, 0);
        assert.equal(estimate.checked, snapshot.prices.checkedOn);
      }
      close(day.apiEstimate.usd, sum(day.models.map(model => model.apiEstimate.usd)));
    }
    for (const [source, scale] of [[snapshot.tokens[0], 9.4e6], [snapshot.tokens[1], 5.1e6],
      [snapshot.combinedTokens, 14.5e6], [snapshot.providerTokenSources[0], 21e6], [snapshot.providerTokenSources[1], 8e6]]) {
      source.days.forEach((day, index) => assert.equal(day.totalTokens, Math.round(scale * (1 + (index * 7 % 5) / 4))));
    }
    for (const source of snapshot.tokens) for (const day of source.days) {
      assert.deepEqual(day.models.map(model => model.model), ['gpt-6-astra', 'gpt-5.6-terra']);
    }
    for (const source of snapshot.providerTokenSources) {
      assert.equal(source.scope, 'Recorded Claude Code requests');
      for (const day of source.days) {
        assert.deepEqual(day.models.map(model => model.model), ['claude-sonnet-4-20250514', 'claude-opus-5-5']);
        assert.equal(day.requestCount, sum(day.models.map(model => model.requestCount)));
      }
    }
    assert.deepEqual(snapshot.combinedTokens.verification, { status: 'verified' });
    assert.equal(snapshot.combinedTokens.status, 'ok');
    for (const day of snapshot.combinedTokens.days) {
      const peers = snapshot.tokens.map(source => source.days.find(row => row.date === day.date));
      for (const field of fields) assert.equal(day[field], sum(peers.map(row => row[field])));
    }
    for (const [source, scale] of [[snapshot.activity[0], 14000], [snapshot.activity[1], 9000], [snapshot.combined, 19000]]) {
      assert.deepEqual(snapshot.activityHistory.find(row => row.host === source.host).days, source.days);
      source.days.forEach((day, index) => {
        assert.equal(day.seconds, Math.round(scale * (1 + (index * 3 % 4) / 5)));
        assert.equal(day.trackedSeconds, day.seconds);
        assert.equal(sum(Object.values(day.categories)), day.seconds);
        for (const [category, seconds] of Object.entries(day.categories)) assert.equal(sum(Object.values(day.apps[category])), seconds);
      });
    }
    for (const row of snapshot.settings) {
      assert.equal(row.status, 'ok');
      assert.equal(row.profiles.length, 80);
      assert.ok(row.profiles.every(profile => profile.date && profile.model && profile.effort && profile.speed));
      assert.ok(row.tools.every(tool => tool.date && tool.category && tool.tool && tool.namespace && tool.count > 0));
    }
    for (const source of [snapshot.claudeLimits, snapshot.quota, snapshot.peerQuota]) {
      const history = source.history;
      assert.ok(history.length >= (source === snapshot.peerQuota ? 2 : 12));
      assert.equal(history.at(-1).checkedAt, source.checkedAt);
      assert.deepEqual(history.at(-1).windows, source.windows);
      history.slice(1).forEach((row, index) => assert.equal(Date.parse(row.checkedAt) - Date.parse(history[index].checkedAt), 300000));
    }
    assert.equal(snapshot.peerQuota.host, 'Windows');
    assert.equal(snapshot.peerQuota.provider, 'Codex');
    assert.equal(snapshot.peerQuota.status, 'ok');
    assert.ok(Date.parse(snapshot.peerQuota.receivedAt) >= Date.parse(snapshot.peerQuota.checkedAt));
    assert.equal(snapshot.peerQuota.windows[0].durationMinutes, 300);
    assert.notEqual(snapshot.peerQuota.windows[0].remainingPercent, snapshot.quota.windows[0].remainingPercent);
    assert.deepEqual(snapshot.claudeLimits.sessionCost, { usd: 3.42, observedAt: new Date(now - 360000).toISOString() });
    assert.deepEqual(snapshot.prices, { source: 'https://example.invalid/model-prices.json', checkedOn: new Date(now - 3 * 86400000).toISOString().slice(0, 10) });
    assert.equal(snapshot.dictation[0].host, 'Mac');
    assert.equal(snapshot.dictation[0].status, 'ok');
    assert.equal(snapshot.dictation[0].source, 'Wispr Flow');
    assert.equal(snapshot.dictation[0].days.length, 40);
    assert.ok(snapshot.dictation[0].days.every(day => ['transcriptions', 'words', 'audioSeconds'].every(key => Number.isFinite(day[key]))));
    assert.equal(snapshot.dictation[1].status, 'unavailable');
    assert.equal(snapshot.dictation[1].refusal, 'private-folder-refused');
    assert.equal(snapshot.dictation[1].days, undefined);
    // Now is exempt until D1-7 implements hourly totals in the panel.
    // All Claude tokens remain intentionally per device, with the By device label.
    for (const host of ['All', 'Mac', 'Windows']) for (const period of ['day', 'week', 'month', 'all']) {
      const values = totals(snapshot, host, period, new Date(now));
      for (const key of ['codexTokens', 'seconds', 'usd', ...(host === 'All' ? [] : ['claudeTokens'])]) assert.ok(Number.isFinite(values[key]), `${host} ${period} ${key}`);
    }
    close(totals(snapshot, 'All', 'day', new Date(now)).usd, 26.10);
    assert.ok(Object.isFrozen(SAMPLE_UNKNOWN));
    assert.ok(SAMPLE_UNKNOWN.length > 0);
    for (const entry of SAMPLE_UNKNOWN) {
      assert.ok(Object.isFrozen(entry));
      assert.ok(entry.reason.length > 0 && !entry.reason.includes('\n'));
      const value = entry.path.split('.').reduce((row, key) => row?.[key], snapshot);
      assert.ok(value == null || value === 'unavailable' || value.status === 'unavailable');
    }
  });
}

const requiredPaths = [
  'deviceNames.Mac', 'deviceNames.Windows', 'collectedAt', 'timezone',
  'claudeLimits.status', 'claudeLimits.checkedAt', 'claudeLimits.windows.*.remainingPercent',
  'claudeLimits.windows.*.resetsAt', 'claudeLimits.history.*.windows',
  'claudeLimits.sessionCost.usd', 'claudeLimits.sessionCost.observedAt',
  'quota.windows.*.remainingPercent', 'quota.pace.*.estimatedExhaustionAt', 'quota.history.*.windows',
  'peerQuota.windows.*.remainingPercent', 'peerQuota.history',
  'tokens.*.days.*.totalTokens', 'tokens.*.days.*.hours', 'tokens.*.days.*.models', 'tokens.*.days.*.apiEstimate.usd',
  'combinedTokens.days.*.totalTokens', 'combinedTokens.days.0.hours',
  'providerTokenSources.*.days.*.totalTokens', 'providerTokenSources.*.days.*.hours', 'providerTokenSources.*.days.*.apiEstimate.usd',
  'prices.source', 'prices.checkedOn',
  'activity.*.days.*.seconds', 'activity.*.days.*.hours', 'activity.*.days.*.categories', 'activity.*.days.*.apps',
  'combined.days.*.hours', 'activityHistory.*.days', 'settings.*.profiles', 'settings.*.tools',
  'dictation.0.days', 'dictation.1.days', 'dictation.1.refusal',
];

function incompletePaths(snapshot) {
  const unknown = new Set(SAMPLE_UNKNOWN.map(entry => entry.path));
  const failures = [];
  const complete = value => typeof value === 'number' ? Number.isFinite(value)
    : typeof value === 'string' ? value.trim().length > 0
    : Array.isArray(value) ? value.length > 0
    : value !== null && typeof value === 'object' && Object.keys(value).length > 0;
  function walk(value, parts, path) {
    if (parts.length === 0) {
      const valid = unknown.has(path)
        ? value == null || value === 'unavailable' || value.status === 'unavailable'
        : complete(value);
      if (!valid) failures.push(path);
      return;
    }
    const [key, ...rest] = parts;
    if (key === '*') {
      if (!Array.isArray(value) || value.length === 0) {
        failures.push([...path.split('.'), ...parts].join('.'));
        return;
      }
      value.forEach((entry, index) => walk(entry, rest, `${path}.${index}`));
    } else walk(value?.[key], rest, path ? `${path}.${key}` : key);
  }
  for (const path of requiredPaths) walk(snapshot, path.split('.'), '');
  return failures;
}

test('sample fields for all six views are complete except declared Unknown paths', () => {
  const snapshot = sampleSnapshot(Date.parse('2026-10-14T12:00:00Z'));
  assert.deepEqual(incompletePaths(snapshot), []);
  const missingPriceDate = structuredClone(snapshot);
  delete missingPriceDate.prices.checkedOn;
  assert.deepEqual(incompletePaths(missingPriceDate), ['prices.checkedOn']);
});
