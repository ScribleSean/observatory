import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {contrast,skinContrastProblems,skinCss,validateSkin} from '../lib/skins.mjs';

const folder=new URL('../app/viewer/',import.meta.url);
const read=name=>JSON.parse(readFileSync(new URL(name,folder),'utf8'));
const files=readdirSync(folder).filter(name=>name.endsWith('.json')).sort((a,b)=>a.localeCompare(b));

test('the bundled skin is Sage and it is valid', () => {
  assert.deepEqual(files,['sage.json']);
  for(const file of files) assert.equal(validateSkin(read(file)).name.length>0,true,file);
});

test('every bundled skin muted text meets 4.5:1 contrast on filter hover, surface and background in light and dark', () => {
  for(const file of files) {
    const {colors}=read(file);
    for(const [index,mode] of ['light','dark'].entries()) {
      for(const background of ['track','surface','background'])
        assert.ok(contrast(colors.muted[index],colors[background][index])>=4.5,`${file} ${mode} muted on ${background}`);
    }
  }
});

test('the contrast check reports muted text on a low-contrast light track', () => {
  const sage=read('sage.json');
  const faint=structuredClone(sage);
  faint.colors.track[0]=faint.colors.muted[0];
  assert.deepEqual(skinContrastProblems(faint),['light: muted on track is 1.00, needs 4.5']);
  assert.deepEqual(skinContrastProblems(sage),[]);
});

test('every bundled skin passes the contrast check in light and dark', () => {
  for(const file of files) assert.deepEqual(skinContrastProblems(read(file)),[],file);
  assert.equal(Math.round(contrast('000000','ffffff')),21);
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
  const css=skinCss(read('sage.json'));
  assert.match(css,/^:root\{--ob-background:#edeae5;/);
  assert.match(css,/--ob-radius:12px;/);
  assert.match(css,/prefers-color-scheme: dark/);
  assert.doesNotMatch(css,/url\(|@import|<|expression|javascript/i);
});
