// Presentation only. Never changes stored observations or measurement units.
export function durationText(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return 'Unknown';
  if (seconds === 0) return '0m';
  if (seconds < 60) return '<1m';
  const minutes = Math.floor(seconds / 60);
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60);
  return `${days ? days + 'd ' : ''}${hours || days ? hours + 'h ' : ''}${minutes % 60}m`;
}

export function compactCount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unknown';
  return new Intl.NumberFormat('en-US', {notation:'compact', maximumFractionDigits:1}).format(value);
}
