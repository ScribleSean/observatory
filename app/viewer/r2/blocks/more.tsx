// Lane d's part of the dashboard: the Limits, Tokens, Screen time, Drift and Settings views, and the
// LimitMeter and GrokRequests blocks of the catalog (the Overview's "Limits now" is a LimitMeter).
import { lazy, Suspense } from 'react';
import type { ComponentRenderProps } from '@json-render/react';
import type { GrokRequestsVM, LimitsVM } from '../../../../lib/view-r2.mjs';
import { resolveBlock } from '../../../../lib/view-r2.mjs';
import { limitsOn, patchScope, useR2 } from '../data';
import { PINS, blockList } from '../pins';
import { BlockBoundary } from '../Boundary';
import { Loading } from '../Loading';
import { LimitMeter as MeterRows } from './LimitMeter';
import { GrokRequests as GrokBlock, GrokRequestsRow } from './GrokRequests';

type MeterProps = import('../../../../lib/r2-blocks.mjs').LimitMeterProps;
type GrokProps = import('../../../../lib/r2-blocks.mjs').GrokRequestsProps;

// Each view loads on first open, so the first page carries only the shell and the Overview.
const Limits = lazy(() => import('../views/Limits').then(module => ({ default: module.Limits })));
const Tokens = lazy(() => import('../views/Tokens').then(module => ({ default: module.Tokens })));
const ScreenTime = lazy(() => import('../views/ScreenTime').then(module => ({ default: module.ScreenTime })));
const Drift = lazy(() => import('../views/Drift').then(module => ({ default: module.Drift })));
const Settings = lazy(() => import('../views/Settings').then(module => ({ default: module.Settings })));
const VIEWS = { limits: Limits, tokens: Tokens, 'screen-time': ScreenTime, drift: Drift } as const;

/** The view the shell draws for every tab but Overview and Sessions. */
export function MoreView({ title }: { title: string }) {
  const { view, snapshot, scope, now } = useR2();
  const View = VIEWS[view as keyof typeof VIEWS];
  if (view === 'settings') return <BlockBoundary key={view} name={title}><Suspense fallback={<Loading />}><Settings snapshot={snapshot as never} scope={scope} now={now} pins={PINS.map(pin => ({ id: pin.id, title: pin.title, blocks: blockList(pin.spec as never).map(block => block.name) }))} /></Suspense></BlockBoundary>;
  if (!View) return <div className="grid"><section className="blk"><div className="empty"><b>{title}</b>This view is not part of this build.</div></section></div>;
  return <BlockBoundary key={view} name={title}><Suspense fallback={<Loading />}><View snapshot={snapshot as never} scope={scope} now={now} /></Suspense></BlockBoundary>;
}

/**
 * "Limits now": the engine's windows, then Grok requests and Codex when they are on. An account limit is
 * never summed across computers, so each row names the computer it was read on.
 */
export function LimitMeter({ element }: ComponentRenderProps<MeterProps>) {
  const { snapshot, scope, now, frame } = useR2();
  const { engine: wanted, window = null } = element.props;
  // The lead is the stored forecast's sentence (the menu bar's line), read through the view-model and never recomputed here.
  const { engine: engines, headline } = resolveBlock('LimitMeter', { engine: wanted, window: null }, snapshot, scope, { now }) as { engine: LimitsVM['engines'][number] | null; headline: string };
  const overview = wanted === 'claude' && element.props.history !== true;
  // The Overview's block also carries Codex and Grok when their limits are on and in the scope. A source that is off
  // appears nowhere here (Settings lists it). A source that is on but has nothing in range gets one quiet line.
  const grokOn = limitsOn(snapshot, 'grok'), codexOn = limitsOn(snapshot, 'codex');
  const grok = overview && grokOn && scope.sources.includes('grok') ? resolveBlock('GrokRequests', {}, snapshot, scope, { now }) as GrokRequestsVM | null : null;
  const codexVm = overview && codexOn && scope.sources.includes('codex') ? (resolveBlock('LimitMeter', { engine: 'codex', window: null }, snapshot, scope, { now }) as { engine: LimitsVM['engines'][number] | null }).engine : null;
  // An engine the app reads as off (a free plan with nothing left, unless turned on) is off here too.
  const codex = codexVm && codexVm.windows.some(each => each.state !== 'off') ? codexVm : null;
  const hidden = overview ? [
    !codex && codexOn && !codexVm && 'Codex has no limit in this view',
    grokOn && (!grok || grok.total.value === 0) && 'Grok has no requests in this range',
  ].filter(Boolean) : [];
  return (
    <section className="blk" aria-label="Limits now">
      <div className="bh"><h3>Limits now</h3></div>
      <p className="sayline">{headline}</p>
      {engines ? <MeterRows engine={engines} windowId={window} now={now} timeZone={frame.timeZone} /> : <div className="empty"><b>Off</b>This limit is turned off in observatory.config.json.</div>}
      {grok && grok.total.value !== 0 && <GrokRequestsRow vm={grok} label={frame.period.label} />}
      {codex && <MeterRows engine={codex} now={now} timeZone={frame.timeZone} />}
      {hidden.length > 0 && <div className="foot">{hidden.join('. ')}.</div>}
    </section>
  );
}

/** Grok requests per day over the block's scope, and the weekly limit when a reading is cached. */
export function GrokRequests({ element }: ComponentRenderProps<GrokProps>) {
  const { snapshot, scope, now, frame, today } = useR2();
  const vm = resolveBlock('GrokRequests', element.props, snapshot, patchScope(scope, element.props.scope), { now }) as GrokRequestsVM | null;
  if (!vm) return <section className="blk"><div className="bh"><h3>Grok</h3></div><div className="empty"><b>Grok is off</b>Turn it on with sources.grokLimits in observatory.config.json.</div></section>;
  return <GrokBlock vm={vm} timeZone={frame.timeZone} today={today} now={now} />;
}
