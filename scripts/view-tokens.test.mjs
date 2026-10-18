import test from 'node:test';
import assert from 'node:assert/strict';
import { tokensView, money } from '../lib/view-tokens.mjs';
import { sampleSnapshot } from '../lib/sample-snapshot.mjs';
import { devices, periodDays, today } from '../lib/panel-data.mjs';

const now = Date.parse('2026-10-14T12:00:00Z');
const checked = '2026-10-11';
const unknownEstimate = { usd: null, coveredTokens: null, totalTokens: null, partial: false };
const counts = { inputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 1, outputTokens: 4, totalTokens: 10 };
const priced = (extra = {}) => ({ usd: 1, coveredTokens: 10, excluded: 0, checked, ...extra });
const model = (extra = {}) => ({ model: 'fictional', ...counts, apiEstimate: priced(), ...extra });
const day = (extra = {}) => ({ date: '2026-10-14', ...counts, models: [model()], apiEstimate: priced(), ...extra });
const snapshot = (days = [day()]) => ({ timezone: 'UTC',
  tokens: [{ host: 'Mac', status: 'ok', days }],
  providerTokenSources: [{ provider: 'claude-code', host: 'Mac', status: 'ok', days: structuredClone(days) }],
});
const view = (source, options = {}) => tokensView(source, { host: 'Mac', period: 'week', now, ...options });
const sum = (days, field) => days.reduce((total, row) => total + row[field], 0);
function assertEmpty(block, status) {
  assert.equal(block.status, status);
  assert.deepEqual(Object.values(block.totals), [null, null, null, null, null]);
  assert.deepEqual(block.days, []);
  assert.deepEqual(block.models, []);
  assert.deepEqual(block.estimate, unknownEstimate);
}

test('sample Mac week uses recorded classes, estimates, prices and settings', () => {
  const source = sampleSnapshot(now);
  const result = view(source);
  for (const [provider, days] of [['codex', source.tokens[0].days], ['claude', source.providerTokenSources[0].days]]) {
    const selected = periodDays(days, 'week', today(source.timezone, now));
    const block = result[provider];
    assert.equal(block.status, 'ok');
    assert.equal(block.totals.total, sum(selected, 'totalTokens'));
    assert.equal(block.totals.total, block.totals.input + block.totals.cached + block.totals.cacheWrite + block.totals.output);
    assert.equal(block.estimate.usd, sum(selected.map(row => row.apiEstimate), 'usd'));
    assert.equal(block.estimate.coveredTokens, block.totals.total);
    assert.equal(block.estimate.partial, false);
    assert.equal(block.days.length, 30);
  }
  assert.deepEqual(result.devices, devices(source));
  assert.deepEqual(result.prices, source.prices);
  assert.deepEqual(new Set(result.settings[0].rows.map(row => row.effort)), new Set(['medium', 'high']));
  assert.deepEqual(result.claude.byDevice, []);
});

test('All uses only the verified aggregate and separate Claude devices', () => {
  const source = sampleSnapshot(now);
  source.combinedTokens.days = [day({ totalTokens: 7 })];
  const result = view(source, { host: 'All' });
  assert.equal(result.codex.status, 'ok');
  assert.equal(result.codex.totals.total, 7);
  assert.notEqual(result.codex.totals.total, sum(source.tokens.flatMap(row => row.days), 'totalTokens'));
  assertEmpty(result.claude, 'by-device');
  assert.deepEqual(result.claude.byDevice.map(row => row.label), ['Studio', 'Desk']);
  for (const row of result.claude.byDevice) {
    const device = view(source, { host: row.host }).claude;
    assert.equal(row.total, device.totals.total);
    assert.equal(row.usd, device.estimate.usd);
    assert.equal(row.status, device.status);
  }
  assert.equal(result.settings.length, 2);
});

test('All requires verification and aggregate scope', () => {
  for (const change of [s => { delete s.combinedTokens; }, s => { s.combinedTokens.verification.status = 'pending'; },
    s => { s.tokens.pop(); }, s => { s.settings.push({ host: 'Ubuntu', status: 'ok' }); }]) {
    const source = sampleSnapshot(now);
    change(source);
    assertEmpty(view(source, { host: 'All' }).codex, 'unverified');
  }
  const source = sampleSnapshot(now);
  source.combinedTokens.days = [];
  assertEmpty(view(source, { host: 'All' }).codex, 'no-records');
});

test('missing and unavailable device sources are unknown', () => {
  const source = snapshot();
  source.tokens[0].status = 'unavailable';
  source.providerTokenSources[0].status = 'unavailable';
  for (const provider of ['codex', 'claude']) {
    assertEmpty(view(source)[provider], 'unknown');
    assertEmpty(view({})[provider], 'unknown');
  }
});

test('read sources outside the period have no records', () => {
  const result = view(snapshot([day({ date: '2026-09-01' })]));
  for (const provider of ['codex', 'claude']) assertEmpty(result[provider], 'no-records');
});

test('invalid and missing counters propagate through totals and model groups', () => {
  for (const invalid of [undefined, null, '10', NaN, -1, Infinity]) {
    const result = view(snapshot([day(), day({ totalTokens: invalid, inputTokens: invalid,
      models: [model({ totalTokens: invalid, inputTokens: invalid })] })]));
    for (const provider of ['codex', 'claude']) {
      assert.equal(result[provider].totals.total, null);
      assert.equal(result[provider].totals.input, null);
      assert.equal(result[provider].models[0].total, null);
      assert.equal(result[provider].models[0].input, null);
      assert.equal(result[provider].estimate.totalTokens, null);
      assert.equal(result[provider].days[1].total, null);
    }
  }
});

test('Claude estimates missing on any day remain unknown', () => {
  const source = snapshot();
  source.providerTokenSources[0].days.push(day({ apiEstimate: undefined }));
  assert.deepEqual(view(source).claude.estimate, unknownEstimate);
});

test('entirely unpriced periods and models never become zero dollars', () => {
  const unpriced = priced({ usd: null, coveredTokens: 0, excluded: 1 });
  const result = view(snapshot([day({ apiEstimate: unpriced, models: [model({ apiEstimate: unpriced })] })]));
  assert.deepEqual(result.codex.estimate, { usd: null, coveredTokens: 0, totalTokens: 10, partial: true });
  assert.equal(result.codex.models[0].usd, null);
});

test('partially priced days retain only priced cost', () => {
  const result = view(snapshot([day({ totalTokens: 20, apiEstimate: priced({ excluded: 1 }),
    models: [model(), model({ model: 'unpriced', apiEstimate: priced({ usd: null, coveredTokens: 0, excluded: 1 }) })] })]));
  assert.deepEqual(result.codex.estimate, { usd: 1, coveredTokens: 10, totalTokens: 20, partial: true });
  assert.equal(result.codex.models.find(row => row.model === 'unpriced').usd, null);
});

test('invalid estimate fields invalidate the entire estimate', () => {
  for (const field of ['usd', 'coveredTokens']) {
    for (const invalid of [undefined, '1', NaN, -1, Infinity]) {
      const result = view(snapshot([day({ apiEstimate: priced({ [field]: invalid }) })]));
      assert.deepEqual(result.codex.estimate, unknownEstimate);
    }
  }
  assert.deepEqual(view(snapshot([day({ apiEstimate: priced({ usd: null }) })])).codex.estimate, unknownEstimate);
  const result = view(snapshot([day(), day({ apiEstimate: priced({ usd: null, coveredTokens: 0 }) })]));
  assert.equal(result.codex.estimate.usd, 1);
  assert.equal(result.codex.estimate.partial, true);
  assert.equal(view(snapshot([day({ apiEstimate: priced({ usd: 0 }) })])).codex.estimate.usd, 0);
});

test('model grouping sorts by total then name and skips missing model arrays', () => {
  const result = view(snapshot([day({ models: [model({ model: 'z' }), model({ model: 'a' }),
    model({ model: 'missing', totalTokens: null }), model({ model: 'large', totalTokens: 40 })] }),
  day({ models: undefined }), day({ models: [model({ model: 'a', apiEstimate: undefined })] })]));
  assert.deepEqual(result.codex.models.map(row => row.model), ['large', 'a', 'z', 'missing']);
  assert.equal(result.codex.models[1].total, 20);
  assert.equal(result.codex.models[1].usd, null);
  assert.equal(result.codex.totals.total, 30);
  for (const value of [priced({ excluded: 1 }), priced({ usd: -1 }), priced({ usd: '1' }), priced({ usd: NaN })])
    assert.equal(view(snapshot([day({ models: [model({ apiEstimate: value })] })])).codex.models[0].usd, null);
});

test('charts cover the anchored month independently of the selected period', () => {
  const source = snapshot([day(), day({ date: '2026-09-15', totalTokens: null }), day({ date: '2026-09-14' }),
    day({ date: '2026-10-15' }), day({ date: '2026-10-13' })]);
  for (const period of ['day', 'week', 'month', 'all']) {
    const result = view(source, { period });
    for (const provider of ['codex', 'claude']) assert.deepEqual(result[provider].days,
      [{ date: '2026-09-15', total: null }, { date: '2026-10-13', total: 10 }, { date: '2026-10-14', total: 10 }]);
  }
  source.timezone = 'America/Los_Angeles';
  assert.equal(view(source, { period: 'day', now: new Date('2026-10-14T01:00:00Z') }).codex.days.at(-1).date, '2026-10-13');
});

test('price metadata falls back independently to shared valid provider dates', () => {
  const source = snapshot();
  assert.deepEqual(view(source).prices, { checkedOn: null, source: null });
  for (const provider of ['codex', 'claude']) assert.equal(view(source)[provider].checkedOn, checked);
  source.providerTokenSources[0].days[0].apiEstimate.checked = '2026-10-10';
  assert.equal(view(source).claude.checkedOn, null);
  assert.equal(view(source).codex.checkedOn, checked);
  source.prices = { checkedOn: '2026-10-12', source: 'https://example.invalid/prices' };
  assert.deepEqual(view(source).prices, source.prices);
  for (const provider of ['codex', 'claude']) assert.equal(view(source)[provider].checkedOn, source.prices.checkedOn);
  source.prices = { checkedOn: 123, source: 'http://example.invalid' };
  assert.deepEqual(view(source).prices, { checkedOn: null, source: null });
  source.tokens[0].days[0].models[0].apiEstimate.checked = 'bad';
  assert.equal(view(source).codex.checkedOn, null);
  for (const provider of ['codex', 'claude']) assert.equal(view({})[provider].checkedOn, null);
});

test('missing Claude estimates do not discard the Codex price date', () => {
  const source = snapshot([day({ apiEstimate: priced({ checked: '2026-10-01' }), models: [] })]);
  delete source.providerTokenSources[0].days[0].apiEstimate;
  const result = view(source);
  assert.equal(result.prices.checkedOn, null);
  assert.equal(result.codex.checkedOn, '2026-10-01');
  assert.equal(result.claude.checkedOn, null);
  source.tokens[0].days.push(day({ apiEstimate: undefined, models: [] }));
  assert.equal(view(source).codex.checkedOn, '2026-10-01');
});

test('Claude All uses price dates from all device computations', () => {
  const source = snapshot();
  source.providerTokenSources.push({ provider: 'claude-code', host: 'Windows', status: 'ok', days: [day()] });
  assert.equal(view(source, { host: 'All' }).claude.checkedOn, checked);
  source.providerTokenSources[1].days[0].models[0].apiEstimate.checked = '2026-10-01';
  assert.equal(view(source, { host: 'All' }).claude.checkedOn, null);
});

test('verified aggregates that were not read remain unknown', () => {
  for (const status of [undefined, 'unavailable', 'not-connected']) {
    const source = sampleSnapshot(now);
    source.combinedTokens.status = status;
    assertEmpty(view(source, { host: 'All' }).codex, 'unknown');
  }
});

test('invalid day dates make the whole source unknown', () => {
  for (const date of [undefined, null, 20261014, '', '2026-1-14', 'invalid']) {
    for (const days of [[day({ date })], [day(), day({ date })]]) {
      const source = snapshot(days);
      for (const provider of ['codex', 'claude']) assertEmpty(view(source)[provider], 'unknown');
      const aggregate = sampleSnapshot(now);
      aggregate.combinedTokens.days = days;
      assertEmpty(view(aggregate, { host: 'All' }).codex, 'unknown');
    }
  }
});

test('Claude-only hosts populate devices, sole-host totals and settings', () => {
  const source = { providerTokenSources: snapshot().providerTokenSources };
  const result = view(source, { host: 'All' });
  assert.deepEqual(result.devices, [{ id: 'Mac', label: 'macOS' }]);
  assert.deepEqual(result.claude.byDevice, []);
  assert.equal(result.claude.status, 'ok');
  assert.equal(result.claude.totals.total, 10);
  assert.equal(result.claude.estimate.usd, 1);
  assert.deepEqual(result.settings, [{ host: 'Mac', label: 'macOS', status: 'unknown', rows: [] }]);
  source.providerTokenSources.unshift({ provider: 'claude-code', host: 'Windows', status: 'unavailable' });
  source.providerTokenSources.push({ provider: 'claude-code', host: 'Ubuntu', status: 'ok' });
  source.deviceNames = { Mac: '  Studio  ', Windows: ' ' };
  assert.deepEqual(view(source).devices, [{ id: 'Mac', label: 'Studio' }, { id: 'Windows', label: 'Windows' }]);
  source.providerTokenSources[0].status = 'not-connected';
  assert.deepEqual(view(source).devices, [{ id: 'Mac', label: 'Studio' }]);
});

test('device session cost is All only', () => {
  assert.deepEqual(view(sampleSnapshot(now), { host: 'Windows' }).claude.sessionCost,
    { usd: null, observedAt: null, status: 'all-only' });
});

test('session cost follows the shared Limits rule', () => {
  const cost = (usd, age, observedAt = new Date(now - age).toISOString()) =>
    view({ claudeLimits: { sessionCost: { usd, observedAt } } }, { host: 'All' }).claude.sessionCost;
  assert.deepEqual(cost(3, 360000), { usd: 3, observedAt: '2026-10-14T11:54:00.000Z', status: 'ok' });
  const unknown = { usd: null, observedAt: null, status: 'unknown' };
  assert.deepEqual(view({}, { host: 'All' }).claude.sessionCost, unknown);
  for (const usd of [-1, 10001, '3', null, NaN]) assert.deepEqual(cost(usd, 0), unknown);
  assert.deepEqual(cost(3, 0, 'not-a-date'), unknown);
  // The shared rule refuses a cost 10 minutes old or older and any future observation.
  assert.deepEqual(cost(3, 600000), unknown);
  assert.deepEqual(cost(3, -1000), unknown);
  assert.equal(cost(0, 0).status, 'ok');
  assert.equal(cost(10000, 599999).status, 'ok');
});

test('settings group by model effort and speed without changing collector values', () => {
  const source = snapshot();
  const profile = extra => ({ date: '2026-10-14', model: 'a', effort: 'ultra', speed: 'fast', totalTokens: 10, ...extra });
  source.settings = [{ host: 'Mac', status: 'ok', profiles: [profile({}), profile({}),
    profile({ model: 'z', totalTokens: 30 }), profile({ effort: 'high', totalTokens: null }),
    profile({ effort: '', speed: null }), profile({ effort: 'custom', speed: 'custom' }),
    profile({ date: '2026-10-13', totalTokens: 100 })] }];
  const result = view(source, { period: 'day' }).settings[0];
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.rows.map(row => row.totalTokens), [30, 20, 10, 10, null]);
  assert.equal(result.rows[1].effort, 'ultra');
  assert.equal(result.rows[2].effort, 'custom');
  assert.equal(result.rows[3].speed, 'unknown');
  assert.deepEqual(view(source, { period: 'now' }).settings[0], result);
  source.settings[0].profiles = [profile({ date: '2026-09-01' })];
  assert.equal(view(source).settings[0].status, 'no-records');
  source.settings[0].status = 'unavailable';
  assert.deepEqual(view(source).settings[0].rows, []);
  assert.equal(view(source).settings[0].status, 'unknown');
  assert.equal(view({}).settings[0].status, 'unknown');
});

test('Now leaves provider blocks empty while preserving settings and session cost', () => {
  for (const host of ['Mac', 'All']) {
    const result = view(sampleSnapshot(now), { host, period: 'now' });
    for (const provider of ['codex', 'claude']) assertEmpty(result[provider], 'hourly-unavailable');
    assert.equal(result.claude.sessionCost.status, host === 'All' ? 'ok' : 'all-only');
    assert.equal(result.settings[0].status, 'ok');
  }
});

test('money accepts only finite nonnegative numbers', () => {
  assert.equal(money(3.4), '3.40');
  assert.equal(money(0), '0.00');
  assert.equal(money(3.456), '3.46');
  for (const invalid of [null, NaN, -1, undefined, Infinity, '3.4']) assert.equal(money(invalid), null);
});

test('an empty snapshot never invents zero totals or dollars', () => {
  const result = view({});
  for (const provider of ['codex', 'claude']) {
    assertEmpty(result[provider], 'unknown');
    assert.equal(result[provider].estimate.usd, null);
  }
  assert.equal(result.claude.sessionCost.usd, null);
  assert.equal(JSON.stringify(result).includes(':0'), false);
});

test('a missing snapshot reads as empty', () => {
  for (const input of [null, undefined, []]) {
    const result = tokensView(input, { host: 'All', period: 'week', now: Date.parse('2026-10-14T12:00:00Z') });
    assert.equal(result.codex.status, 'unverified');
    assert.equal(result.claude.status, 'by-device');
    assert.equal(result.claude.sessionCost.usd, null);
  }
});

test('old device readings with ok status do not supply tokens, estimates or settings', () => {
  const data = sampleSnapshot(now);
  for (const key of ['tokens', 'providerTokenSources', 'settings'])
    for (const row of data[key]) row.checkedAt = new Date(Date.parse(data.collectedAt) - 660000).toISOString();
  const result = view(data);
  assertEmpty(result.codex, 'unknown');
  assertEmpty(result.claude, 'unknown');
  assert.equal(result.settings[0].status, 'unknown');
  assert.deepEqual(result.settings[0].rows, []);
  const all = view(data, { host: 'All' });
  assert.equal(all.codex.status, 'ok');
  assert.ok(all.claude.byDevice.every(row => row.total === null && row.status === 'unknown'));
});

test('tokens use snapshot time for local readings and peer lag', () => {
  for (const lag of [0, 9, 11]) {
    const data = snapshot();
    data.collectedAt = new Date(now - 1800000).toISOString();
    const checkedAt = new Date(Date.parse(data.collectedAt) - lag * 60000).toISOString();
    for (const key of ['tokens', 'providerTokenSources']) data[key][0].checkedAt = checkedAt;
    data.settings = [{ host: 'Mac', status: 'ok', checkedAt, profiles: [{ date: '2026-10-14', model: 'fictional', totalTokens: 10 }] }];
    const result = view(data);
    for (const provider of ['codex', 'claude']) {
      assert.equal(result[provider].totals.total, lag <= 10 ? 10 : null);
      assert.equal(result[provider].note.includes('as of'), lag > 10);
      assert.equal(view(data, { period: 'day', now: now + 86400000 })[provider].status, lag <= 10 ? 'no-records' : 'unknown');
    }
    assert.equal(result.settings[0].status, lag <= 10 ? 'ok' : 'unknown');
  }
});
