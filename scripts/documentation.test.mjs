import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
test('public documentation links resolve and release status stays explicit',async()=>{
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
  assert.match(readme,/early preview/);
  assert.match(readme,/Public installers are being prepared, not yet available/);
  assert.match(readme,/Automatic app updates are not available yet/);
  assert.match(readme,/\[desktop updates\]\(docs\/UPDATES\.md\)/);
});
