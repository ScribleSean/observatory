import { ProviderDot } from './ProviderDot';
import { Row } from './Row';

export type LimitProps = {
  provider: string;
  name: string;
  window: string;
  value: string;
  note?: string;
  low: boolean;
  spent?: boolean;
  stale?: boolean;
  remaining: number | null;
};

export const limitTone = (row: { low: boolean; spent?: boolean; remaining: number | null }) =>
  row.remaining === null ? '' : row.spent ? 'spent' : row.low ? 'warn' : '';

export function Meter(row: LimitProps) {
  const tone = limitTone(row);
  return (
    <div className="ob-limit" data-provider={row.provider} data-window={row.window || 'unknown'}>
      <Row>
        <span><ProviderDot provider={row.provider} />{row.name} <span className="ob-meta">{row.window}</span></span>
        <span className={row.remaining === null ? 'ob-num ob-unknown' : `ob-num ${tone}`.trim()}>{row.value}</span>
      </Row>
      {row.note && <div className={row.stale ? 'ob-meta warn' : 'ob-meta'}>{row.note}</div>}
      <div className="ob-bar" aria-hidden="true">
        {/* The bar keeps the product colour. Only the number turns amber or red. */}
        {row.remaining !== null && <i className={row.provider} style={{ width: `${row.remaining}%` }} />}
      </div>
    </div>
  );
}
