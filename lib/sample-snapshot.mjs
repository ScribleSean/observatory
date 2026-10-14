// One fictional sample for every viewer page. Category and app labels come
// from the lists the activity reader accepts (scripts/activity-timeline.mjs).

// Fictional comparison rates in USD per million tokens, never billing data.
const fictionalRates = {
  'gpt-6-astra': [3, 0.5, 3, 6],
  'gpt-5.6-terra': [3, 0.5, 3, 6],
  'claude-sonnet-4-20250514': [2, 0.4, 2.5, 5],
  'claude-opus-5-5': [4, 0.8, 5, 10],
};
const fields = ['inputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'];
const sumCounts = rows => Object.fromEntries(fields.map(field => [field, rows.reduce((sum, row) => sum + row[field], 0)]));

function sampleEstimate(models, checked) {
  const parts = { input: 0, cached: 0, cacheWrites: 0, output: 0 };
  for (const model of models) {
    const counts = [model.inputTokens, model.cacheReadTokens, model.cacheCreationTokens, model.outputTokens];
    Object.keys(parts).forEach((key, index) => { parts[key] += counts[index] * fictionalRates[model.model][index] / 1e6; });
  }
  return { usd: Object.values(parts).reduce((sum, value) => sum + value, 0), parts,
    coveredTokens: models.reduce((sum, model) => sum + model.totalTokens, 0), excluded: 0, checked };
}

export const SAMPLE_UNKNOWN = Object.freeze([
  Object.freeze({ path: 'dictation.1.days', reason: 'Windows dictation is unavailable because its private folder was refused.' }),
  Object.freeze({ path: 'combinedTokens.days.0.hours', reason: 'The verified Codex aggregate has no hours until R2, so Codex Now for All is Unknown.' }),
]);

export function sampleSnapshot(now = Date.now()) {
  const iso = offset => new Date(now + offset).toISOString();
  // Every row is read two minutes before now. Days and hours follow that reading time,
  // so an hour that starts after it stays 0 and is never shown as an observed value.
  const read = now - 120000;
  const date = offset => new Date(read - offset * 86400000).toISOString().slice(0, 10);
  const checked = date(3);
  const hours = (total, index) => {
    const count = index === 0 ? new Date(read).getUTCHours() + 1 : 24;
    const base = Math.floor(total / count);
    return Array.from({ length: 24 }, (_, hour) => hour >= count ? 0 : base + (hour < total % count ? 1 : 0));
  };
  const days = (scale, names = ['gpt-6-astra', 'gpt-5.6-terra']) => Array.from({ length: 40 }, (_, index) => {
    const totalTokens = Math.round(scale * (1 + (index * 7 % 5) / 4));
    const first = Math.floor(totalTokens / 2);
    const models = names.map((model, m) => {
      const total = m === 0 ? first : totalTokens - first;
      const inputTokens = Math.floor(total / 5), cacheReadTokens = Math.floor(total * 3 / 5);
      const cacheCreationTokens = Math.floor(total / 10);
      const outputTokens = total - inputTokens - cacheReadTokens - cacheCreationTokens;
      const row = { model, inferred: false, inputTokens, cacheReadTokens, cacheCreationTokens, outputTokens,
        reasoningOutputTokens: Math.floor(outputTokens / 4), totalTokens: total,
        ...(model.startsWith('claude-') ? { requestCount: 20 + index + m } : {}) };
      return { ...row, apiEstimate: sampleEstimate([row], checked) };
    });
    return { date: date(index), ...sumCounts(models), hours: hours(totalTokens, index), models,
      ...(names[0].startsWith('claude-') ? { requestCount: models.reduce((sum, row) => sum + row.requestCount, 0) } : {}),
      apiEstimate: sampleEstimate(models, checked) };
  });
  const active = scale => Array.from({ length: 40 }, (_, index) => {
    const capacity = (index === 0 ? new Date(read).getUTCHours() + 1 : 24) * 3600;
    const seconds = Math.min(capacity, Math.round(scale * (1 + (index * 3 % 4) / 5)));
    const editors = Math.floor(seconds * 0.6), browser = seconds - editors;
    return { date: date(index), seconds, hours: hours(seconds, index), trackedSeconds: seconds,
      categories: { Editors: editors, Browser: browser },
      apps: { Editors: { 'VS Code': editors }, Browser: { Safari: browser } } };
  });
  const source = (host, scale) => ({ host, status: 'ok', checkedAt: iso(-120000), days: days(scale) });
  const tokens = [source('Mac', 9.4e6), source('Windows', 5.1e6)];
  const activity = [{ host: 'Mac', status: 'ok', checkedAt: iso(-120000), days: active(14000) },
    { host: 'Windows', status: 'ok', checkedAt: iso(-120000), days: active(9000) }];
  const combined = { host: 'Combined', status: 'ok', checkedAt: iso(-120000), days: active(19000) };
  const history = (checkedAt, windows, length = 12) => Array.from({ length }, (_, index) => ({
    checkedAt: new Date(Date.parse(checkedAt) - (length - 1 - index) * 300000).toISOString(),
    windows: windows.map(window => ({ ...window, remainingPercent: Math.min(100, window.remainingPercent + length - 1 - index) })),
  }));
  const snapshot = {
    demo: true, collectedAt: iso(-120000), timezone: 'UTC',
    deviceNames: { Mac: 'Studio', Windows: 'Desk' },
    claudeLimits: { status: 'stale', checkedAt: iso(-48 * 60000), windows: [
      { bucket: 'claude', window: 'five_hour', durationMinutes: 300, remainingPercent: 64, resetsAt: iso(130 * 60000) },
      { bucket: 'claude', window: 'seven_day', durationMinutes: 10080, remainingPercent: 12, resetsAt: iso(3 * 86400000) }] },
    quota: { status: 'ok', checkedAt: iso(-90000), windows: [
      { bucket: 'codex', window: 'primary', durationMinutes: 300, remainingPercent: 81, resetsAt: iso(225 * 60000) },
      { bucket: 'codex', window: 'secondary', durationMinutes: 10080, remainingPercent: 47, resetsAt: iso(5 * 86400000) }],
      pace: [{ bucket: 'codex', window: 'primary', asOf: iso(-90000), status: 'projected', estimatedExhaustionAt: iso(170 * 60000) }] },
    tokens,
    settings: tokens.map(row => ({ host: row.host, status: 'ok', checkedAt: iso(-120000), snapshotStable: true,
      profiles: row.days.flatMap(day => day.models.map(model => ({ ...model, date: day.date,
        effort: model.model === 'gpt-6-astra' ? 'medium' : 'high', speed: 'standard' }))),
      tools: row.days.flatMap((day, index) => [
        { date: day.date, category: 'Shell', tool: 'exec_command', namespace: 'functions', count: 12 + index },
        { date: day.date, category: 'File edits', tool: 'apply_patch', namespace: 'functions', count: 3 + index % 5 },
      ]),
    })),
    combinedTokens: { status: 'ok', verification: { status: 'verified' }, days: tokens[0].days.map((day, index) => {
      const peer = tokens[1].days[index];
      const models = day.models.map((model, m) => {
        const row = { model: model.model, inferred: false, ...sumCounts([model, peer.models[m]]) };
        return { ...row, apiEstimate: sampleEstimate([row], checked) };
      });
      // No hours here: the verified aggregate carries hours only after R2.
      return { date: day.date, ...sumCounts([day, peer]), models, apiEstimate: sampleEstimate(models, checked) };
    }) },
    providerTokenSources: [['Mac', 21e6], ['Windows', 8e6]].map(([host, scale]) => ({
      provider: 'claude-code', host, status: 'ok', checkedAt: iso(-120000), scope: 'Recorded Claude Code requests',
      days: days(scale, ['claude-sonnet-4-20250514', 'claude-opus-5-5']),
    })),
    activity, combined, activityHistory: [combined, ...activity].map(row => ({ ...row, latestReadStatus: 'ok',
      asOf: row.checkedAt, trackingStatus: 'recent', trackingThrough: iso(-180000) })),
    prices: { source: 'https://example.invalid/model-prices.json', checkedOn: checked },
    dictation: [
      { host: 'Mac', source: 'Wispr Flow', status: 'ok', checkedAt: iso(-120000),
        days: Array.from({ length: 40 }, (_, index) => ({ date: date(index), transcriptions: 3 + index,
          wordRecords: 3 + index, audioRecords: 3 + index,
          words: 42 * (index + 1), audioSeconds: 20 * (index + 1) })) },
      { host: 'Windows', source: 'Wispr Flow', status: 'unavailable', refusal: 'private-folder-refused', checkedAt: iso(-120000) },
    ],
  };
  snapshot.claudeLimits.history = history(snapshot.claudeLimits.checkedAt, snapshot.claudeLimits.windows);
  snapshot.claudeLimits.sessionCost = { usd: 3.42, observedAt: iso(-6 * 60000) };
  snapshot.quota.history = history(snapshot.quota.checkedAt, snapshot.quota.windows);
  const peerWindows = [{ bucket: 'codex', window: 'primary', durationMinutes: 300, remainingPercent: 43, resetsAt: iso(225 * 60000) }];
  snapshot.peerQuota = { host: 'Windows', provider: 'Codex', status: 'ok', checkedAt: iso(-5 * 60000),
    receivedAt: iso(-120000), windows: peerWindows, history: history(iso(-5 * 60000), peerWindows, 2) };
  return snapshot;
}

export function sampleBridgeStatus() {
  return {
    version: 1,
    app: { version: '0.3.14', build: 41 },
    sources: { activity: true, codex: true, claude: true, wispr: false, quota: true },
    skin: { current: 'sage', bundled: ['sage', 'almanac', 'instrument', 'amber-crt'], custom: ['Studio Night'] },
    deviceName: 'Studio', startup: true, appearance: 'system', limitsConsent: false,
    pairing: { state: 'unpaired', peerFingerprint: null, transport: 'none', invitationKept: false },
    sharing: {
      'codex-limits': { enabled: false, canEnable: false, reason: 'pairing-unavailable', token: null },
      'claude-code-tokens': { enabled: false, canEnable: false, reason: 'pairing-unavailable', token: null },
    },
  };
}
