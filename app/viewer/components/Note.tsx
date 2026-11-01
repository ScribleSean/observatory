import { Fragment } from 'react';
import { STRINGS } from '../../../lib/strings.generated';

// A note such as "Resets in 4d 21h · runs out in 4d 5h". Where its card is wide it reads on one line with the dot.
// Where the card is narrow each part takes its own line and the dot is dropped, so no line starts with "·".
export function Note({ text, className = '' }: { text: string; className?: string }) {
  const parts = text.split(STRINGS.formats.separator);
  const dot = STRINGS.formats.separator.trim();
  return <span className={`ob-note ${className}`.trim()}>{parts.map((part, index) => <Fragment key={index}>
    {index > 0 && <span className="ob-note-dot" aria-hidden="true">{` ${dot} `}</span>}<span className="ob-nowrap">{part}</span>
  </Fragment>)}</span>;
}
