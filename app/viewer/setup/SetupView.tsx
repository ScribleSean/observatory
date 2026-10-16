import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { STRINGS } from '../../../lib/strings.generated';
import { SETUP_SOURCES, clampStep, sampleSetupStatus, setupSummary, stepLabel } from '../../../lib/view-setup.mjs';
import { contract } from '../../../lib/bridge-contract.mjs';
import { createBridge, type Bridge, type BridgeOutcome } from '../bridge';
import { createSettingsController, limitsConsentFlow, type SettingsController } from '../settings/controller';
import { createFakeBridge } from '../settings/fake-bridge';
import { validateBridgeStatus, type BridgeStatus } from '../settings/status';
import '../settings/settings.css';
import './setup.css';

const S = STRINGS.settings;
const W = STRINGS.setup;
type ContentProps = {
  status: BridgeStatus | null; step: number; available: boolean; busy: boolean; message: string; disclosureOpen: boolean;
  onStep: (step: number) => void; onSource: (id: string, enabled: boolean) => void;
  onLimits: (enabled: boolean) => void; onConfirm: () => void; onCancel: () => void; onFinish: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
  statusUnavailable?: boolean; onRetry?: () => void;
};
export function SetupContent({ status, step, available, busy, message, disclosureOpen, onStep, onSource, onLimits, onConfirm, onCancel, onFinish, headingRef, statusUnavailable, onRetry }: ContentProps) {
  const index = clampStep(step);
  const disabled = !available || !status || busy;
  const summary = setupSummary(status);
  const word = (value: boolean | null | undefined) => value == null ? S.unknown : value ? S.on : S.off;
  const toggle = (label: string, hint: string, value: boolean | null | undefined, change: (enabled: boolean) => void) => <div key={label}>
    <div className="ob-row ob-settings-toggle">
      <label className="ob-settings-switch"><input type="checkbox" aria-checked={value == null ? 'mixed' : value}
        ref={input => { if (input) input.indeterminate = value == null; }} checked={value ?? false}
        disabled={disabled || value == null} onChange={event => change(event.target.checked)} />{label}</label>
      <span className="ob-meta">{word(value)}</span>
    </div><p className="ob-meta">{hint}</p>
  </div>;
  return <div className="ob-settings ob-setup" aria-busy={busy}>
    <p className="ob-meta">{stepLabel(index)}</p>
    <output aria-live="polite">{busy ? S.working : message}</output>
    {!available && <p>{W.appOnly}</p>}
    {statusUnavailable && <><p role="alert">{W.statusUnavailable}</p><button type="button" disabled={busy} onClick={onRetry}>{W.retry}</button></>}
    <h3 ref={headingRef} tabIndex={-1}>{[W.sourcesTitle, W.pairingTitle, W.finishTitle][index]}</h3>
    {index === 0 && <>
      <p>{W.sourcesIntro}</p>
      {SETUP_SOURCES.map(({ id, label, hint }) => toggle(label, hint, status?.sources[id as keyof BridgeStatus['sources']], enabled => onSource(id, enabled)))}
      {toggle(S.claudeLimits, W.claudeLimitsHint, status?.limitsConsent, onLimits)}
      {disclosureOpen && <div className="ob-settings-disclosure"><ul>
        <li>{S.disclosureCommand}</li><li>{S.disclosureStorage}</li><li>{S.disclosureOff}</li>
      </ul><button type="button" disabled={disabled || status?.limitsConsent == null} onClick={onConfirm}>{S.turnOn}</button><button type="button" disabled={disabled} onClick={onCancel}>{S.cancel}</button></div>}
      <p>{W.sourcesNote}</p><p>{W.privacyNote}</p>
    </>}
    {index === 1 && <><p>{W.pairingIntro}</p><p>{W.pairingHow}</p><p>{W.pairingNoAccount}</p></>}
    {index === 2 && <><p>{W.finishIntro}</p><ul className="ob-setup-summary">
      {summary.rows.map(row => <li key={row.id}><span>{row.label}</span><span>{word(row.on)}</span></li>)}
    </ul>{status && summary.noneOn && <p>{W.finishNone}</p>}</>}
    <div className="ob-setup-navigation">
      {index > 0 && <button type="button" onClick={() => onStep(index - 1)}>{W.back}</button>}
      {index < 2 ? <button type="button" onClick={() => onStep(index + 1)}>{W.next}</button> : <button type="button" disabled={disabled} onClick={onFinish}>{W.finish}</button>}
    </div>
  </div>;
}

export function SetupView({ demo, bridge, onFinished, onBlockedChange }: { demo: boolean; bridge?: Bridge; onFinished: () => void; onBlockedChange?: (blocked: boolean) => void }) {
  const [controller, setController] = useState<SettingsController | null>(null);
  const [status, setStatus] = useState<BridgeStatus | null>(() => demo ? validateBridgeStatus(sampleSetupStatus()) : null);
  const [available, setAvailable] = useState(demo || !!bridge?.available);
  const [statusReadFinished, setStatusReadFinished] = useState(false);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const flow = useRef<ReturnType<typeof limitsConsentFlow> | null>(null);
  const generation = useRef(0);
  const running = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current !== step) heading.current?.focus();
    previousStep.current = step;
  }, [step]);
  const blocked = !available || (statusReadFinished && status === null);
  const previousBlocked = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (previousBlocked.current !== blocked) {
      previousBlocked.current = blocked;
      onBlockedChange?.(blocked);
    }
  }, [blocked, onBlockedChange]);
  const readStatus = useCallback((next: SettingsController) => {
    if (running.current) return;
    const ticket = generation.current;
    running.current = true;
    setBusy(true);
    void next.status().catch(() => {}).finally(() => {
      if (ticket !== generation.current) return;
      setStatusReadFinished(true);
      running.current = false;
      setBusy(false);
    });
  }, []);
  useEffect(() => {
    const transport = bridge ?? (demo ? createFakeBridge(sampleSetupStatus()) : createBridge());
    const next = createSettingsController(transport, () => generation.current);
    flow.current = limitsConsentFlow(next);
    setController(next);
    setAvailable(transport.available);
    const unsubscribe = next.subscribe(setStatus);
    setStatusReadFinished(false);
    setStatus(demo ? validateBridgeStatus(sampleSetupStatus()) : null);
    readStatus(next);
    // Read status again while Claude limits is Unknown, quietly and never during another read.
    let polling = false;
    const recoveryPoll = setInterval(() => {
      if (!transport.available || polling || running.current || next.getStatus()?.limitsConsent !== null) return;
      polling = true;
      void next.status().catch(() => {}).finally(() => { polling = false; });
    }, contract.limits.cacheRefreshSeconds * 1000);
    const clear = () => { generation.current++; running.current = false; flow.current?.cancel(); setDisclosureOpen(false); setBusy(false); };
    const hide = () => flushSync(clear);
    window.addEventListener('pagehide', hide);
    return () => {
      clear(); clearInterval(recoveryPoll); window.removeEventListener('pagehide', hide); unsubscribe(); next.dispose();
      if (!bridge) transport.dispose();
    };
  }, [bridge, demo, readStatus]);
  const run = (task: () => Promise<BridgeOutcome> | null, finish = false) => {
    if (running.current || !available || !status) return;
    const ticket = generation.current;
    const pending = task();
    if (!pending) return;
    running.current = true; setBusy(true); setMessage('');
    void pending.then(result => {
      if (ticket !== generation.current) return;
      setMessage(result.timedOut ? S.timedOut : S[result.code]);
      if (finish && result.code === 'done') onFinished();
    }).catch(() => { if (ticket === generation.current) setMessage(S.unavailable); }).finally(() => {
      if (ticket === generation.current) { running.current = false; setBusy(false); }
    });
  };
  return <SetupContent status={status} step={step} available={available} busy={busy} message={message} disclosureOpen={disclosureOpen} headingRef={heading}
    statusUnavailable={available && statusReadFinished && status === null} onRetry={() => { if (controller) readStatus(controller); }}
    onStep={value => { flow.current?.cancel(); setDisclosureOpen(false); if (!running.current) setMessage(''); setStep(clampStep(value)); }}
    onSource={(id, enabled) => run(() => controller!.setSource(id, enabled))}
    onLimits={enabled => { if (enabled) { flow.current?.request(); setDisclosureOpen(true); } else run(() => controller!.setLimitsConsent(false)); }}
    onConfirm={() => run(() => { const pending = flow.current?.confirm() ?? null; setDisclosureOpen(false); return pending; })}
    onCancel={() => { flow.current?.cancel(); setDisclosureOpen(false); }} onFinish={() => run(() => controller!.completeSetup(), true)} />;
}
