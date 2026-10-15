import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
void test('example source configuration does not offer retired readers',async()=>{
  const config=JSON.parse(await readFile(path.join(root,'local.config.example.json'),'utf8'));
  for(const key of ['ubuntuCcusage','ubuntuHost','ubuntuCodexHome','windowsCodexHome'])
    assert.equal(Object.hasOwn(config,key),false,key);
  assert.ok(config.macCodexHome);
  assert.ok(config.windowsHost);
});
test('public documentation links resolve',async()=>{
  const files=['README.md',...(await readdir(path.join(root,'docs')))
    .filter(name=>name.endsWith('.md')).map(name=>'docs/'+name)];
  for(const name of files) {
    const contents=await readFile(path.join(root,name),'utf8');
    const links=[...contents.matchAll(/\]\(([^\s)]+)\)/g),
      ...contents.matchAll(/(?:src|href)="([^"\s]+)"/g)];
    for(const [,link] of links) {
      if(/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('#'))continue;
      const target=path.resolve(root,path.dirname(name),decodeURIComponent(link.split('#')[0]));
      assert.ok(target.startsWith(root),`${name}: link escapes project`);
      assert.ok((await stat(target)).isFile(),`${name}: missing ${link}`);
    }
  }
});
test('README states the native app scope and release limits',async()=>{
  const readme=await readFile(path.join(root,'README.md'),'utf8');
  assert.match(readme,/A Mac menu-bar and Windows tray app that shows your Claude Code and Codex limits/);
  assert.match(readme,/It has no account and no hosted service/);
  assert.match(readme,/Unknown means a value was not read\. It never means zero/);
  assert.match(readme,/^## What it shows$/m);
  assert.doesNotMatch(readme,/^## Status$/m);
  assert.doesNotMatch(readme,/In progress/i);
  assert.match(readme,/there are no automatic updates/i);
  assert.match(readme,/Build from source<\/a>/);
  assert.match(readme,/Builds are unsigned/);
  assert.match(readme,/copy an invitation in Settings on the first device, paste it in Settings on the second/);
  assert.match(readme,/Tailscale/);
  assert.match(readme,/WSL and Ubuntu tracking are out of scope/);
  assert.match(readme,/iPhone integration is later work/);
  assert.match(readme,/href="docs\/MAC\.md"/);
  assert.match(readme,/href="docs\/WINDOWS\.md"/);
  assert.match(readme,/<!-- F1: replace the next sentence with the demo link/);
  assert.doesNotMatch(readme,/There is no installer download yet/);
  assert.doesNotMatch(readme,/Workspace Observatory/);
  assert.doesNotMatch(readme,/The copy published today still shows the earlier web interface/);
  assert.doesNotMatch(readme,/>Get started<\/a>/);
});
test('guide leads with native setup and invitation pairing',async()=>{
  const guide=await readFile(path.join(root,'docs/GUIDE.md'),'utf8');
  assert.ok(guide.indexOf('## Native app setup') !== -1 && guide.indexOf('## Native app setup') < guide.indexOf('## Try the demo'));
  assert.match(guide,/^## Pair two devices$/m);
  assert.doesNotMatch(guide,/Reload snapshot/);
  assert.doesNotMatch(guide,/legacy fallback/i);
  assert.doesNotMatch(guide,/## Legacy developer appendix: SSH hub/);
  assert.doesNotMatch(guide,/The current collector runs on macOS/);
  assert.doesNotMatch(guide,/\bAgents\b/);
  assert.doesNotMatch(guide,/Source health/);
});
test('platform guides lead with release installation and retain build instructions',async()=>{
  for(const name of ['docs/MAC.md','docs/WINDOWS.md']) {
    const contents=await readFile(path.join(root,name),'utf8');
    assert.equal(contents.split(/\r?\n/).find(line=>line.startsWith('## ')),'## Install a release',`${name}: first section`);
    const install=contents.indexOf('## Install a release'),build=contents.indexOf('## Build from source');
    assert.ok(install !== -1 && build !== -1 && install < build,`${name}: install before build`);
    for(const text of ['SHA256SUMS.txt','Observatory-<version>-macos-arm64.zip','Observatory-<version>-windows-x64-setup.exe'])
      assert.ok(contents.includes(text),`${name}: missing ${text}`);
    assert.doesNotMatch(contents,/Reload snapshot/,`${name}: retired reload wording`);
    assert.doesNotMatch(contents,/--legacy-dashboard/,`${name}: retired dashboard flag`);
    const required=name==='docs/MAC.md'
      ? ['shasum -a 256','~/Library/Application Support/Observatory','Open Anyway','MacOSX26.5.sdk','env -i HOME=']
      : ['Get-FileHash','%LOCALAPPDATA%\\Observatory','Run anyway','Win32_Process'];
    for(const text of required)assert.ok(contents.includes(text),`${name}: missing ${text}`);
    if(name==='docs/WINDOWS.md')assert.match(contents,/packaged app such as Claude desktop/,`${name}: independent launch guidance`);
  }
});
test('public guides follow the writing rules',async()=>{
  for(const name of ['README.md','SECURITY.md','docs/GUIDE.md','docs/MAC.md','docs/WINDOWS.md']) {
    const contents=await readFile(path.join(root,name),'utf8');
    const lines=contents.split(/\r?\n/),dash=lines.findIndex(line=>/\u2014/.test(line));
    assert.equal(dash,-1,`${name}:${dash+1}: em dash in ${lines[dash]}`);
    let fenced=false;
    const prose=lines.map(line=>{
      if(/^\s*```/.test(line)) { fenced=!fenced; return ''; }
      return fenced ? '' : line;
    }).join('\n').replace(/(`+)[\s\S]*?\1/g,span=>span.replace(/[^\n]/g,''))
      .replace(/&(?:[a-z][a-z0-9]*|#\d+|#x[\da-f]+);/gi,'');
    const semicolon=prose.split('\n').findIndex(line=>/\u003b/.test(line));
    assert.equal(semicolon,-1,`${name}:${semicolon+1}: semicolon in prose in ${lines[semicolon]}`);
  }
});
