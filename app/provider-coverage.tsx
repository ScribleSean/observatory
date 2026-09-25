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
    <p>Each app has its own usage records. A connected device does not establish coverage of every provider.</p>
    <dl className="model-counts">
      <div><dt>Codex</dt><dd>{codex.length ? `${read}/${codex.length} configured devices read` : 'Unknown'}</dd></div>
    </dl>
    <p>Native Codex logs include HAPI and Happy sessions when they use the same log store. Relay messages are not counted again.</p>
    <dl className="model-counts">
      {claude.length ? claude.map(source => {
        const total = recordedTotal(source);
        return <div key={source.host}><dt>Claude Code · {source.host}</dt>
          <dd>{total === null ? (source.status === 'not-connected' ? 'Collection off' : 'Unknown') : `${total.toLocaleString('en-US')} recorded tokens on ${source.days!.length} dates`}</dd></div>;
      }) : <div><dt>Claude Code</dt><dd>Unknown</dd></div>}
    </dl>
    <p>Enable saved Claude Code usage in native Settings. Records stay on the collecting device. Counts include input, cache reads, cache writes and output, not subscription limits or a bill.</p>
    <dl className="model-counts">
      <div><dt>ChatGPT</dt><dd>Unknown</dd></div>
      <div><dt>Cursor</dt><dd>Unknown</dd></div>
      <div><dt>Antigravity</dt><dd>Unknown</dd></div>
    </dl>
    <p>Token sources for these apps are not connected. ChatGPT app usage is separate from Codex. Selecting a model in Cursor or Antigravity does not create a native Codex or Claude Code record. Saved review receipts do not cover all Antigravity usage.</p>
  </section>;
}
