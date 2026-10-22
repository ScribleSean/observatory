import { prices } from './price-table.mjs';

export const rates = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(
  Object.entries(prices.models).map(([model, price]) => [
    model, Object.freeze([price.input, price.cachedInput, price.cacheWrite, price.output]),
  ]),
)));
export function estimate(models) {
  let usd = 0, coveredTokens = 0, excluded = 0;
  const parts = {input:0, cached:0, cacheWrites:0, output:0};
  for (const m of models) {
    const r = Object.hasOwn(rates, m.model) ? rates[m.model] : null;
    const counts = [m.inputTokens, m.cacheReadTokens, m.cacheCreationTokens, m.outputTokens];
    if (!r || m.inferred || typeof m.totalTokens !== 'number' || !Number.isFinite(m.totalTokens) || m.totalTokens < 0 || counts.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0) ||
      Math.abs(counts.reduce((a,b) => a+b,0) - m.totalTokens) > 1) { excluded++; continue; }
    usd += counts.reduce((total,n,i) => total+n*r[i],0) / 1e6;
    Object.keys(parts).forEach((key,i)=>{parts[key]+=counts[i]*r[i]/1e6;});
    coveredTokens += m.totalTokens;
  }
  return { usd: coveredTokens ? usd : null, parts:coveredTokens?parts:null, coveredTokens, excluded, checked: prices.checkedOn };
}
