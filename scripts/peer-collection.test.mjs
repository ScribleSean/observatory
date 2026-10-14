import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePeerCollection} from './peer-collection.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const pairing=()=>({pairId:'a'.repeat(64),deviceId:'b'.repeat(64),comparisonId:'c'.repeat(64),
  comparisonSalt:'d'.repeat(64),host:'Windows',codexHosts:['Windows']});

test('paired source reader receives a bounded literal salt, projection configuration does not',()=>{
  const value=pairing(),result=preparePeerCollection(value,'Windows',['Windows']);
  assert.equal(result.readerPrefix,`INVENTORY_SALT = '${value.comparisonSalt}'\n`);
  assert.ok(!JSON.stringify(result.config).includes(value.comparisonSalt));
  assert.equal(result.config.comparisonId,value.comparisonId);
  assert.equal(Object.hasOwn(result.config,'codexHosts'),false);
  const {codexHosts,...current}=value;
  assert.deepEqual(preparePeerCollection(current,'Windows'),result);
  assert.throws(()=>preparePeerCollection(value,'Windows',['Windows','Ubuntu']));
});

test('invalid salts, extra fields and host ownership mismatches are rejected',()=>{
  for(const changed of [{comparisonSalt:"'\nraise Exception('injection')"},{comparisonSalt:''},
    {host:'Mac'},{codexHosts:['Windows','Ubuntu']},{secret:'unexpected'},{pairId:3}])
    assert.throws(()=>preparePeerCollection({...pairing(),...changed},'Windows'));
});

test('Mac pairing has exactly its own source and preserves the shared generation',()=>{
  const value={...pairing(),host:'Mac',codexHosts:['Mac']};
  const result=preparePeerCollection(value,'Mac',['Mac']);
  assert.equal(result.config.host,'Mac');assert.equal(result.config.comparisonId,value.comparisonId);
});

test('native collector returns a separate paired export without persisting secrets',
  {skip:!['darwin','win32'].includes(process.platform)},async t=>{
    const runtime=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-paired-native-')));
    t.after(()=>rm(runtime,{recursive:true,force:true}));
    const mac=process.platform==='darwin',host=mac?'Mac':'Windows';
    const config=mac?{activity:false,codex:false,wispr:false,typewhisper:false}:
      {activity:false,codex:false,wispr:false,wslDistribution:null};
    await writeFile(path.join(runtime,'collector.config.json'),JSON.stringify(config));
    const value={...pairing(),host,codexHosts:[host]};
    const url=new URL(mac?'./collect-mac.mjs':'./collect-windows.mjs',import.meta.url).href;
    const args=mac?[runtime,'/usr/bin/python3',value]:[runtime,value];
    const code=`import {${mac?'collectMac':'collectWindows'} as collect} from ${JSON.stringify(url)};
      const result=await collect(...${JSON.stringify(args)});
      process.stdout.write(JSON.stringify(result));`;
    const output=execFileSync(process.execPath,['--input-type=module','-'],{input:code,encoding:'utf8',timeout:20000});
    const result=JSON.parse(output.slice(output.indexOf('\n')+1));
    assert.equal(result.peer.status,'ready');assert.equal(result.peer.payload.host,host);
    assert.ok(!output.includes(value.comparisonSalt));
    const dashboard=await readFile(path.join(runtime,'public/local/usage.json'),'utf8');
    assert.ok(!dashboard.includes(value.comparisonId));assert.ok(!dashboard.includes('inventory'));
    assert.deepEqual((await readdir(runtime)).sort(),['collector.config.json','public']);
  });
