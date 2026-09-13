import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createLocalServer} from '../serve-local.mjs';

async function fixture(t) {
  const root=await mkdtemp(path.join(tmpdir(),'observatory-server-boundary-'));
  const files={
    'dist/client/index.html':'<html>synthetic-public</html>',
    'dist/client/assets/test.js':'// public asset',
    'dist/client/_next/static/chunks/test.js':'// public chunk',
    'dist/client/observatory/_next/static/chunks/test.js':'// prefixed public chunk',
    'dist/client/brand/telescope.svg':'<svg/>',
    'dist/client/favicon.svg':'<svg/>',
    'dist/client/vinext-client-entry-manifest.json':'{}',
    'public/local/usage.json':'{"schema":2,"demo":true}',
    'public/local/collector.json':'{"state":"ok"}',
  };
  for(const base of ['private-sync','dist/client/private-sync','dist/client/assets/private-sync','public/local'])
    for(const name of ['pairing.json','setup.pending.json'])files[`${base}/${name}`]='{"privateCanary":true}';
  for(const base of ['private-quota','dist/client/private-quota','dist/client/assets/private-quota','public/local'])
    for(const name of ['state.sqlite','state.sqlite-journal','state.sqlite-wal','state.sqlite-shm','account.json'])
      files[`${base}/${name}`]='{"privateCanary":true}';
  for(const [relative,contents] of Object.entries(files)) {
    const file=path.join(root,relative);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,contents);
  }
  const server=createLocalServer(root);
  t.after(async()=>{if(server.listening)await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const request=(url,headers={})=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:url,headers:{Host:'127.0.0.1:5601',...headers}},res=>{
      let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));
    });req.setTimeout(5000,()=>req.destroy(Error('Fixture request timeout')));req.on('error',reject);req.end();
  });
  return {root,request};
}

test('private pairing files are unavailable even if accidentally copied into static output',async t=>{
  const {request}=await fixture(t);
  for(const route of ['/private-sync/pairing.json','/private-sync/setup.pending.json',
    '/assets/private-sync/pairing.json','/assets/private-sync/setup.pending.json','/local/setup.pending.json',
    '/assets/%2e%2e/private-sync/pairing.json','/%2e%2e%2fprivate-sync/setup.pending.json']) {
    const response=await request(route);
    assert.equal(response.status,404,route);assert.equal(response.body.includes('privateCanary'),false);
  }
  for(const route of ['/','/assets/test.js','/_next/static/chunks/test.js',
    '/observatory/_next/static/chunks/test.js','/brand/telescope.svg','/favicon.svg',
    '/vinext-client-entry-manifest.json','/local/usage.json','/local/collector.json'])
    assert.equal((await request(route)).status,200,route);
  assert.equal((await request('/local/usage.json',{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await request('/',{Host:'foreign.example'})).status,403);
});

test('public snapshot routes reject a linked file and a linked parent directory',{skip:process.platform==='win32'},async t=>{
  const {root,request}=await fixture(t);
  const local=path.join(root,'public/local');
  await rm(path.join(local,'usage.json'));
  await symlink(path.join(root,'private-sync/pairing.json'),path.join(local,'usage.json'));
  assert.equal((await request('/local/usage.json')).status,404);
  await rm(local,{recursive:true});
  const privateDirectory=path.join(root,'private-sync');
  await writeFile(path.join(privateDirectory,'secret.js'),'// synthetic private canary');
  await symlink(privateDirectory,path.join(root,'dist/client/assets/private-linked'));
  assert.equal((await request('/assets/private-linked/secret.js')).status,404);
  await writeFile(path.join(privateDirectory,'usage.json'),'{"privateCanary":true}');
  await symlink(privateDirectory,local);
  const result=await request('/local/usage.json');
  assert.equal(result.status,404);assert.equal(result.body.includes('privateCanary'),false);
});

test('private quota databases and journals are not static routes even when copied into public assets',async t=>{
  const {request}=await fixture(t);
  for(const base of ['/private-quota','/assets/private-quota','/local'])
    for(const name of ['state.sqlite','state.sqlite-journal','state.sqlite-wal','state.sqlite-shm','account.json']) {
      const route=base+'/'+name,response=await request(route);
      assert.equal(response.status,404,route);assert.equal(response.body.includes('privateCanary'),false,route);
    }
});
