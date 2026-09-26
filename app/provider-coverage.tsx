export type ProviderTokenSource = {
  provider: string;
  host: string;
  status: string;
  checkedAt?: string;
  days?: { date: string; totalTokens: number; requestCount: number }[];
};

function recordedTotal(source: ProviderTokenSource) {
  if (source.status !== 'ok' || !source.days?.length) return null;
  let total = 0;
  for (const day of source.days) {
    if (!Number.isSafeInteger(day.totalTokens) || day.totalTokens < 0) return null;
    total += day.totalTokens;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export default function ProviderCoverage({ tokens, sources = [] }: {
  tokens: { host: string; status: string }[];
  sources?: ProviderTokenSource[];
}) {
  const codex = tokens.filter(source => source.status !== 'not-connected');
  const read = codex.filter(source => source.status === 'ok').length;
  const claude = sources.filter(source => source.provider === 'claude-code');
  return <section className="receipt-panel" aria-label="Provider coverage">
    <h2>Provider coverage</h2>
    <p>Recorded usage by app. Unknown means no verified token count is available.</p>
    <dl className="model-counts">
      <div><dt>Codex</dt><dd>{codex.length ? `${read}/${codex.length} configured devices read` : 'Unknown'}</dd></div>
      {claude.length ? claude.map(source => {
        const total = recordedTotal(source);
        return <div key={source.host}><dt>Claude Code · {source.host}</dt>
          <dd>{total === null ? (source.status === 'not-connected' ? 'Collection off' : source.status === 'stale' ? 'Unknown · reading is stale' : 'Unknown') : `${total.toLocaleString('en-US')} tokens · ${source.days!.length} recorded ${source.days!.length === 1 ? 'date' : 'dates'}`}</dd></div>;
      }) : <div><dt>Claude Code</dt><dd>Unknown</dd></div>}
      <div><dt>ChatGPT</dt><dd>Unknown</dd></div>
      <div><dt>Cursor</dt><dd>Unknown</dd></div>
      <div><dt>Antigravity</dt><dd>Unknown</dd></div>
    </dl>
    <details className="method-note">
      <summary>What these counts include</summary>
      <p>Codex includes HAPI and Happy sessions when they use the same native log store. Relay messages are not counted again.</p>
      <p>Enable saved Claude Code usage in native Settings. Optional sharing shows each paired device separately when both devices enable it. Device totals are not added together. Counts include input, cache reads, cache writes and output, not subscription limits or a bill.</p>
      <p>ChatGPT, Cursor and Antigravity token sources are not connected. Choosing a model in another app does not create a Codex or Claude Code record. Saved review receipts cover only those reviews.</p>
    </details>
  </section>;
}
