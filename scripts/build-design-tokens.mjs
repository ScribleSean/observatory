import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const tokens = JSON.parse(readFileSync(new URL('native/design-tokens.json', root), 'utf8'));
const upper = name => name[0].toUpperCase() + name.slice(1);
const rgb = hex => hex.match(/../g).map(value => parseInt(value, 16)).join(', ');
const notice = '// Generated from native/design-tokens.json by scripts/build-design-tokens.mjs.\n';

export function generatedDesignTokens() {
  const swift = [notice + 'import SwiftUI\n\nextension ObservatoryTheme {'];
  const windows = [notice + 'namespace WorkspaceObservatory;\n\ninternal static partial class DashboardPalette\n{'];
  for (const [name, [light, dark]] of Object.entries(tokens.colors)) {
    swift.push(`    static let ${name} = color(0x${light}, 0x${dark})`);
    windows.push(`    internal static Color ${upper(name)}(bool light) => light ? Color.FromArgb(${rgb(light)}) : Color.FromArgb(${rgb(dark)});`);
  }
  for (const [name, value] of Object.entries(tokens.metrics)) {
    swift.push(`    static let ${name}: CGFloat = ${value}`);
    windows.push(`    internal const ${Number.isInteger(value) ? 'int' : 'float'} ${upper(name)} = ${value}${Number.isInteger(value) ? '' : 'f'};`);
  }
  const kebab = name => name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
  const colours = index => Object.entries(tokens.colors).map(([name, values]) => `  --ob-${kebab(name)}: #${values[index].toLowerCase()};`).join('\n');
  const sizes = Object.entries(tokens.metrics).filter(([name]) => !name.startsWith('cardShadow') || name.endsWith('Radius') || name.endsWith('Offset'))
    .map(([name, value]) => `  --ob-${kebab(name)}: ${value}px;`).join('\n');
  const space = tokens.spacing.map((value, index) => `  --ob-space-${index + 1}: ${value}px;`).join('\n');
  const shadow = mode => `  --ob-card-shadow: ${tokens.metrics['cardShadow' + mode]};`;
  const css = `/* Generated from native/design-tokens.json by scripts/build-design-tokens.mjs. */
:root {
${colours(0)}
${shadow('Light')}
${sizes}
${space}
}
@media (prefers-color-scheme: dark) {
:root:not([data-theme="light"]) {
${colours(1)}
${shadow('Dark')}
}
}
:root[data-theme="dark"] {
${colours(1)}
${shadow('Dark')}
}
`;
  swift.push(`    static let spacing: [CGFloat] = [${tokens.spacing.join(', ')}]`, '}', '');
  windows.push(`    internal static readonly int[] Spacing = [${tokens.spacing.join(', ')}];`, '}', '');
  return new Map([
    ['native/DesignTokens.swift', swift.join('\n')],
    ['native/windows/DesignTokens.cs', windows.join('\n')],
    ['app/design-tokens.css', css]
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [path, content] of generatedDesignTokens()) {
    const file = new URL(path, root);
    if (process.argv.includes('--check')) {
      if (readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== content) throw new Error(`${path} needs regeneration`);
    } else writeFileSync(file, content);
  }
}
