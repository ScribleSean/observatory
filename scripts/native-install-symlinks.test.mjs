import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';

const options={recursive:true,errorOnExist:true,force:false,verbatimSymlinks:true};
test('bundle copy preserves symlink text in the installer source',()=>{
  const source=fs.readFileSync(new URL('../native/install.mjs',import.meta.url),'utf8');
  const call=source.match(/^cpSync\(source,app,\{([^}]+)\}\)/m);
  assert.ok(call,'Expected the bundle copy call');
  const expected=Object.entries(options).map(([key,value])=>`${key}:${value}`).join(',');
  assert.equal(call[1].replace(/\s/g,''),expected);
});

test('copied framework links survive removal of the source',t=>{
  const root=fs.mkdtempSync(path.join(tmpdir(),'native-install-symlinks-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'source.app'),app=path.join(root,'copy.app');
  const framework='Contents/Frameworks/Synthetic.framework';
  const from=path.join(source,framework),to=path.join(app,framework);
  fs.mkdirSync(path.join(from,'Versions/A/Resources'),{recursive:true});
  fs.writeFileSync(path.join(from,'Versions/A/Resources/fixture.txt'),'synthetic resource');
  const links={'Versions/Current':'A',Resources:'Versions/Current/Resources'};
  for(const [name,target] of Object.entries(links))fs.symlinkSync(target,path.join(from,name),'dir');
  fs.cpSync(source,app,options);
  for(const name of Object.keys(links)) {
    const target=fs.readlinkSync(path.join(to,name));
    assert.equal(path.isAbsolute(target),false);
    assert.equal(target,fs.readlinkSync(path.join(from,name)));
  }
  fs.rmSync(source,{recursive:true,force:true});
  for(const [name,target] of Object.entries(links)) {
    assert.equal(fs.readlinkSync(path.join(to,name)),target);
    assert.equal(fs.statSync(path.join(to,name)).isDirectory(),true);
  }
  for(const name of ['Resources','Versions/Current/Resources'])
    assert.equal(fs.readFileSync(path.join(to,name,'fixture.txt'),'utf8'),'synthetic resource');
});
