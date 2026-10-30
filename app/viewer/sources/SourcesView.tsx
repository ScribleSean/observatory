import { STRINGS, format } from '../../../lib/strings.generated';
import { sourceGroups, sourceTotals } from '../../../lib/view-sources.mjs';
import { Card } from '../components';
import './sources.css';

export function SourcesView({ snapshot, now }: { snapshot: Record<string, unknown> | null; now: number }) {
  const groups = sourceGroups(snapshot, now);
  const totals = sourceTotals(groups);
  // "Read: N" repeats the sentence above it, so only the other statuses are counted.
  const others = totals.byStatus.filter(item => item.word !== STRINGS.sources.statusOk);
  return <div className="ob-sources">
    <div className="ob-sources-summary">
      <p>{totals.total ? format(STRINGS.formats.sourcesRead, { read: totals.read, total: totals.total }) : STRINGS.sources.noConnected}</p>
      {others.length > 0 && <ul className="ob-source-counts">{others.map(item => <li key={item.word}>{format(STRINGS.sources.statusCount, item)}</li>)}</ul>}
    </div>
    <Card label={STRINGS.sections.sources}>
      <div className="ob-sources-list">
        {groups.map(group => <section key={group.id} className="ob-sources-group" aria-label={group.label}>
          {group.rows.length === 0 ? <div className="ob-source-row">
            <span className="ob-source-name">{group.label}</span>
            <span className="ob-source-device" />
            <span className="ob-meta ob-source-time" />
            <span className="ob-source-status ob-meta">{STRINGS.sources.noRecords}</span>
          </div> : group.rows.map((row, index) => {
            const repeat = index > 0 && group.rows[index - 1].name === row.name;
            return <div className="ob-source-row" key={row.key} data-status={row.status}>
              <span className={repeat ? 'ob-source-name ob-source-repeat' : 'ob-source-name'}>{row.name}</span>
              <span className="ob-source-device">{row.device}</span>
              <time className="ob-meta ob-source-time" dateTime={row.check.iso ?? undefined} title={row.check.exact ?? undefined}>{row.check.label}</time>
              <span className="ob-source-status">{row.statusWord}</span>
              {row.refusal && <p className="ob-meta ob-source-refusal">{row.refusal}</p>}
            </div>;
          })}
        </section>)}
      </div>
    </Card>
  </div>;
}
