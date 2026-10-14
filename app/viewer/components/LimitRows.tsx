import { STRINGS, format } from '../../../lib/strings.generated';
import { Meter, Numeral, TextBar } from './index';
import type { limits } from '../../../lib/panel-data.mjs';

type Limit = ReturnType<typeof limits>[number];

export function LimitRows({ rows, style }: { rows: Limit[]; style: string }) {
  const children = rows.map((row, index) => {
    const props = { ...row, value: row.remaining === null ? STRINGS.status.unknown : format(STRINGS.formats.percent, { value: Math.round(row.remaining) }) };
    if (style === 'numeral') return <Numeral key={index} {...props} />;
    if (style === 'text') return <TextBar key={index} {...props} filledBlock={STRINGS.formats.filledBlock} emptyBlock={STRINGS.formats.emptyBlock} />;
    return <Meter key={index} {...props} />;
  });
  if (style === 'numeral') return <div className="ob-numerals">{children}</div>;
  if (style === 'text') return <div className="ob-textbars">{children}</div>;
  return <>{children}</>;
}
