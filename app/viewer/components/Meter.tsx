import { ProviderDot } from './ProviderDot';
import { Row } from './Row';

export type LimitProps = {
  provider: string;
  name: string;
  window: string;
  value: string;
  note: string;
  low: boolean;
  stale: boolean;
  remaining: number | null;
};

export function Meter(row: LimitProps) {
  return (
    <div className="ob-limit" data-provider={row.provider} data-window={row.window || 'unknown'}>
      <Row>
        <span><ProviderDot provider={row.provider} />{row.name} <span className="ob-meta">{row.window}</span></span>
        <span className={row.low ? 'ob-num warn' : 'ob-num'}>{row.value}</span>
      </Row>
      <div className={row.stale ? 'ob-meta ob-indent warn' : 'ob-meta ob-indent'}>{row.note}</div>
      <div className="ob-bar" aria-hidden="true">
        {row.remaining !== null && <i className={row.low ? 'warn' : row.provider} style={{ width: `${row.remaining}%` }} />}
      </div>
    </div>
  );
}
