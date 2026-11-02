export type Share = { host: string; label: string; value: number | null; text: string };

// One quiet row per computer under a combined figure, each with its share of the sum as a bar.
export function DeviceShares({ rows, color }: { rows: Share[]; color: string }) {
  const sum = rows.reduce((total, row) => total + (row.value ?? 0), 0);
  return <ul className="ob-shares">{rows.map(row => <li key={row.host}>
    <span>{row.label}</span>
    <span className={row.value === null ? 'ob-meta' : 'ob-num'}>{row.text}</span>
    <span className="ob-bar" aria-hidden="true">{row.value !== null && sum > 0 && <i className={color} style={{ width: `${row.value / sum * 100}%` }} />}</span>
  </li>)}</ul>;
}
