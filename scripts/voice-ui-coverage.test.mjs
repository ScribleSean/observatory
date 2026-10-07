import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compileFunction } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = new Map();

// Render trusted repository TSX and shared controls, not snapshot-supplied code.
// This loader uses full Node privileges, not a security sandbox or UI stubs.
// Keep the transpiled code in memory so fixtures do not modify the source tree.
function loadTsx(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const loaded = { exports: {} };
  cache.set(filename, loaded);
  const nativeRequire = createRequire(filename);
  const localRequire = (name) => {
    if (name.startsWith('@/') || name.startsWith('.')) {
      const base = name.startsWith('@/')
        ? path.join(root, name.slice(2))
        : path.resolve(path.dirname(filename), name);
      const source = [base, base + '.tsx', base + '.ts'].find(
        (file) => existsSync(file) && /\.tsx?$/.test(file),
      );
      if (source) return loadTsx(source);
    }
    return nativeRequire(name);
  };
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  compileFunction(outputText, ['require', 'module', 'exports'], { filename })(
    localRequire,
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

const Dictation = loadTsx(path.join(root, 'app/dictation.tsx')).default;
const render = (sources) =>
  renderToStaticMarkup(React.createElement(Dictation, { sources }));
const unimplemented =
  'ChatGPT voice tracking is not implemented. General ChatGPT screen time is not voice usage.';
const day = (date, audioSeconds, audioRecords = 2) => ({
  date,
  transcriptions: 2,
  words: 12,
  wordRecords: 2,
  audioSeconds,
  audioRecords,
  engines: [],
});
const source = (host, days) => ({
  host,
  source: 'Wispr Flow',
  status: 'ok',
  days,
});
const plain = (html) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// This Swift source contract is not a substitute for a Mac compile or UI run.
test('Mac Dictation does not offer unimplemented ChatGPT as an active filter', () => {
  const swift = readFileSync(
    path.join(root, 'native/NativeRecordedUsage.swift'),
    'utf8',
  );
  const selector = swift.match(
    /ObservatorySegments\(title: "Tool",([\s\S]*?)selection: \$provider\)/,
  )?.[1];
  assert.ok(selector, 'Tool selector is present');
  assert.doesNotMatch(
    selector,
    /"ChatGPT"/,
    'Unimplemented ChatGPT is not an active choice',
  );
  assert.ok(swift.includes(unimplemented));
  assert.ok(
    swift.includes(
      'source.tool == "ChatGPT" ? "Not implemented" : dictationStatus(source.status)',
    ),
    'Only the unimplemented tool overrides its displayed status',
  );
  assert.match(
    swift,
    /case "not-supported", "Tracking not yet verified": return "Tracking not yet verified"/,
    'Legacy status projection remains unchanged',
  );
  assert.ok(swift.includes('More local speech detection coming soon.'));
});

// This C# source contract is not a substitute for a Windows compile or UI run.
test('Windows Dictation source excludes unimplemented ChatGPT from active filters', () => {
  const csharp = readFileSync(
    path.join(root, 'native/windows/NativeDictation.cs'),
    'utf8',
  );
  const selector = csharp.match(
    /Choice\("Tool", \[([^\]]*)\], dictationProduct/,
  )?.[1];
  assert.ok(selector, 'Tool selector is present');
  assert.deepEqual(selector.match(/"[^"]+"/g), ['"All tools"', '"Wispr Flow"']);
  assert.ok(csharp.includes(unimplemented));
  assert.ok(
    csharp.includes(
      'row.source.product == "ChatGPT" ? "Not implemented" : DictationStatus(row.source.status)',
    ),
    'Only the unimplemented tool overrides its displayed status',
  );
  assert.ok(
    csharp.includes(
      '"not-supported" or "Tracking not yet verified" => "Tracking not yet verified"',
    ),
    'Legacy status projection remains unchanged',
  );
});

test('web Dictation offers supported choices and labels ChatGPT unimplemented', () => {
  const html = render([]);
  const controls = html.match(
    /<div role="group" aria-label="Voice tool">([\s\S]*?)<\/div>/,
  )?.[1];
  assert.ok(controls, 'Tool selector is rendered');
  assert.match(controls, />All tools<\/button>/);
  assert.match(controls, />Wispr Flow<\/button>/);
  assert.doesNotMatch(
    controls,
    /ChatGPT/,
    'Unimplemented ChatGPT is not an active choice',
  );
  assert.ok(html.includes(unimplemented));
  assert.match(html, />Not implemented<\/td>/);
  assert.ok(html.includes('More local speech detection coming soon.'));
});

test('web combined voice time is not computed instead of obscuring known device readings', () => {
  const html = render([
    source('Mac', [day('2026-09-01', 600), day('2026-09-12', 60)]),
    source('Windows', [day('2026-09-12', 120)]),
    { ...source('Windows', [day('2026-09-12', 600)]), source: 'ChatGPT' },
  ]);
  const metrics = plain(
    html.match(
      /<div class="dictation-metrics">([\s\S]*?)<\/div>\s*<section/,
    )?.[1] ?? '',
  );
  assert.match(
    metrics,
    /Combined voice time Not computed/,
    'There is no supported combined voice total',
  );
  assert.match(
    metrics,
    /Device histories may overlap and are not added together/,
  );
  assert.match(metrics, /Reporting tool\/device sources 2/);
  assert.doesNotMatch(metrics, /All voice time|Unknown|3m|10m|11m/);
  const details = plain(
    html.match(/<h2>By tool and device<\/h2>([\s\S]*?)<\/section>/)?.[1] ?? '',
  );
  assert.match(details, /Wispr Flow Mac 2 12 1m Recorded history/);
  assert.match(details, /Wispr Flow Windows 2 12 2m Recorded history/);
  assert.match(
    details,
    /ChatGPT Windows Unknown Unknown Unknown Not implemented/,
  );
});

test('web voice readings keep missing values, recorded zero and partial coverage distinct', () => {
  const empty = plain(render([]));
  assert.match(empty, /Combined voice time Not computed/);
  assert.match(
    empty,
    /No recorded voice statistics in this scope. Missing data is not zero usage./,
  );
  const html = render([
    source('Mac', [day('2026-09-12', 0)]),
    source('Windows', [day('2026-09-11', 60), day('2026-09-12', 0, 0)]),
  ]);
  const details = plain(
    html.match(/<h2>By tool and device<\/h2>([\s\S]*?)<\/section>/)?.[1] ?? '',
  );
  assert.match(details, /Wispr Flow Mac 2 12 0m Recorded history/);
  assert.match(
    details,
    /Wispr Flow Windows 4 24 1m \(partial\) Recorded history/,
  );
  const daily = plain(
    html.match(/<h2>Voice over time<\/h2>([\s\S]*?)<\/section>/)?.[1] ?? '',
  );
  assert.match(daily, /2026-09-12 Wispr Flow Windows 2 12 Unknown/);
});

test('web voice chart retains the recorded date and duration in its tooltip', () => {
  const html = render([source('Mac', [day('2026-09-12', 60)])]);
  assert.match(html, /<title>2026-09-12: 1m recorded audio<\/title>/);
});
