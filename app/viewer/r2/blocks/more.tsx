// Lane d's part of the registry: the Limits, Tokens, Screen time, Drift and Settings views, and the
// LimitMeter and GrokRequests blocks the Overview's "Limits now" block is built from.
import { Limits } from '../views/Limits';
import { Tokens } from '../views/Tokens';
import { ScreenTime } from '../views/ScreenTime';
import { Drift } from '../views/Drift';
import { Settings } from '../views/Settings';

export { LimitMeter } from './LimitMeter';
export { GrokRequests, GrokRequestsRow } from './GrokRequests';

/** View id to component. Each takes {snapshot, scope, now}. Limits, Drift and Settings ignore the device chips and the range. */
export const MORE_VIEWS = { limits: Limits, tokens: Tokens, screen: ScreenTime, drift: Drift, settings: Settings } as const;
export const UNSCOPED_VIEWS: Partial<Record<keyof typeof MORE_VIEWS, string>> = {
  limits: 'Limits are account wide and show the current window',
  drift: 'Drift compares the latest read of every computer',
  settings: 'Settings apply everywhere',
};
