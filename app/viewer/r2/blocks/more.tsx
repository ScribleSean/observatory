// Lane d's part of the dashboard: the Limits, Tokens, Screen time, Drift and Settings views, and the
// LimitMeter and GrokRequests blocks of the catalog (the Overview's "Limits now" is a LimitMeter).
import type { ComponentRenderProps } from '@json-render/react';
import type { GrokRequestsVM, LimitsVM } from '../../../../lib/view-r2.mjs';
import { resolveBlock } from '../../../../lib/view-r2.mjs';
import { patchScope, useR2 } from '../data';
import { Limits } from '../views/Limits';
import { Tokens } from '../views/Tokens';
import { ScreenTime } from '../views/ScreenTime';
import { Drift } from '../views/Drift';
import { Settings } from '../views/Settings';
import { PINS, blockList } from '../specs';
import { LimitMeter as MeterRows } from './LimitMeter';
import { GrokRequests as GrokBlock, GrokRequestsRow } from './GrokRequests';

type MeterProps = import('../../../../lib/r2-blocks.mjs').LimitMeterProps;
type GrokProps = import('../../../../lib/r2-blocks.mjs').GrokRequestsProps;

const VIEWS = { limits: Limits, tokens: Tokens, 'screen-time': ScreenTime, drift: Drift, settings: Settings } as const;

/** The view the shell draws for every tab but Overview and Sessions. */
export function MoreView({ title }: { title: string }) {
  const { view, snapshot, scope, now } = useR2();
  const View = VIEWS[view as keyof typeof VIEWS];
  if (!View) return <div className="grid"><section className="blk"><div className="empty"><b>{title}</b>This view is not part of this build.</div></section></div>;
  if (view === 'settings') return <Settings snapshot={snapshot as never} scope={scope} now={now} pins={PINS.map(pin => ({ id: pin.id, title: pin.title, blocks: blockList(pin.spec as never).map(block => block.name) }))} />;
  return <View snapshot={snapshot as never} scope={scope} now={now} />;
}

/**
 * "Limits now": the engine's windows, then Grok requests and Codex when they are on. An account limit is
 * never summed across computers, so each row names the computer it was read on.
 */
export function LimitMeter({ element }: ComponentRenderProps<MeterProps>) {
  const { snapshot, scope, now, frame } = useR2();
  const { engine: wanted, window = null } = element.props;
  const { engine: engines, headline } = resolveBlock('LimitMeter', { engine: wanted, window: null }, snapshot, scope, { now }) as { engine: LimitsVM['engines'][number] | null; headline: string };
  const all = (snapshot.view as { config?: { sources: Record<string, boolean> }[] } | undefined)?.config ?? [];
  const on = (key: string) => all.some(row => row.sources[key]);
  const grok = wanted === 'claude' && on('grokLimits') ? resolveBlock('GrokRequests', {}, snapshot, scope, { now }) as GrokRequestsVM | null : null;
  const hidden = [!on('codexLimits') && 'Codex is off', !on('grokLimits') && 'Grok is off', on('grokLimits') && grok && grok.total.value === 0 && 'Grok has no requests in this range'].filter(Boolean);
  return (
    <section className="blk" aria-label="Limits now">
      <div className="bh"><h3>Limits now</h3></div>
      <p className="sayline">{headline}</p>
      {engines ? <MeterRows engine={engines} windowId={window} now={now} timeZone={frame.timeZone} /> : <div className="empty"><b>Off</b>This limit is turned off in observatory.config.json.</div>}
      {grok && grok.total.value !== 0 && <GrokRequestsRow vm={grok} label={frame.period.label} />}
      {hidden.length > 0 && <div className="foot">{hidden.join('. ')}.</div>}
    </section>
  );
}

/** Grok requests per day over the block's scope, and the weekly limit when a reading is cached. */
export function GrokRequests({ element }: ComponentRenderProps<GrokProps>) {
  const { snapshot, scope, now, frame, today } = useR2();
  const vm = resolveBlock('GrokRequests', element.props, snapshot, patchScope(scope, element.props.scope), { now }) as GrokRequestsVM | null;
  if (!vm) return <section className="blk"><div className="bh"><h3>Grok</h3></div><div className="empty"><b>Grok is off</b>Turn it on with sources.grokLimits in observatory.config.json.</div></section>;
  return <GrokBlock vm={vm} timeZone={frame.timeZone} today={today} />;
}
