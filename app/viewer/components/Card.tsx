import type { ReactNode } from 'react';
import { ProviderDot } from './ProviderDot';

const heading = (title: ReactNode, provider?: string) => <h3 className="ob-card-title">{provider && <ProviderDot provider={provider} />}{title}</h3>;

export function Card({ as: Tag = 'section', label, title, provider, aside, className = '', children }: {
  as?: 'section' | 'div'; label?: string; title?: ReactNode; provider?: string; aside?: ReactNode; className?: string; children?: ReactNode;
}) {
  return <Tag className={`ob-card${className ? ` ${className}` : ''}`} aria-label={label}>
    {title !== undefined && (aside ? <div className="ob-card-head">{heading(title, provider)}{aside}</div> : heading(title, provider))}
    {children}
  </Tag>;
}
