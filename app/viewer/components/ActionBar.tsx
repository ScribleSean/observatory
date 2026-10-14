import { ArrowUpRight, CircleArrowUp, RefreshCw, Settings } from 'lucide-react';
import { STRINGS } from '../../../lib/strings.generated';

export type PanelAction = 'refresh' | 'check-updates' | 'open-settings' | 'open-dashboard';

export function ActionBar({ busy, onAction }: { busy: boolean; onAction: (name: PanelAction) => void }) {
  return (
    <nav className="ob-actions" aria-label={STRINGS.actions.navigation}>
      <button type="button" aria-label={STRINGS.actions.refresh} title={STRINGS.actions.refresh} disabled={busy} onClick={() => onAction('refresh')}><RefreshCw size={17} className={busy ? 'spin' : ''} aria-hidden="true" /></button>
      <button type="button" aria-label={STRINGS.actions.checkUpdates} title={STRINGS.actions.checkUpdates} onClick={() => onAction('check-updates')}><CircleArrowUp size={17} aria-hidden="true" /></button>
      <button type="button" aria-label={STRINGS.actions.settings} title={STRINGS.actions.settings} onClick={() => onAction('open-settings')}><Settings size={17} aria-hidden="true" /></button>
      <button type="button" className="wide" onClick={() => onAction('open-dashboard')}>{STRINGS.actions.openObservatory}<ArrowUpRight size={15} aria-hidden="true" /></button>
    </nav>
  );
}
