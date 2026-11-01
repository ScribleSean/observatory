import { Fragment } from 'react';
import { STRINGS } from '../../../lib/strings.generated';

// A note such as "Resets in 4d 21h · runs out in about 4d 5h" wraps only at its separators, never inside a duration.
export function Note({ text, className }: { text: string; className?: string }) {
  const parts = text.split(STRINGS.formats.separator);
  const dot = STRINGS.formats.separator.trim();
  return <span className={className}>{parts.map((part, index) => <Fragment key={index}>
    {index > 0 && ' '}<span className="ob-nowrap">{part}{index < parts.length - 1 && ` ${dot}`}</span>
  </Fragment>)}</span>;
}
