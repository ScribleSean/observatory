export function FilterGroup({ label, options, value, onChange }: { label: string; options: [string, string][]; value: string; onChange: (next: string) => void }) {
  return (
    <fieldset className="ob-segments" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" aria-pressed={id === value} className={id === value ? 'on' : ''} onClick={() => onChange(id)}>{text}</button>
      ))}
    </fieldset>
  );
}

