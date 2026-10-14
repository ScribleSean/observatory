import type { ReactNode } from 'react';

export function Row({ as: Tag = 'div', className = '', children }: { as?: 'div' | 'header' | 'footer'; className?: string; children: ReactNode }) {
  return <Tag className={`ob-row${className ? ` ${className}` : ''}`}>{children}</Tag>;
}
