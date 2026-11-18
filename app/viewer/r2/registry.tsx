// Maps each block of the catalog (lib/r2-blocks.mjs) to its React component, and draws a spec with json-render.
import { JSONUIProvider, Renderer, type ComponentRegistry, type Spec } from '@json-render/react';
import { SpecContext } from './data';
import { Section } from './blocks/Section';
import { Headline } from './blocks/Headline';
import { SpendLandedChart } from './blocks/SpendLandedChart';
import { SessionsTable } from './blocks/SessionsTable';
import { Breakdown } from './blocks/Breakdown';
import { Timeline } from './blocks/Timeline';
import { Flags } from './blocks/Flags';
import { GrokRequests, LimitMeter } from './blocks/more';

export const registry: ComponentRegistry = { Section, Headline, SpendLandedChart, SessionsTable, Breakdown, Timeline, Flags, LimitMeter, GrokRequests };
const Skip = () => null;

/** One spec, built in or composed, through the one renderer. */
export function SpecView({ spec }: { spec: Spec }) {
  return (
    <SpecContext value={spec}>
      <JSONUIProvider registry={registry}><Renderer spec={spec} registry={registry} fallback={Skip} /></JSONUIProvider>
    </SpecContext>
  );
}
