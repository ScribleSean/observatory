// The loading state: grey bars in the shape of the Overview, announced once to screen readers.
/** The page while the first snapshot loads, or a view while its code loads. */
export function Loading() {
  const block = (wide: string, lines: number) => (
    <section className={`blk ${wide}`}>
      <div className="bh"><span className="sk" style={{ width: '30%' }} /></div>
      <div className="bb">{Array.from({ length: lines }, (_, index) => <span key={index} className="sk" style={{ width: `${[92, 78, 85, 60, 70][index % 5]}%`, marginBottom: 12 }} />)}</div>
    </section>
  );
  return <output className="grid c12" aria-busy="true" aria-label="Loading">{block('', 2)}<div className="grid c4">{block('wide', 7)}{block('', 7)}{block('wide', 10)}{block('', 4)}</div></output>;
}
