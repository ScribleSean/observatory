const native = (source) => source?.host === 'Mac' || source?.host === 'Windows';

// Read-only view of an existing snapshot. Keep its saved bytes and historical
// schemas intact. Public snapshots have no private inventory with which to
// re-verify a smaller sum, so legacy mixed-scope totals must remain Unknown.
export function projectCurrentSources(report) {
  const tokens = Array.isArray(report.tokens) ? report.tokens : [];
  const settings = Array.isArray(report.settings) ? report.settings : [];
  const retired = [...tokens, ...settings].filter((source) => !native(source));
  const mixedScope = retired.some(
    (source) =>
      source?.status !== 'not-connected' ||
      source?.days?.length ||
      source?.profiles?.length ||
      source?.tools?.length,
  );
  return {
    ...report,
    tokens: tokens.filter(native),
    settings: settings.filter(native),
    hasRetiredSources:
      mixedScope || Boolean(report.localModel?.records?.length),
    ...(mixedScope
      ? {
          combinedTokens: { host: 'All', status: 'unavailable' },
          combinedSettings: { host: 'All', status: 'unavailable' },
        }
      : {}),
  };
}
