// What test/layout.test.mjs measures in a page of the dashboard, in any engine: the body of an async function that
// waits for the view to draw and returns JSON {problems, counts}. A problem is a sentence about one element that is
// out of line. The checks are about geometry only (getBoundingClientRect), so they hold for any data:
//   page       nothing makes the page scroll sideways
//   card       nothing drawn outside its card, and no text cut off without an ellipsis
//   plot       every bar stands on its plot's baseline; the plots of one chart share their left and right edges
//   scale      each scale value sits beside its rule, right-aligned against the plot, inside the card
//   labels     each label under a plot is centred under its column; no two labels or bar values touch
//   key        captions, keys and the reading line start at the chart's left edge
//   numbers    numbers in a list or table column are right-aligned to one edge
//   empty      an empty state is a short block, never a tall blank one
export const AUDIT = `
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const drawn = () => {
  if (!document.querySelector('main .blk') || document.querySelector('[aria-busy="true"]')) return false;
  return [...document.querySelectorAll('svg.bars')].every(svg => Math.abs(svg.viewBox.baseVal.height - svg.getBoundingClientRect().height) < 0.5);
};
const until = Date.now() + 15000;
while (Date.now() < until && !drawn()) await sleep(50);
if (!drawn()) return JSON.stringify({ error: 'the view did not draw: ' + document.body.innerText.slice(0, 200) });
if (document.fonts && document.fonts.ready) await document.fonts.ready;
// Labels thin themselves after they are measured: wait until the page stops changing size and marks.
let last = '';
for (let calm = 0, tries = 0; calm < 3 && tries < 60; tries++) {
  await sleep(50);
  const now = document.documentElement.scrollHeight + ':' + document.querySelectorAll('.xl .off, .xl.short, .plot em').length;
  calm = now === last ? calm + 1 : 0; last = now;
}

const problems = [], counts = { cards: 0, plots: 0, bars: 0, ticks: 0, labels: 0, values: 0, numbers: 0, empties: 0 };
const say = (kind, text) => { if (problems.length < 40) problems.push(kind + ': ' + text); };
const px = value => Math.round(value * 10) / 10;
const name = el => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
const words = el => (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
const seen = el => { const style = getComputedStyle(el); return style.display !== 'none' && style.visibility !== 'hidden'; };
const box = el => el.getBoundingClientRect();
const cardOf = el => el.closest('.blk');
const title = el => { const card = cardOf(el); const head = card && (card.querySelector('h3') || card.querySelector('.kpi .l')); return head ? '"' + words(head) + '"' : card ? (card.getAttribute('aria-label') || 'a card') : 'the page'; };
// An element inside a box that scrolls or clips sideways is that box's business, not the card's.
const clipped = (el, stop) => { for (let node = el.parentElement; node && node !== stop; node = node.parentElement) if (getComputedStyle(node).overflowX !== 'visible') return true; return false; };

const doc = document.documentElement;
if (doc.scrollWidth > innerWidth + 1) say('page', 'the page is ' + doc.scrollWidth + ' px wide in a ' + innerWidth + ' px window');

for (const card of document.querySelectorAll('main .blk')) {
  if (!seen(card)) continue;
  counts.cards++;
  const edge = box(card);
  if (edge.right > innerWidth + 1 || edge.left < -1) say('page', title(card) + ' reaches ' + px(edge.right) + ' px in a ' + innerWidth + ' px window');
  for (const el of card.querySelectorAll('*')) {
    if (el.closest('svg') && el.tagName !== 'svg') continue;
    if (!seen(el) || el.closest('.off')) continue;
    const rect = box(el);
    if (rect.width < 1 || rect.height < 1) continue;
    if (!clipped(el, card) && (rect.left < edge.left - 1 || rect.right > edge.right + 1))
      say('card', name(el) + ' "' + words(el) + '" is outside ' + title(card) + ' by ' + px(Math.max(edge.left - rect.left, rect.right - edge.right)) + ' px');
    const own = [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim());
    const style = getComputedStyle(el);
    if (own && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && style.overflowX !== 'visible' && style.textOverflow !== 'ellipsis' && style.overflowX !== 'auto' && style.overflowX !== 'scroll')
      say('card', name(el) + ' "' + words(el) + '" is cut off in ' + title(card));
  }
  // A table that is wider than its card scrolls inside it: its last visible column must not be cut mid-word.
  for (const wrap of card.querySelectorAll('.tw')) {
    if (wrap.scrollWidth > wrap.clientWidth + 1) say('card', 'the table in ' + title(card) + ' is ' + wrap.scrollWidth + ' px wide in ' + wrap.clientWidth + ' px');
  }
}

for (const chart of document.querySelectorAll('.chart')) {
  if (!seen(chart)) continue;
  const where = title(chart);
  const style = getComputedStyle(chart), inner = box(chart);
  const left = inner.left + parseFloat(style.paddingLeft), right = inner.right - parseFloat(style.paddingRight);
  const plots = [...chart.querySelectorAll(':scope > .plot')];
  const edges = plots.map(box);
  for (const edge of edges) if (Math.abs(edge.left - edges[0].left) > 0.6 || Math.abs(edge.right - edges[0].right) > 0.6) say('plot', 'the plots of ' + where + ' do not share their edges: ' + px(edge.left) + ' to ' + px(edge.right) + ' against ' + px(edges[0].left) + ' to ' + px(edges[0].right));
  for (const el of chart.querySelectorAll(':scope > .bandh, :scope > .read')) if (Math.abs(box(el).left - left) > 1) say('key', name(el) + ' "' + words(el) + '" of ' + where + ' starts ' + px(box(el).left - left) + ' px off the chart edge');
  for (const el of chart.querySelectorAll('.lg > span')) if (box(el).right > right + 1) say('key', 'the key "' + words(el) + '" of ' + where + ' runs past the chart');
  const strips = [...chart.querySelectorAll(':scope > .ticks')];
  if (strips.length !== plots.length) say('scale', where + ' has ' + plots.length + ' plots and ' + strips.length + ' scales');
  strips.forEach((strip, at) => {
    const plot = edges[at], rules = [...plots[at].querySelectorAll('.rule')].map(rule => box(rule).top);
    const marks = [...strip.querySelectorAll('span')];
    if (!marks.length) say('scale', 'a plot of ' + where + ' has no scale values');
    marks.forEach((mark, index) => {
      counts.ticks++;
      const rect = box(mark), middle = (rect.top + rect.bottom) / 2;
      // The first value is the baseline's, the rest each have a rule.
      const line = index === 0 ? plot.bottom : rules[index - 1];
      if (line === undefined || Math.abs(middle - line) > 1.5) say('scale', 'the value "' + words(mark) + '" of ' + where + ' is ' + px(middle - line) + ' px off its line');
      if (rect.right > plot.left - 2) say('scale', 'the value "' + words(mark) + '" of ' + where + ' touches the plot');
      if (rect.left < left - 1) say('scale', 'the value "' + words(mark) + '" of ' + where + ' starts ' + px(left - rect.left) + ' px outside the chart');
      if (Math.abs(rect.right - box(marks[0]).right) > 0.6) say('scale', 'the values of ' + where + ' are not right-aligned');
    });
  });
  const cells = plots.length ? [...plots[plots.length - 1].querySelectorAll('.hits > .col')].map(box) : [];
  const row = chart.querySelector(':scope > .xl');
  if (row) {
    const spans = [...row.children];
    if (spans.length !== cells.length) say('labels', where + ' has ' + cells.length + ' columns and ' + spans.length + ' labels');
    let before = null, shown = 0;
    spans.forEach((span, index) => {
      const label = [...span.querySelectorAll('b')].find(seen);
      if (!label || !words(label) || !cells[index]) return;
      counts.labels++; shown++;
      const rect = box(label), centre = (cells[index].left + cells[index].right) / 2;
      if (Math.abs((rect.left + rect.right) / 2 - centre) > 1.5) say('labels', 'the label "' + words(label) + '" of ' + where + ' is ' + px((rect.left + rect.right) / 2 - centre) + ' px off its column');
      if (before && rect.left < before.right + 2) say('labels', 'the labels "' + before.text + '" and "' + words(label) + '" of ' + where + ' touch');
      if (rect.top < edges[edges.length - 1].bottom) say('labels', 'the label "' + words(label) + '" of ' + where + ' is above the baseline');
      before = { right: rect.right, text: words(label) };
    });
    if (cells.length && !shown) say('labels', where + ' shows no label under its columns');
  }
}

for (const plot of document.querySelectorAll('.plot')) {
  if (!seen(plot)) continue;
  counts.plots++;
  const where = title(plot), edge = box(plot);
  if (edge.height < 16) say('plot', 'a plot of ' + where + ' is ' + px(edge.height) + ' px tall');
  if (parseFloat(getComputedStyle(plot).borderBottomWidth) < 1) say('plot', 'a plot of ' + where + ' has no baseline');
  const svg = plot.querySelector('svg.bars'), area = box(svg);
  const cells = [...plot.querySelectorAll('.hits > .col')];
  const groups = [...svg.children];
  if (groups.length !== cells.length) say('plot', where + ' has ' + groups.length + ' columns of bars and ' + cells.length + ' columns to point at');
  groups.forEach((group, index) => {
    const cell = cells[index] && box(cells[index]);
    const bars = group.tagName === 'rect' ? [group] : [...group.querySelectorAll('path.bar')];
    if (!bars.length || !cell) return;
    counts.bars++;
    const rects = bars.map(box), bottom = Math.max(...rects.map(rect => rect.bottom)), top = Math.min(...rects.map(rect => rect.top));
    const stroke = group.tagName === 'rect' ? 1 : 0;
    if (Math.abs(bottom - area.bottom) > 1 + stroke) say('plot', 'a bar of ' + where + ' ends ' + px(area.bottom - bottom) + ' px off the baseline');
    if (top < area.top - 1 - stroke) say('plot', 'a bar of ' + where + ' rises ' + px(area.top - top) + ' px over its plot');
    const middle = (Math.min(...rects.map(rect => rect.left)) + Math.max(...rects.map(rect => rect.right))) / 2;
    if (Math.abs(middle - (cell.left + cell.right) / 2) > 1) say('plot', 'a bar of ' + where + ' is ' + px(middle - (cell.left + cell.right) / 2) + ' px off its column');
  });
  const values = [...plot.querySelectorAll('.col > em')].filter(seen).map(el => ({ rect: box(el), text: words(el), cell: box(el.parentElement) }));
  values.forEach((value, index) => {
    counts.values++;
    if (Math.abs((value.rect.left + value.rect.right) / 2 - (value.cell.left + value.cell.right) / 2) > 1.5) say('labels', 'the value "' + value.text + '" of ' + where + ' is off its column');
    const next = values[index + 1];
    if (next && next.rect.left < value.rect.right + 1 && next.rect.top < value.rect.bottom && value.rect.top < next.rect.bottom) say('labels', 'the values "' + value.text + '" and "' + next.text + '" of ' + where + ' touch');
  });
}

// Numbers in a list or a table column end on one edge: the edge of the text, not of its box.
const textRight = el => { const range = document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect().right; };
const ends = (els, what) => {
  const rights = els.filter(el => seen(el) && words(el)).map(textRight);
  counts.numbers += rights.length;
  if (rights.length > 1 && Math.max(...rights) - Math.min(...rights) > 1) say('numbers', what + ' end ' + px(Math.max(...rights) - Math.min(...rights)) + ' px apart');
};
for (const list of document.querySelectorAll('.bl')) { ends([...list.querySelectorAll('.n')], 'the amounts of ' + title(list)); ends([...list.querySelectorAll('.p')], 'the shares of ' + title(list)); }
const numeric = text => /^[<~]?[$]?[\\d][\\d.,]*\\s?(%|[KMB]|[hmd]( \\d+[hm])?|x)?$/.test(text);
for (const table of document.querySelectorAll('main table')) {
  if (!seen(table)) continue;
  const rows = [...table.querySelectorAll('tbody tr')].filter(seen);
  const heads = [...table.querySelectorAll('thead th')];
  const width = Math.max(0, ...rows.map(row => row.children.length));
  for (let column = 1; column < width; column++) {
    const cells = rows.map(row => row.children.length === width ? row.children[column] : null).filter(cell => cell && seen(cell) && words(cell));
    if (cells.length < 2 || !cells.every(cell => numeric(words(cell)))) continue;
    counts.numbers += cells.length;
    const aligns = new Set(cells.map(cell => getComputedStyle(cell).textAlign));
    const head = heads[column] ? words(heads[column]) : 'column ' + (column + 1);
    if (![...aligns].every(align => align === 'right' || align === 'end')) say('numbers', 'the "' + head + '" numbers of ' + title(table) + ' are not right-aligned');
    else if (heads[column] && seen(heads[column]) && !['right', 'end'].includes(getComputedStyle(heads[column]).textAlign)) say('numbers', 'the heading "' + head + '" of ' + title(table) + ' is not over its right-aligned numbers');
  }
}

for (const empty of document.querySelectorAll('main .empty:not(.col)')) {
  if (!seen(empty)) continue;
  counts.empties++;
  const rect = box(empty);
  if (rect.height > 220) say('empty', 'the empty state "' + words(empty) + '" is ' + px(rect.height) + ' px tall');
  if (rect.height < 40) say('empty', 'the empty state "' + words(empty) + '" is ' + px(rect.height) + ' px tall');
}

// The limit line chart: its scale values beside their lines, its day labels and tags inside the card.
for (const burn of document.querySelectorAll('.burn')) {
  if (!seen(burn)) continue;
  const area = box(burn), card = box(cardOf(burn));
  for (const mark of burn.querySelectorAll('.y')) {
    const rect = box(mark), at = area.top + area.height * parseFloat(mark.style.top || '0') / 100;
    if (Math.abs((rect.top + rect.bottom) / 2 - at) > 1.5) say('scale', 'the value "' + words(mark) + '" of ' + title(burn) + ' is off its line');
    if (rect.right > area.left - 2 || rect.left < card.left + 1) say('scale', 'the value "' + words(mark) + '" of ' + title(burn) + ' is not between the card edge and the plot');
  }
  const rights = [...burn.querySelectorAll('.y')].map(textRight);
  if (rights.length > 1 && Math.max(...rights) - Math.min(...rights) > 1) say('scale', 'the values of ' + title(burn) + ' end ' + px(Math.max(...rights) - Math.min(...rights)) + ' px apart');
  let before = null;
  for (const label of [...burn.querySelectorAll('.x')].filter(seen)) {
    const rect = box(label);
    if (before && rect.left < before.right + 2) say('labels', 'the labels "' + before.text + '" and "' + words(label) + '" of ' + title(burn) + ' touch');
    before = { right: rect.right, text: words(label) };
  }
}
return JSON.stringify({ problems, counts });
`;

/** Every view of the dashboard. */
export const VIEWS = ['#overview', '#sessions', '#limits', '#tokens', '#screen-time', '#drift', '#settings'];
/** The charts at each range and with one and two computers. */
export const RANGES = [
  ...['day', 'month', 'year', 'all'].flatMap(unit => [`?unit=${unit}#overview`, `?unit=${unit}#tokens`, `?unit=${unit}#screen-time`]),
  '?devices=mac#overview', '?devices=mac,pc&unit=month#overview', '?devices=ubuntu&unit=all#tokens',
];
export const PAGES = [...VIEWS, ...RANGES];
export const WIDTHS = [375, 390, 430, 1280];
/**
 * What the layout test loads: every view at every width in dark, every view at a phone and a desktop width in light
 * (the themes differ only in colour), and the ranges at the narrowest and the widest width.
 */
export const JOBS = [
  ...WIDTHS.flatMap(width => VIEWS.map(address => ({ address, width, scheme: 'dark' }))),
  ...[390, 1280].flatMap(width => VIEWS.map(address => ({ address, width, scheme: 'light' }))),
  ...[375, 1280].flatMap(width => RANGES.map(address => ({ address, width, scheme: 'dark' }))),
];
