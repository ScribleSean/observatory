import type { LimitProps } from './Meter';
import { ProviderDot } from './ProviderDot';

export function Numeral(row: LimitProps) {
  return (
    <div data-provider={row.provider} data-window={row.window || 'unknown'}>
      <div className={row.low ? 'ob-figure warn' : 'ob-figure'}>{row.value}</div>
      <div><ProviderDot provider={row.provider} />{row.name} <span className="ob-meta">{row.window}</span></div>
      <div className={row.stale ? 'ob-meta warn' : 'ob-meta'}>{row.note}</div>
    </div>
  );
}
