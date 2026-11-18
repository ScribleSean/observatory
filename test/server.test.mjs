import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,writeFile,symlink} from 'node:fs/promises';
import path from 'node:path';
import {createLocalServer} from '../serve-local.mjs';
import {allowedLocalRequest} from '../scripts/request-policy.mjs';
import {withFolder} from './helpers.mjs';

async function serve(folder,action) {
  const files={
    'dist/index.html':'<html>dashboard</html>',
    'dist/assets/app.js':'// app',
    'dist/assets/data.json':'{"no":true}',
    'data/public/local/combined.json':'{"schema":"observatory-combined/1"}',
    'data/public/local/usage.json':'{"private":true}',
    'data/private-quota/state.sqlite':'private',
  };
  for(const [name,text] of Object.entries(files)) {
    const file=path.join(folder,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);
  }
  await symlink(path.join(folder,'data/public/local/usage.json'),path.join(folder,'dist/assets/linked.js')).catch(()=>{});
  const server=createLocalServer({assets:path.join(folder,'dist'),dataFolder:path.join(folder,'data')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const request=(url,{method='GET',headers={}}={})=>new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:url,method,headers:{host:`127.0.0.1:${port}`,...headers}},res=>{
      let body='';res.on('data',chunk=>{body+=chunk;});res.on('end',()=>resolve({status:res.statusCode,body,headers:res.headers}));
    });
    req.on('error',reject);req.end();
  });
  try {return await action(request,port);}
  finally {await new Promise(resolve=>server.close(resolve));}
}

test('the dashboard page, its assets and combined.json are served',()=>withFolder(folder=>serve(folder,async request=>{
  assert.equal((await request('/')).body,'<html>dashboard</html>');
  assert.equal((await request('/assets/app.js')).status,200);
  const combined=await request('/local/combined.json');
  assert.equal(combined.status,200);
  assert.equal(JSON.parse(combined.body).schema,'observatory-combined/1');
  assert.equal(combined.headers['cache-control'],'no-store');
})));

test('nothing else in the data folder or build folder is reachable',()=>withFolder(folder=>serve(folder,async request=>{
  for(const url of ['/local/usage.json','/private-quota/state.sqlite','/assets/data.json','/assets/../../data/public/local/usage.json',
    '/assets/%2e%2e/%2e%2e/data/public/local/usage.json','/assets/linked.js','/assets/..%5cindex.html','/settings'])
    assert.equal((await request(url)).status,404,url);
})));

test('only GET and HEAD from this computer, and no cross-site reads',()=>withFolder(folder=>serve(folder,async(request,port)=>{
  assert.equal((await request('/',{method:'POST'})).status,405);
  assert.equal((await request('/',{headers:{host:'evil.example'}})).status,403);
  assert.equal((await request('/local/combined.json',{headers:{'sec-fetch-site':'cross-site','sec-fetch-mode':'cors','sec-fetch-dest':'empty'}})).status,403);
  assert.equal((await request('/',{headers:{'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'}})).status,200);
  assert.equal((await request('/',{method:'HEAD',headers:{host:`localhost:${port}`}})).status,200);
})));

test('the request policy matches the configured port only',()=>{
  assert.equal(allowedLocalRequest({method:'GET',url:'/',headers:{host:'127.0.0.1:5601'}},5601),true);
  assert.equal(allowedLocalRequest({method:'GET',url:'/',headers:{host:'127.0.0.1:5602'}},5601),false);
  const cross={host:'127.0.0.1:5601','sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
  assert.equal(allowedLocalRequest({method:'GET',url:'/local/combined.json',headers:cross},5601),false);
});

test('/local/views.json lists only saved views that pass the check, and stays GET and HEAD only',()=>withFolder(async folder=>{
  const spec={root:'page',elements:{page:{type:'Section',props:{title:null,columns:12},children:['a']},a:{type:'Flags',props:{}}}};
  const view=(id,change={})=>JSON.stringify({id,title:id,question:null,spec,savedAt:'2026-11-18T10:00:00.000Z',origin:'composed',...change});
  const dir=path.join(folder,'data/public/local/views');
  await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'good.json'),view('good'));
  await writeFile(path.join(dir,'bad.json'),view('bad',{spec:{root:'a',elements:{a:{type:'Nope',props:{}}}}}));
  await writeFile(path.join(dir,'notes.txt'),'private');
  await serve(folder,async request=>{
    const response=await request('/local/views.json');
    assert.equal(response.status,200);
    assert.equal(response.headers['content-type'],'application/json');
    assert.equal(response.headers['cache-control'],'no-store');
    const body=JSON.parse(response.body);
    assert.equal(body.schema,'observatory-views/1');
    assert.deepEqual(body.views.map(item=>item.id),['good']);
    assert.equal((await request('/local/views.json',{method:'HEAD'})).status,200);
    for(const method of ['POST','PUT','DELETE','PATCH'])assert.equal((await request('/local/views.json',{method})).status,405,method);
    for(const url of ['/local/views/good.json','/local/views','/local/views.json/x','/views.json'])assert.equal((await request(url)).status,404,url);
    assert.equal((await request('/local/views.json',{headers:{'sec-fetch-site':'cross-site','sec-fetch-mode':'cors','sec-fetch-dest':'empty'}})).status,403);
    assert.equal((await request('/local/views.json',{headers:{host:'evil.example'}})).status,403);
  });
}));

test('/local/views.json is an empty list when nothing was saved',()=>withFolder(folder=>serve(folder,async request=>{
  assert.deepEqual(JSON.parse((await request('/local/views.json')).body).views,[]);
})));
