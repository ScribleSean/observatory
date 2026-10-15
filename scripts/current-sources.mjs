const native = (source) => source?.host === 'Mac' || source?.host === 'Windows';

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
    hasRetiredSources: mixedScope,
    ...(mixedScope
      ? {
          combinedTokens: { host: 'All', status: 'unavailable' },
          combinedSettings: { host: 'All', status: 'unavailable' },
        }
      : {}),
  };
}
