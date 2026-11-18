// Round 2 colour contrast, read from the tokens in app/viewer/r2/r2.css in both themes: the faint text that
// carries Unknown reaches 4.5:1 and the keyboard focus ring reaches 3:1 on the page and on a panel (WCAG 2.2,
// 1.4.3 and 1.4.11). The ratio formula is WCAG's own relative luminance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../app/viewer/r2/r2.css',import.meta.url),'utf8');

/** The custom properties in the first rule whose selector is exactly `selector`. */
function tokens(selector){
  const at=css.indexOf(`${selector}{`);
  assert.ok(at>=0,`${selector} is in r2.css`);
  const body=css.slice(at+selector.length+1,css.indexOf('}',at));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map(match=>[match[1],match[2].trim()]));
}

const channel=value=>{const c=value/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;};
const luminance=hex=>{
  assert.match(hex,/^#[0-9a-f]{6}$/i,`${hex} is a six digit colour`);
  const [r,g,b]=[1,3,5].map(i=>channel(parseInt(hex.slice(i,i+2),16)));
  return 0.2126*r+0.7152*g+0.0722*b;
};
const ratio=(a,b)=>{const [hi,lo]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (hi+0.05)/(lo+0.05);};

const dark=tokens(':root');
const light=tokens(':root[data-theme="light"]');
const lightAuto=tokens(':root:not([data-theme="dark"])');

test('the formula matches known WCAG ratios',()=>{
  assert.equal(ratio('#000000','#ffffff').toFixed(2),'21.00');
  assert.equal(ratio('#777777','#ffffff').toFixed(2),'4.48');
  assert.equal(ratio('#767676','#ffffff').toFixed(2),'4.54');
});

test('the light theme from the system setting and the one chosen by hand use the same tokens',()=>{
  for(const name of ['bg','panel','faint','muted','focus'])assert.equal(lightAuto[name],light[name],name);
});

test('faint text, which carries Unknown, reaches 4.5:1 on every surface it sits on (page, panel, raised and hover) in both themes',()=>{
  for(const [theme,t] of Object.entries({dark,light}))
    for(const surface of ['bg','panel','raised','hover'])assert.ok(ratio(t.faint,t[surface])>=4.5,`${theme} --faint on --${surface}: ${ratio(t.faint,t[surface]).toFixed(2)}`);
  assert.match(css,/\.unk\{color:var\(--faint\)/,'Unknown is drawn in the faint colour this test checks');
});

test('the focus ring reaches 3:1 on the page and on a panel in both themes, and the Ask field shows it',()=>{
  for(const [theme,t] of Object.entries({dark,light}))
    for(const surface of ['bg','panel'])assert.ok(ratio(t.focus,t[surface])>=3,`${theme} --focus on --${surface}: ${ratio(t.focus,t[surface]).toFixed(2)}`);
  assert.match(css,/:focus-visible\{outline:2px solid var\(--focus\)/);
  // The input itself draws no outline, so the box around it carries the ring while it has focus.
  assert.match(css,/\.askbox input\{[^}]*outline:0/);
  assert.match(css,/\.askbox:focus-within\{[^}]*outline:2px solid var\(--focus\)/);
});

test('muted text reaches 4.5:1 on every surface token in both themes',()=>{
  for(const [theme,t] of Object.entries({dark,light}))
    for(const surface of ['bg','panel','raised','hover'])assert.ok(ratio(t.muted,t[surface])>=4.5,`${theme} --muted on --${surface}: ${ratio(t.muted,t[surface]).toFixed(2)}`);
});
