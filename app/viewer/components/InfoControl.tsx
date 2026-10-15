import { useId, useState } from 'react';

export function InfoControl({ label, detail }: { label: string; detail: string }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <button className="ob-info" type="button" aria-expanded={expanded} aria-controls={id}
        onClick={() => setExpanded(true)} onFocus={() => setExpanded(true)} onBlur={() => setExpanded(false)}>{label}</button>
      <span id={id} hidden={!expanded}>{detail}</span>
    </>
  );
}
