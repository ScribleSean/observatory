import { Meter } from './Meter';
import { percent, type limits } from '../../../lib/panel-data.mjs';

type Limit = ReturnType<typeof limits>[number];

export function LimitRows({ rows }: { rows: Limit[] }) {
  return <>{rows.map((row, index) => <Meter key={index} {...row} value={percent(row.remaining)} />)}</>;
}
