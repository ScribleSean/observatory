import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
void test('example source configuration does not offer retired readers',async()=>{
  const config=JSON.parse(await readFile(path.join(root,'local.config.example.json'),'utf8'));
  for(const key of ['ubuntuCcusage','ubuntuHost','ubuntuCodexHome','windowsCodexHome','localModelResults'])
    assert.equal(Object.hasOwn(config,key),false,key);
  assert.ok(config.macCodexHome);
  assert.ok(config.windowsHost);
});
test('public documentation links resolve and personal native scope stays explicit',async()=>{
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
  const readme=await readFile(path.join(root,'README.md'),'utf8');
  assert.match(readme,/building in public for his own use/);
  assert.match(readme,/not being developed as a consumer product or hosted service/);
  assert.match(readme,/Automatic app updates are not available/);
  assert.match(readme,/Build from source<\/a>/);
  assert.match(readme,/Public installers and consumer onboarding are not current goals/);
  assert.match(readme,/WSL and Ubuntu tracking are out of scope/);
  assert.match(readme,/iPhone integration and integration with Hermes `\/usage` commands are later work/);
  assert.doesNotMatch(readme,/>Get started<\/a>/);
  assert.match(readme,/\[desktop updates\]\(docs\/UPDATES\.md\)/);
  const guide=await readFile(path.join(root,'docs/GUIDE.md'),'utf8');
  assert.ok(guide.indexOf('## Native app setup') < guide.indexOf('## Legacy developer appendix: SSH hub'));
  assert.match(guide,/Browser \*\*Reload snapshot\*\* only rereads saved data and does not collect/);
  assert.match(guide,/WebKit is an explicit legacy fallback/);
  assert.doesNotMatch(guide,/The current collector runs on macOS/);
  const windows=await readFile(path.join(root,'docs/WINDOWS.md'),'utf8');
  assert.match(windows,/\*\*Refresh sources\*\* to start collection using the saved source choices/);
  assert.match(windows,/browser dashboard and explicit legacy fallback instead offer \*\*Reload snapshot\*\*/);
});
