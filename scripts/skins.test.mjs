import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {LIMIT_STYLES,contrast,skinContrastProblems,skinCss,validateSkin} from '../lib/skins.mjs';

const folder=new URL('../native/skins/',import.meta.url);
const read=name=>JSON.parse(readFileSync(new URL(name,folder),'utf8'));
const files=readdirSync(folder).filter(name=>name.endsWith('.json')).sort((a,b)=>a.localeCompare(b));

test('the bundled skins are the four agreed ones and each is valid', () => {
  assert.deepEqual(files,['almanac.json','amber-crt.json','instrument.json','sage.json']);
  for(const file of files) assert.equal(validateSkin(read(file)).name.length>0,true,file);
});

test('Sage uses the shared token colours', () => {
  const tokens=JSON.parse(readFileSync(new URL('../native/design-tokens.json',import.meta.url),'utf8')).colors;
  assert.deepEqual(read('sage.json').colors,tokens);
});

test('Sage muted text meets 4.5:1 contrast on filter hover, surface and background in light and dark', () => {
  const {colors}=read('sage.json');
  for(const [index,mode] of ['light','dark'].entries()) {
    for(const background of ['track','surface','background'])
      assert.ok(contrast(colors.muted[index],colors[background][index])>=4.5,`${mode} muted on ${background}`);
  }
});

test('every bundled skin passes the contrast check in light and dark', () => {
  for(const file of files) assert.deepEqual(skinContrastProblems(read(file)),[],file);
  assert.equal(Math.round(contrast('000000','ffffff')),21);
});

test('every limit style is used by a bundled skin or documented as available', () => {
  const used=new Set(files.map(file=>read(file).limitStyle));
  const order=(a,b)=>a.localeCompare(b);
  assert.deepEqual([...used].sort(order),[...LIMIT_STYLES].sort(order));
});

test('a skin cannot carry code, markup, remote files or unknown fields', () => {
  const good=read('sage.json');
  const bad=change=>{const copy=structuredClone(good);change(copy);return copy;};
  for(const skin of [
    bad(s=>{s.css='body{display:none}';}),
    bad(s=>{s.colors.text=['red','blue'];}),
    bad(s=>{s.colors.text=['000000','ffffff;}body{background:url(https://example.invalid/x)'];}),
    bad(s=>{s.colors.extra=['000000','ffffff'];}),
    bad(s=>{delete s.colors.codex;}),
    bad(s=>{s.font='Comic Sans, url(https://example.invalid)';}),
    bad(s=>{s.numeralFont='constructor';}),
    bad(s=>{s.name='<script>';}),
    bad(s=>{s.radius=400;}),
    bad(s=>{s.radius='4px';}),
    bad(s=>{s.rules='yes';}),
    bad(s=>{s.limitStyle='dial';}),
    bad(s=>{delete s.rules;}),
    null,[],'sage'])
    assert.throws(()=>skinCss(skin));
});

test('skin CSS holds only colour variables, a bundled font stack and a radius', () => {
  const css=skinCss(read('almanac.json'));
  assert.match(css,/^:root\{--ob-background:#f5f0e4;/);
  assert.match(css,/--ob-radius:0px;/);
  assert.match(css,/prefers-color-scheme: dark/);
  assert.doesNotMatch(css,/url\(|@import|<|expression|javascript/i);
});

test('a low-contrast skin is reported, not silently accepted', () => {
  const faint=structuredClone(read('sage.json'));faint.colors.muted=['e0ddd8','2c2d2a'];
  assert.equal(skinContrastProblems(faint).length>0,true);
});
