import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readdir,writeFile} from 'node:fs/promises';
import {PassThrough} from 'node:stream';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {withFolder} from '../test/helpers.mjs';
import {createMcpServer,serve,PROTOCOL_VERSIONS} from './mcp-server.mjs';
import {BLOCK_TYPES} from '../lib/r2-blocks.mjs';

const SCRIPT=fileURLToPath(new URL('./mcp-server.mjs',import.meta.url));
const spec=()=>({root:'page',elements:{
  page:{type:'Section',props:{title:'Spend',columns:6},children:['spend']},
  spend:{type:'Headline',props:{metric:'spend',scope:{range:{unit:'week'}}}}}});
const call=(server,name,args,id=1)=>server.handle({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});
const rpc=(server,method,params,id=1)=>server.handle({jsonrpc:'2.0',id,method,params});

test('initialize negotiates the protocol version and says what the server offers',async()=>withFolder(async folder=>{
  const server=createMcpServer({dataFolder:folder});
  const result=(await rpc(server,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'t',version:'1'}})).result;
  assert.equal(result.protocolVersion,'2025-06-18');
  assert.deepEqual(Object.keys(result.capabilities),['tools']);
  assert.equal(result.serverInfo.name,'observatory');
  assert.equal((await rpc(server,'initialize',{protocolVersion:'1999-01-01'})).result.protocolVersion,PROTOCOL_VERSIONS[0]);
  assert.equal(await server.handle({jsonrpc:'2.0',method:'notifications/initialized'}),null);
  assert.deepEqual((await rpc(server,'ping')).result,{});
}));

test('tools/list offers exactly four tools, none that read data, each with an object input schema',async()=>withFolder(async folder=>{
  const {tools}=(await rpc(createMcpServer({dataFolder:folder}),'tools/list')).result;
  assert.deepEqual(tools.map(tool=>tool.name),['get_catalog','compose_view','list_views','remove_view']);
  for(const tool of tools) {
    assert.equal(tool.inputSchema.type,'object');
    assert.equal(tool.inputSchema.additionalProperties,false);
    assert.equal(typeof tool.annotations.readOnlyHint,'boolean');
  }
  assert.equal(tools.find(tool=>tool.name==='remove_view').annotations.destructiveHint,true);
}));

test('get_catalog lists every block, with the limits and a spec that passes',async()=>withFolder(async folder=>{
  const server=createMcpServer({dataFolder:folder});
  const result=(await call(server,'get_catalog',{})).result;
  assert.equal(result.isError,false);
  const catalog=result.structuredContent;
  assert.deepEqual(Object.keys(catalog.blocks),[...BLOCK_TYPES]);
  assert.equal(catalog.limits.elements,40);
  assert.equal(JSON.parse(result.content[0].text).limits.savedViews,50);
  assert.deepEqual(catalog.blocks.Breakdown.props.required,['metric','dim'],'the props are the zod schema the check uses');
  assert.equal(catalog.blocks.Breakdown.props.additionalProperties,false);
  const saved=(await call(server,'compose_view',{id:'example',title:'Example',spec:catalog.example})).result;
  assert.equal(saved.isError,false,saved.content[0].text);
}));

test('compose_view saves, list_views lists, remove_view removes',async()=>withFolder(async folder=>{
  const server=createMcpServer({dataFolder:folder,now:()=>Date.parse('2026-11-18T10:00:00Z')});
  const saved=(await call(server,'compose_view',{id:'week',title:'This week',question:'How was the week?',spec:spec()})).result;
  assert.equal(saved.isError,false);
  assert.equal(saved.structuredContent.id,'week');
  assert.deepEqual(await readdir(path.join(folder,'public','local','views')),['week.json']);
  const listed=(await call(server,'list_views',{})).result.structuredContent;
  assert.deepEqual(listed.views,[{id:'week',title:'This week',question:'How was the week?',savedAt:'2026-11-18T10:00:00.000Z',origin:'composed',elements:2}]);
  assert.deepEqual((await call(server,'list_views',{id:'week'})).result.structuredContent.spec,spec());
  assert.equal((await call(server,'list_views',{id:'nope'})).result.isError,true);
  assert.equal((await call(server,'remove_view',{id:'week'})).result.isError,false);
  assert.equal((await call(server,'remove_view',{id:'week'})).result.isError,true);
  assert.deepEqual((await call(server,'list_views',{})).result.structuredContent.views,[]);
}));

test('compose_view refuses a bad spec, an unknown block, an oversize spec and a taken id, with reasons and nothing written',async()=>withFolder(async folder=>{
  const server=createMcpServer({dataFolder:folder});
  const refuse=async(args,pattern)=>{
    const result=(await call(server,'compose_view',args)).result;
    assert.equal(result.isError,true);
    assert.match(result.content[0].text,pattern);
  };
  const unknown=spec();unknown.elements.spend.type='PieChart';
  await refuse({id:'a',title:'A',spec:unknown},/unknown block PieChart/);
  const numbers=spec();numbers.elements.spend.props.value=1234;
  await refuse({id:'a',title:'A',spec:numbers},/spend: .*value/);
  const big={root:'r',elements:{r:{type:'Section',props:{title:null,columns:1},children:[]}}};
  for(let i=0;i<41;i++) {big.elements[`e${i}`]={type:'Flags',props:{}};big.elements.r.children.push(`e${i}`);}
  await refuse({id:'a',title:'A',spec:big},/42 elements, over 40/);
  await refuse({id:'Bad Id',title:'A',spec:spec()},/id must be/);
  await refuse({id:'a',title:'A',spec:spec(),extra:true},/extra is not an argument/);
  await refuse({title:'A',spec:spec()},/id is required/);
  await refuse({id:'a',title:'A',spec:spec(),replace:'yes'},/replace must be true or false/);
  assert.deepEqual(await readdir(folder),[]);
  assert.equal((await call(server,'compose_view',{id:'a',title:'A',spec:spec()})).result.isError,false);
  await refuse({id:'a',title:'B',spec:spec()},/already exists/);
  assert.equal((await call(server,'compose_view',{id:'a',title:'B',spec:spec(),replace:true})).result.structuredContent.replaced,true);
}));

test('compose_view refuses what only the zod catalog knows: a metric split by a dimension it does not have',async()=>withFolder(async folder=>{
  const server=createMcpServer({dataFolder:folder});
  const wrong=spec();wrong.elements.spend={type:'Breakdown',props:{metric:'onMain',dim:'model'}};
  const result=(await call(server,'compose_view',{id:'a',title:'A',spec:wrong})).result;
  assert.equal(result.isError,true);
  assert.match(result.content[0].text,/onMain does not split by model/);
  assert.deepEqual(await readdir(folder),[]);
}));

test('protocol errors: unknown method, unknown tool, malformed request',async()=>withFolder(async folder=>{
  const server=createMcpServer({dataFolder:folder});
  assert.equal((await rpc(server,'resources/list')).error.code,-32601);
  assert.equal((await call(server,'query_usage',{})).error.code,-32602);
  assert.equal((await server.handle({jsonrpc:'2.0',id:3})).error.code,-32600);
  assert.equal((await server.handle({id:3,method:'ping'})).error.code,-32600);
  assert.equal((await server.handle('ping')).error.code,-32600);
  assert.equal((await server.handle([])).error.code,-32600);
  const batch=await server.handle([{jsonrpc:'2.0',id:1,method:'ping'},{jsonrpc:'2.0',method:'notifications/initialized'}]);
  assert.equal(batch.length,1);
}));

test('over stdio: one JSON message per line, in order, a parse error answered, stdout holds protocol only',async()=>withFolder(async folder=>{
  const input=new PassThrough(),output=new PassThrough();
  const chunks=[];output.on('data',chunk=>chunks.push(chunk));
  const done=serve({input,output,server:createMcpServer({dataFolder:folder})});
  input.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}\n');
  input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n\n');
  input.write('not json\n');
  input.end('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
  await done;
  const lines=Buffer.concat(chunks).toString().trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(lines.map(line=>line.id),[1,null,2]);
  assert.equal(lines[1].error.code,-32700);
  assert.equal(lines[2].result.tools.length,4);
}));

test('the real process speaks the protocol and writes only into the views folder of the configured data folder',()=>withFolder(async folder=>{
  const data=path.join(folder,'data');await mkdir(data);
  const config=path.join(folder,'observatory.config.json');
  await writeFile(config,JSON.stringify({dataFolder:data}));
  const child=spawn(process.execPath,[SCRIPT],{env:{...process.env,OBSERVATORY_CONFIG:config},stdio:['pipe','pipe','pipe']});
  const answers=[];let buffer='';
  const waiting=new Map();
  child.stdout.on('data',chunk=>{
    buffer+=chunk;
    let at;
    while((at=buffer.indexOf('\n'))>=0) {
      const message=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);
      answers.push(message);waiting.get(message.id)?.(message);
    }
  });
  const ask=message=>new Promise(resolve=>{waiting.set(message.id,resolve);child.stdin.write(`${JSON.stringify({jsonrpc:'2.0',...message})}\n`);});
  try {
    assert.equal((await ask({id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}})).result.serverInfo.name,'observatory');
    const saved=await ask({id:2,method:'tools/call',params:{name:'compose_view',arguments:{id:'week',title:'Week',spec:spec()}}});
    assert.equal(saved.result.isError,false);
    assert.deepEqual(await readdir(data),['public']);
    assert.deepEqual(await readdir(path.join(data,'public','local')),['views']);
    assert.deepEqual(await readdir(folder),['data','observatory.config.json']);
  } finally {
    child.stdin.end();
    await new Promise(resolve=>child.on('close',resolve));
  }
  assert.equal(answers.length,2);
}));

test('without a settings file the process stops with a message on stderr and nothing on stdout',()=>withFolder(async folder=>{
  const child=spawn(process.execPath,[SCRIPT],{env:{...process.env,OBSERVATORY_CONFIG:path.join(folder,'missing.json')},stdio:['pipe','pipe','pipe']});
  let out='',err='';
  child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});
  const code=await new Promise(resolve=>child.on('close',resolve));
  assert.equal(code,1);
  assert.equal(out,'');
  assert.match(err,/No settings file/);
}));
