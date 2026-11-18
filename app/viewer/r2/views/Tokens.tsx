// Tokens: follows the device chips and the range. A sum across computers is labeled "not deduplicated" and
// shown next to its per-device parts. Unknown is never drawn as 0.
import type { Frame, TokensVM } from '../../../../lib/view-r2.mjs';
import type { Scope } from '../../../../lib/scope.mjs';
import { buildTokens } from '../../../../lib/view-r2.mjs';
import { Block, BarList, Columns, Empty, StateView, Strip, UNKNOWN, bucketWord, dateIn, dayColumns, money, names, partBars, share, tokens, type Cell } from './parts';
import './more.css';

export type TokenKinds = { cacheRead: number | null; cacheWrite: number | null; output: number | null; input: number | null };
export type TokensData = { vm: TokensVM; kinds: TokenKinds; now: number };

const KINDS: [keyof TokenKinds, string][] = [['cacheRead', 'Cache read'], ['cacheWrite', 'Cache write'], ['output', 'Output'], ['input', 'Input']];

export function TokensBody({ vm, kinds, now }: TokensData) {
  const frame = vm.frame as Frame, { period } = frame;
  const timeZone = frame.timeZone, today = dateIn(now, timeZone);
  const selected = frame.devices.filter(device => device.selected);
  const staleToday = period.unit === 'day' && period.current && selected.length === 1 && selected[0].state === 'stale';
  if (staleToday || (vm.total.value === null && selected.length === 1))
    return <StateView title={UNKNOWN} line={`${selected[0]?.name ?? 'This computer'} has not been read since ${selected[0]?.since ? new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(Date.parse(selected[0].since)) : 'it was set up'}.`} />;
  if (vm.total.value === 0) return <StateView title="No tokens" line={`Nothing ran in ${period.label}.`} />;
  const total = vm.total.value;
  const cells: Cell[] = [
    { label: 'All tokens', value: tokens(total), context: `in ${period.label}${vm.total.sumLabel ? `, ${vm.total.sumLabel}` : ''}` },
    ...KINDS.map(([key, label]) => ({ label, value: tokens(kinds[key]), context: kinds[key] === null ? 'a day was not read' : `${share(kinds[key], total)} of tokens` })),
    { label: 'Spend per million tokens', mark: true, value: vm.spend.value === null || !total ? UNKNOWN : money(vm.spend.value / (total / 1e6)), context: 'API equivalent' },
  ];
  const devices = vm.total.breakdowns.device ?? [];
  const unknownDevices = devices.filter(part => part.value === null).map(part => part.label);
  const foot = vm.total.sumLabel && devices.length > 1
    ? <>{devices.map(part => `${part.label} ${part.text}`).join(', ')}. Summed across computers, {vm.total.sumLabel}.</>
    : unknownDevices.length ? <><span className="dot stale" />{names(unknownDevices)} could not be read for a day in this range.</> : undefined;
  const columns = dayColumns(period, new Map(vm.days.map(day => [day.date, day.tokens.value])), today);
  return (
    <div className="grid more">
      <Strip cells={cells} foot={foot} />
      <Block span={8} title="Tokens over time" sub={`per ${bucketWord(period.unit)}, all token kinds`}>
        {period.unit === 'day'
          ? <Empty title="Kept per day" line="Tokens are recorded per day, so one day has no hourly chart. Pick Week or Month to see the days." />
          : <Columns columns={columns} format={tokens} hint="Hover a bar for its numbers" />}
      </Block>
      <Block title="Spend by model" sub="API equivalent">
        <div className="bb"><BarList items={partBars(vm.spend.breakdowns.model)} format={money} accent limit={6} /></div>
      </Block>
      <Block title="Tokens by kind">
        <div className="bb"><BarList items={KINDS.map(([key, label]) => ({ key, label, value: kinds[key] }))} format={tokens} /></div>
      </Block>
      <Block title="Spend by repo">
        <div className="bb">{(vm.spend.breakdowns.repo ?? []).length ? <BarList items={partBars(vm.spend.breakdowns.repo)} format={money} accent limit={8} /> : <Empty title="No repositories" line="No session in this range ran in a repository." />}</div>
      </Block>
      <Block title="Spend by kind of work" foot={<>Is the top model doing small jobs? See Drift.</>}>
        <div className="bb"><BarList items={partBars(vm.spend.breakdowns.kind)} format={money} accent limit={8} /></div>
      </Block>
    </div>
  );
}

type History = { host: string; days: { date: string; tool: string; status: string; tokens: Record<string, number | null> }[] }[];

/** Token kinds over the scope from the ledger history: selected computers, shown sources, the period's dates. */
export function tokenKinds(view: { ledgerHistory?: History }, scope: Scope, dates: string[]): TokenKinds {
  const inPeriod = new Set(dates), sums: TokenKinds = { cacheRead: 0, cacheWrite: 0, output: 0, input: 0 };
  for (const row of view.ledgerHistory ?? []) {
    if (!scope.devices.includes(row.host as never)) continue;
    for (const day of row.days) {
      if (!inPeriod.has(day.date) || !scope.sources.includes(day.tool as never)) continue;
      for (const [key] of KINDS) {
        const value = day.status === 'ok' ? day.tokens[key] : null;
        sums[key] = sums[key] === null || value === null || value === undefined ? null : sums[key]! + value;
      }
    }
  }
  return sums;
}

export function Tokens({ snapshot, scope, now }: { snapshot: { view: { ledgerHistory?: History } }; scope: Scope; now: number }) {
  const vm = buildTokens(snapshot, scope, { now });
  return <TokensBody vm={vm} kinds={tokenKinds(snapshot.view, scope, (vm.frame as Frame).period.dates)} now={now} />;
}
