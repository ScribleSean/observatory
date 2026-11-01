import { Fragment } from 'react';
import { STRINGS } from '../../../lib/strings.generated';

// A note such as "Resets in 4d 21h · runs out in 4d 5h" wraps only before a separator, never inside a duration,
// so the dot starts the next line instead of dangling at the end of one.
export function Note({ text, className }: { text: string; className?: string }) {
  const parts = text.split(STRINGS.formats.separator);
  const dot = STRINGS.formats.separator.trim();
  return <span className={className}>{parts.map((part, index) => <Fragment key={index}>
    {index > 0 && ' '}<span className="ob-nowrap">{index > 0 && `${dot} `}{part}</span>
  </Fragment>)}</span>;
}
