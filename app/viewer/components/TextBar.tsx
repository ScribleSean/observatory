import type { LimitProps } from './Meter';
import { Row } from './Row';

export function TextBar(row: LimitProps & { filledBlock: string; emptyBlock: string }) {
  const filled = row.remaining === null ? 0 : Math.round(row.remaining / 5);
  return (
    <div className="ob-limit" data-provider={row.provider} data-window={row.window || 'unknown'}>
      <Row>
        <span>{row.name} <span className="ob-meta">{row.window}</span></span>
        <span className={row.low ? 'ob-num warn' : 'ob-num'}>{row.value}</span>
      </Row>
      <div className="ob-blocks" aria-hidden="true">{Array.from({ length: 20 }, (_, cell) => (
        <span key={cell} className={cell < filled ? (row.low ? 'warn' : row.provider) : 'ob-meta'}>{cell < filled ? row.filledBlock : row.emptyBlock}</span>
      ))}</div>
      <div className={row.stale ? 'ob-meta warn' : 'ob-meta'}>{row.note}</div>
    </div>
  );
}
