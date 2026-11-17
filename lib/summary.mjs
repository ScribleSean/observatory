// The small feed the dashboard polls: the forecast and today's numbers, without the history.
// It also carries what the Week page draws: each limit window's forecast and the session ledger.
// The full combined.json is fetched only when someone opens the history.
import { weekFeed } from './view-week.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function summaryOf(combined) {
  if (!object(combined) || !object(combined.glance)) return null;
  const { lines: _lines, ...glance } = combined.glance;
  return {
    schema: combined.schema, generatedAt: combined.generatedAt, generatedBy: combined.generatedBy,
    ...(combined.demo === true ? { demo: true } : {}),
    devices: combined.devices ?? [], hub: combined.hub ?? null,
    timezone: combined.view?.timezone ?? null,
    week: weekFeed(combined),
    glance: { ...glance, today: (glance.today ?? []).map(({ categories: _categories, ...device }) => device) },
  };
}
