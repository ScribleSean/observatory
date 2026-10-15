import { STRINGS, format } from '../../../lib/strings.generated';
import { sourceGroups, sourceTotals } from '../../../lib/view-sources.mjs';
import { Card, Row } from '../components';
import './sources.css';

export function SourcesView({ snapshot, now }: { snapshot: Record<string, unknown> | null; now: number }) {
  const groups = sourceGroups(snapshot, now);
  const totals = sourceTotals(groups);
  return <div className="ob-sources">
    <p>{totals.total ? format(STRINGS.formats.sourcesRead, { read: totals.read, total: totals.total }) : STRINGS.sources.noConnected}</p>
    <ul className="ob-source-counts">{totals.byStatus.map(item => <li key={item.word}>{format(STRINGS.sources.statusCount, item)}</li>)}</ul>
    {groups.map(group => <Card key={group.id} label={group.label}>
      <h3>{group.label}</h3>
      {group.rows.length === 0 ? <p>{STRINGS.sources.noRecords}</p> : group.rows.map(row => <div className="ob-source-record" key={row.key} data-status={row.status}>
        <Row><span>{row.name}{row.device && <>{STRINGS.formats.separator}{row.device}</>}</span><span>{row.statusWord}</span></Row>
        <time className="ob-meta" dateTime={row.check.iso ?? undefined} title={row.check.exact ?? undefined}>{row.check.label}</time>
        {row.refusal && <p>{row.refusal}</p>}
      </div>)}
    </Card>)}
  </div>;
}
