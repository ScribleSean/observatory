import { Fragment } from 'react';
import { STRINGS } from '../../../lib/strings.generated';

export function Note({ text, className = '' }: { text: string; className?: string }) {
  const parts = text.split(STRINGS.formats.separator);
  const dot = STRINGS.formats.separator.trim();
  return <span className={`ob-note ${className}`.trim()}>{parts.map((part, index) => <Fragment key={index}>
    {index > 0 && <span className="ob-note-dot" aria-hidden="true">{` ${dot} `}</span>}<span className="ob-nowrap">{part}</span>
  </Fragment>)}</span>;
}
