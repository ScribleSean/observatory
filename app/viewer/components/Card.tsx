import type { ReactNode } from 'react';

export function Card({ as: Tag = 'section', label, children }: { as?: 'section' | 'div'; label?: string; children: ReactNode }) {
  return <Tag className="ob-card" aria-label={label}>{children}</Tag>;
}
