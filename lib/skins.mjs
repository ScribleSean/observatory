// A skin is data. It sets colours, a bundled font choice, corner radius,
// rules and one limit style. It cannot carry CSS, script or remote files.
export const SKIN_COLORS = ['background', 'surface', 'text', 'muted', 'strong', 'accent', 'track', 'claude', 'codex', 'warning', 'error'];
export const SKIN_FONTS = {
  sans: "'Inter Tight', system-ui, sans-serif",
  serif: "'Fraunces', 'New York', 'Iowan Old Style', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};
export const LIMIT_STYLES = ['bar', 'numeral', 'text'];
const FIELDS = ['name', 'colors', 'font', 'numeralFont', 'radius', 'rules', 'limitStyle'];
const hex = /^[0-9A-Fa-f]{6}$/;

// Returns a clean copy, or throws. Unknown fields are refused so a skin
// cannot smuggle a value the viewer would later start to trust.
export function validateSkin(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('A skin must be an object');
  const keys = Object.keys(raw);
  if (keys.length !== FIELDS.length || keys.some(key => !FIELDS.includes(key))) throw Error('A skin has exactly these fields: ' + FIELDS.join(', '));
  if (typeof raw.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 -]{0,31}$/.test(raw.name)) throw Error('Invalid skin name');
  if (!raw.colors || typeof raw.colors !== 'object' || Array.isArray(raw.colors)) throw Error('Invalid skin colours');
  const names = Object.keys(raw.colors);
  if (names.length !== SKIN_COLORS.length || names.some(name => !SKIN_COLORS.includes(name))) throw Error('A skin sets exactly these colours: ' + SKIN_COLORS.join(', '));
  const colors = {};
  for (const name of SKIN_COLORS) {
    const pair = raw.colors[name];
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some(value => typeof value !== 'string' || !hex.test(value))) throw Error(`Colour ${name} needs a light and a dark six-digit hex value`);
    colors[name] = pair.map(value => value.toLowerCase());
  }
  if (!Object.hasOwn(SKIN_FONTS, raw.font) || !Object.hasOwn(SKIN_FONTS, raw.numeralFont)) throw Error('A skin font must be sans, serif or mono');
  if (!Number.isInteger(raw.radius) || raw.radius < 0 || raw.radius > 16) throw Error('Radius must be a whole number from 0 to 16');
  if (typeof raw.rules !== 'boolean') throw Error('Rules must be true or false');
  if (!LIMIT_STYLES.includes(raw.limitStyle)) throw Error('Limit style must be one of: ' + LIMIT_STYLES.join(', '));
  return { name: raw.name, colors, font: raw.font, numeralFont: raw.numeralFont, radius: raw.radius, rules: raw.rules, limitStyle: raw.limitStyle };
}

// Built from validated values only, so the result is safe to place in a style element.
export function skinCss(input) {
  const skin = validateSkin(input);
  const block = index => SKIN_COLORS.map(name => `--ob-${name}:#${skin.colors[name][index]};`).join('') ;
  const shape = `--ob-font:${SKIN_FONTS[skin.font]};--ob-numeral-font:${SKIN_FONTS[skin.numeralFont]};--ob-radius:${skin.radius}px;`;
  return `:root{${block(0)}${shape}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${block(1)}}}:root[data-theme="dark"]{${block(1)}}`;
}

const channel = value => { const part = value / 255; return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4; };
const luminance = color => [0, 2, 4].map(start => channel(parseInt(color.slice(start, start + 2), 16)))
  .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
export function contrast(first, second) {
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

// Text needs 4.5 to 1. Meters, dots and large numerals need 3 to 1.
export function skinContrastProblems(input) {
  const skin = validateSkin(input), problems = [];
  for (const [index, mode] of [[0, 'light'], [1, 'dark']]) {
    const at = name => skin.colors[name][index];
    for (const ground of ['background', 'surface']) {
      for (const [name, minimum] of [['text', 4.5], ['muted', 4.5], ['warning', 3], ['error', 3], ['claude', 3], ['codex', 3], ['accent', 3]])
        if (contrast(at(name), at(ground)) < minimum) problems.push(`${mode}: ${name} on ${ground} is ${contrast(at(name), at(ground)).toFixed(2)}, needs ${minimum}`);
    }
    if (contrast(at('background'), at('accent')) < 4.5) problems.push(`${mode}: background on accent is ${contrast(at('background'), at('accent')).toFixed(2)}, needs 4.5`);
  }
  return problems;
}
