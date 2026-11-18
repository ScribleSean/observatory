// Maps each block of the catalog (lib/r2-blocks.mjs) to its React component, and draws a spec with json-render.
import { useContext, type ComponentType } from 'react';
import { JSONUIProvider, Renderer, type ComponentRegistry, type ComponentRenderProps, type Spec } from '@json-render/react';
import { SpecContext, StripContext } from './data';
import { Section } from './blocks/Section';
import { Headline } from './blocks/Headline';
import { SpendLandedChart } from './blocks/SpendLandedChart';
import { SessionsTable } from './blocks/SessionsTable';
import { Breakdown } from './blocks/Breakdown';
import { Timeline } from './blocks/Timeline';
import { Flags } from './blocks/Flags';
import { GrokRequests, LimitMeter } from './blocks/more';
import { BlockBoundary } from './Boundary';

type Placed = { span?: number; rows?: number };

/**
 * Each block sits in its own boundary. A block that sets `span` or `rows` also sits in a grid cell that covers
 * that many columns and rows. Headlines in a strip are cells of the strip and get no wrapper.
 */
export function placed<P extends Placed>(type: string, Block: ComponentType<ComponentRenderProps<P>>) {
  const Wrapped = (props: ComponentRenderProps<P>) => {
    const inStrip = useContext(StripContext);
    const drawn = <BlockBoundary name={type}><Block {...props} /></BlockBoundary>;
    const { span, rows } = props.element.props;
    if (inStrip || (span === undefined && rows === undefined)) return drawn;
    return <div className={['cell', span ? `s${span}` : '', rows ? `r${rows}` : ''].filter(Boolean).join(' ')}>{drawn}</div>;
  };
  Wrapped.displayName = `Placed(${type})`;
  return Wrapped;
}

const BLOCKS = { Section, Headline, SpendLandedChart, SessionsTable, Breakdown, Timeline, Flags, LimitMeter, GrokRequests } as unknown as Record<string, ComponentType<ComponentRenderProps<Placed>>>;
export const registry: ComponentRegistry = Object.fromEntries(Object.entries(BLOCKS).map(([type, Block]) => [type, placed(type, Block)])) as ComponentRegistry;
const Skip = () => null;

/** One spec, built in or composed, through the one renderer. */
export function SpecView({ spec }: { spec: Spec }) {
  return (
    <SpecContext value={spec}>
      <JSONUIProvider registry={registry}><Renderer spec={spec} registry={registry} fallback={Skip} /></JSONUIProvider>
    </SpecContext>
  );
}
