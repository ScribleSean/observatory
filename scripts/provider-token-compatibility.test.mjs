import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,realpath,rm,cp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPairingConfigurations,initializePairing} from './peer-pairing.mjs';
import {createPeerPayload} from './peer-payload.mjs';
import {publishLocalPayload,createPeerRecord,readPeerState} from './peer-store.mjs';

// Frozen endpoint source from main 2292d0d. Execute it as a separate process so
// rolling-upgrade coverage cannot silently acquire the new optional dispatcher.
const legacyEndpoint = [
  "import {fileURLToPath} from 'node:url';",
  "import {readPairing} from './peer-pairing.mjs';",
  "import {readPeerState,acceptPeerState} from './peer-store.mjs';",
  "import {assertPairingActive} from './peer-revocation.mjs';",
  "import {withPeerStateLock} from './peer-lock.mjs';",
  "",
  "// This is a local stdin/stdout endpoint for an authenticated SSH session, not a",
  "// network listener. Its caller must authenticate the remote host and account.",
  "export const exchangePeerRecord=(runtime,request,now=Date.now())=>",
  "  withPeerStateLock(runtime,()=>exchangePeerRecordLocked(runtime,request,now));",
  "async function exchangePeerRecordLocked(runtime,request,now) {",
  "  if(!request || typeof request!=='object' || Array.isArray(request) || request.version!==1 ||",
  "    Object.keys(request).length!==2 || !Object.hasOwn(request,'record'))throw Error('Invalid exchange request');",
  "  const pairing=await readPairing(runtime);",
  "  const host=process.platform==='darwin'?'Mac':process.platform==='win32'?'Windows':null;",
  "  if(!pairing || pairing.local.host!==host)throw Error('Local pairing unavailable');",
  "  const local=await readPeerState(runtime,pairing.local,now,'local');",
  "  if(!local)throw Error('Local snapshot unavailable');",
  "  await acceptPeerState(runtime,request.record,pairing.peer,now);",
  "  await assertPairingActive(runtime);",
  "  return {version:1,record:local};",
  "}",
  "",
  "async function main(runtime) {",
  "  const chunks=[];let size=0;",
  "  const timer=setTimeout(()=>{process.stderr.write('Peer exchange input timeout\\n');process.exit(1);},30000);",
  "  try {",
  "    for await(const chunk of process.stdin) {",
  "      size+=chunk.length;if(size>17_000_000)throw Error('Exchange input limit');chunks.push(chunk);",
  "    }",
  "    const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));",
  "    const response=await exchangePeerRecord(runtime,JSON.parse(text));",
  "    process.stdout.write(JSON.stringify(response));",
  "  } finally {clearTimeout(timer);}",
  "}",
  "",
  "if(process.argv[1]===fileURLToPath(import.meta.url))main(process.argv[2])",
  "  .catch(()=>{process.stderr.write('Private peer exchange unavailable\\n');process.exitCode=1;});",
].join('\n') + '\n';

test('legacy and upgraded endpoint processes share core records while only the upgrade accepts the optional channel',
  {skip:!['darwin','win32'].includes(process.platform),timeout:process.platform==='win32'?300000:30000},async t=>{
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'observatory-provider-compatibility-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const scripts=path.join(root,'scripts'),runtime=await mkdtemp(path.join(root,'runtime-'));
  await cp(fileURLToPath(new URL('.',import.meta.url)),scripts,{recursive:true,
    filter:file=>!file.endsWith('.test.mjs')});
  const legacy=path.join(scripts,'legacy-peer-exchange.mjs');await writeFile(legacy,legacyEndpoint);
  const pair=createPairingConfigurations()[process.platform==='darwin'?'Mac':'Windows'];
  await initializePairing(runtime,pair);
  const raw={collectedAt:new Date().toISOString(),activity:{status:'not-connected'},
    dictation:[{source:'Wispr Flow',status:'not-connected'}]};
  const payload=config=>createPeerPayload({...raw,codex:[{host:config.host,status:'not-connected'}]},config);
  const local=await publishLocalPayload(runtime,payload(pair.local),pair.local);
  const peer=createPeerRecord(payload(pair.peer),pair.peer,1);
  const invoke=(script,message)=>spawnSync(process.execPath,[script,runtime],{encoding:'utf8',input:JSON.stringify(message),timeout:30000});
  const core={version:1,record:peer};
  const first=invoke(legacy,core);assert.equal(first.status,0,first.stderr);assert.deepEqual(JSON.parse(first.stdout),{version:1,record:local});
  const probe={version:1,channel:'provider-tokens',request:{version:1,action:'status',pairId:pair.peer.pairId,deviceId:pair.peer.deviceId}};
  const unsupported=invoke(legacy,probe);assert.equal(unsupported.status,1);assert.equal(unsupported.stdout,'');
  const newer=invoke(path.join(scripts,'peer-exchange.mjs'),probe);assert.equal(newer.status,0,newer.stderr);
  assert.deepEqual(JSON.parse(newer.stdout),{version:1,status:'disabled',record:null});
  const again=invoke(legacy,core);assert.equal(again.status,0,again.stderr);assert.deepEqual(JSON.parse(again.stdout),JSON.parse(first.stdout));
  assert.deepEqual(await readPeerState(runtime,pair.peer),peer);
  assert.deepEqual(await readPeerState(runtime,pair.local,Date.now(),'local'),local);
});
