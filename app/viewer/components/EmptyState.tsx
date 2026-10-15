import { Card } from './Card';

export function EmptyState({ text }: { text: string }) {
  return <Card as="div"><p>{text}</p></Card>;
}
