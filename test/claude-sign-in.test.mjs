// Signing in to Claude Code from the panel, the certificate file every claude process gets, and npm run doctor.
// The real `claude auth login` is never run here: a fake claude executable stands in for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod,mkdir,readFile,writeFile} from 'node:fs/promises';
import {readFileSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {CA_VARIABLES,certificateSource,claudeEnvironment,claudeVariables,shellCertificateFile} from '../lib/claude-env.mjs';
import {parseConfig,configEcho} from '../lib/config.mjs';
import {usageEnvironment} from '../scripts/claude-usage-command.mjs';
import {classify,parseAuthStatus,signIn,SIGN_IN_FILE,LOGIN_ARGUMENTS} from '../scripts/claude-sign-in.mjs';
import {doctor,describe,probeTls} from '../scripts/doctor.mjs';
import {recordCertificates} from '../scripts/setup.mjs';
import {combine} from '../lib/combine.mjs';
import {buildLimits} from '../lib/view-r2.mjs';
import {defaultScope} from '../lib/scope.mjs';
import strings from '../lib/strings.json' with {type:'json'};
import {ownSnapshot,testConfig,withFolder} from './helpers.mjs';

const S=strings.claudeSignIn;
const PEM='-----BEGIN CERTIFICATE-----\nc3ludGhldGlj\n-----END CERTIFICATE-----\n';
const posix=process.platform!=='win32';

async function bundle(folder,name='network.pem',text=PEM) {
  const file=path.join(realpathSync(folder),name);
  await writeFile(file,text);
  return file;
}

test('only NODE_EXTRA_CA_CERTS carries the certificate file, and it is in the list claude may get', () => {
  assert.deepEqual(CA_VARIABLES,['NODE_EXTRA_CA_CERTS']);
  for(const platform of ['darwin','linux','win32'])assert.ok(claudeVariables(platform).includes('NODE_EXTRA_CA_CERTS'),platform);
  assert.ok(!claudeVariables('darwin').includes('SSL_CERT_FILE'),'OpenSSL\'s variable is not passed: claude does not read it');
});

test('the environment keeps the allowlist, and the process\'s own certificate variable wins over the recorded file', () => withFolder(async folder => {
  const recorded=await bundle(folder,'recorded.pem'),own=await bundle(folder,'own.pem');
  const config={claude:{caCertificates:recorded}};
  const source={HOME:'/synthetic/home',PATH:'/synthetic/bin',ANTHROPIC_API_KEY:'synthetic',CLAUDECODE:'1',SSL_CERT_FILE:own,NODE_OPTIONS:'--use-openssl-ca'};
  assert.deepEqual(claudeEnvironment(config,source,'darwin'),{HOME:'/synthetic/home',PATH:'/synthetic/bin',NODE_EXTRA_CA_CERTS:recorded});
  assert.equal(claudeEnvironment(config,{...source,NODE_EXTRA_CA_CERTS:own},'darwin').NODE_EXTRA_CA_CERTS,own);
  assert.deepEqual(certificateSource(config,{},process.platform),{file:recorded,from:'settings',missing:false});
  // No settings: only the process's own variable, as the limits read always had.
  assert.deepEqual(usageEnvironment({PATH:'/synthetic/bin',NODE_EXTRA_CA_CERTS:own},'darwin'),{PATH:'/synthetic/bin',NODE_EXTRA_CA_CERTS:own});
  assert.deepEqual(usageEnvironment({PATH:'/synthetic/bin'},'darwin'),{PATH:'/synthetic/bin'});
}));

test('a recorded file that is gone or is not a certificate is never passed on, and reads missing', () => withFolder(async folder => {
  const notPem=await bundle(folder,'notes.txt','synthetic text');
  for(const file of [path.join(realpathSync(folder),'gone.pem'),notPem]) {
    const config={claude:{caCertificates:file}};
    assert.equal(claudeEnvironment(config,{PATH:'/synthetic/bin'},process.platform).NODE_EXTRA_CA_CERTS,undefined,file);
    assert.deepEqual(certificateSource(config,{},process.platform),{file:null,from:null,missing:true});
  }
  assert.deepEqual(certificateSource(null,{}),{file:null,from:null,missing:false});
}));

test('setup finds the shell\'s certificate file: NODE_EXTRA_CA_CERTS first, then SSL_CERT_FILE, only a real PEM file', () => withFolder(async folder => {
  const one=await bundle(folder,'one.pem'),two=await bundle(folder,'two.pem'),text=await bundle(folder,'x.txt','synthetic');
  assert.equal(shellCertificateFile({NODE_EXTRA_CA_CERTS:one,SSL_CERT_FILE:two}),one);
  assert.equal(shellCertificateFile({SSL_CERT_FILE:two}),two);
  assert.equal(shellCertificateFile({NODE_EXTRA_CA_CERTS:text,SSL_CERT_FILE:two}),two);
  for(const bad of [{},{SSL_CERT_FILE:'relative.pem'},{SSL_CERT_FILE:path.join(realpathSync(folder),'gone.pem')},{SSL_CERT_DIR:realpathSync(folder)},{SSL_CERT_FILE:realpathSync(folder)}])
    assert.equal(shellCertificateFile(bad),null,JSON.stringify(bad));
}));

test('setup records the certificate file in the user\'s settings only when it exists, and never prints the path', () => withFolder(async folder => {
  const file=await bundle(folder);
  const configFile=path.join(folder,'observatory.config.json');
  const original={device:{name:'Mac'},sources:{claudeLimits:true}};
  await writeFile(configFile,JSON.stringify(original));
  const printed=[];
  const log=line=>printed.push(line);
  assert.equal(await recordCertificates(configFile,{source:{SSL_CERT_FILE:file},dryRun:true,step:log,log}),'would-record');
  assert.deepEqual(JSON.parse(await readFile(configFile,'utf8')),original,'a dry run writes nothing');
  assert.equal(await recordCertificates(configFile,{source:{},step:log,log}),'none');
  assert.equal(await recordCertificates(configFile,{source:{NODE_EXTRA_CA_CERTS:path.join(folder,'gone.pem')},step:log,log}),'none');
  assert.deepEqual(JSON.parse(await readFile(configFile,'utf8')),original);
  assert.equal(await recordCertificates(configFile,{source:{SSL_CERT_FILE:file},step:log,log}),'recorded');
  const saved=JSON.parse(await readFile(configFile,'utf8'));
  assert.deepEqual(saved,{...original,claude:{caCertificates:file}});
  assert.equal(await recordCertificates(configFile,{source:{SSL_CERT_FILE:file},step:log,log}),'kept');
  assert.equal(parseConfig(saved,{platform:process.platform}).claude.caCertificates,file);
  assert.ok(!printed.join('\n').includes(file) && !printed.join('\n').includes(path.basename(file)),printed.join('\n'));
  // The echo other computers and the dashboard see carries no path.
  assert.ok(!JSON.stringify(configEcho(parseConfig(saved,{platform:process.platform}))).includes(path.basename(file)));
}));

test('claude.caCertificates must be an absolute path', () => {
  assert.throws(()=>parseConfig({claude:{caCertificates:'network.pem'}},{platform:'linux',environment:{}}),/claude\.caCertificates/);
  assert.throws(()=>parseConfig({claude:{other:true}},{platform:'linux',environment:{}}),/unknown setting other/);
  assert.equal(parseConfig({},{platform:'linux',environment:{}}).claude.caCertificates,null);
});

test('auth status reads a subscription only from a claude.ai sign-in served by Anthropic', () => {
  const status=extra=>JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',email:'synthetic@example.invalid',...extra});
  assert.deepEqual(parseAuthStatus(status()),{loggedIn:true,subscription:true});
  assert.deepEqual(parseAuthStatus(status({authMethod:'console'})),{loggedIn:true,subscription:false});
  assert.deepEqual(parseAuthStatus(status({authMethod:'api_key'})),{loggedIn:true,subscription:false});
  assert.deepEqual(parseAuthStatus(status({apiProvider:'bedrock'})),{loggedIn:true,subscription:false});
  assert.deepEqual(parseAuthStatus(JSON.stringify({loggedIn:false})),{loggedIn:false,subscription:false});
  for(const bad of ['not json','{}','null','[]'])assert.equal(parseAuthStatus(bad),null,bad);
});

test('each way a sign-in ends gets one plain line with its fix', () => {
  const cases=[
    [{ending:'exited',code:1,output:'Error: unable to get local issuer certificate (UNABLE_TO_GET_ISSUER_CERT_LOCALLY)'},'certificate',S.certificate],
    [{ending:'exited',code:1,output:'SELF_SIGNED_CERT_IN_CHAIN'},'certificate',S.certificate],
    [{ending:'exited',code:1,output:'CERT_HAS_EXPIRED',certificateMissing:true},'certificate',S.certificateMissing],
    [{ending:'exited',code:0,status:{loggedIn:true,subscription:false}},'console',S.console],
    [{ending:'not-found'},'not-found',S.notFound],
    [{ending:'timed-out',output:'Opening the browser'},'timed-out',S.timedOut],
    [{ending:'timed-out',output:'Paste code here if prompted'},'terminal',S.terminal],
    [{ending:'exited',code:1,output:'Raw mode is not supported on the current process.stdin'},'terminal',S.terminal],
    [{ending:'exited',code:130,output:''},'failed',S.failed],
    [{ending:'exited',code:0,status:{loggedIn:false,subscription:false}},'not-confirmed',S.failed],
    [{ending:'exited',code:0,status:{loggedIn:true,subscription:true}},'signed-in',S.done],
  ];
  for(const [input,reason,message] of cases)assert.deepEqual(classify(input),{state:reason==='signed-in'?'done':'failed',reason,message},JSON.stringify(input));
  // Every line is plain: no secrets, no claude output, the fix in it.
  assert.match(S.certificate,/NODE_EXTRA_CA_CERTS.*npm run setup again/);
  assert.match(S.console,/claude auth login --claudeai/);
});

// A fake claude: `auth status` answers from state.json beside it, `auth login` acts as told by login.json.
async function fakeClaude(folder,{login,status}) {
  const bin=path.join(realpathSync(folder),'bin');
  await mkdir(bin,{recursive:true});
  await writeFile(path.join(bin,'login.json'),JSON.stringify(login));
  await writeFile(path.join(bin,'state.json'),JSON.stringify(status));
  const file=path.join(bin,'claude');
  await writeFile(file,`#!${process.execPath}
const fs=require('fs'),path=require('path');
const here=__dirname,args=process.argv.slice(2).join(' ');
fs.appendFileSync(path.join(here,'calls.log'),args+' ca='+(process.env.NODE_EXTRA_CA_CERTS?'yes':'no')+' parent='+(process.env.CLAUDECODE?'yes':'no')+'\\n');
if(args==='auth status --json'){process.stdout.write(fs.readFileSync(path.join(here,'state.json'),'utf8'));process.exit(0);}
if(args==='auth login --claudeai'){
  const plan=JSON.parse(fs.readFileSync(path.join(here,'login.json'),'utf8'));
  if(plan.print)process.stderr.write(plan.print);
  if(plan.hang){setInterval(()=>{},1000);return;}
  if(plan.after)fs.writeFileSync(path.join(here,'state.json'),JSON.stringify(plan.after));
  process.exit(plan.code??0);
}
process.exit(2);
`);
  await chmod(file,0o700);
  return {file,calls:async()=>(await readFile(path.join(bin,'calls.log'),'utf8')).trim().split('\n')};
}

const subscription={loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',email:'synthetic@example.invalid',orgId:'synthetic-org'};

async function runSignIn(folder,fake,{source={PATH:'/usr/bin:/bin'},config={},loginTimeoutMs=10000}={}) {
  const data=path.join(realpathSync(folder),'data');
  await mkdir(data,{recursive:true,mode:0o700});
  const refreshed=[];
  const result=await signIn({...testConfig(data),...config},{source:{...source,CLAUDECODE:'1'},find:async()=>fake?.file ?? null,
    refresh:async config=>{refreshed.push(config.dataFolder);},loginTimeoutMs});
  const text=await readFile(path.join(data,'public','local',SIGN_IN_FILE),'utf8');
  return {result,refreshed,text,status:JSON.parse(text)};
}

test('a sign-in that works is confirmed with auth status, then every source is read again', {skip:!posix && 'Requires POSIX executable scripts'}, () => withFolder(async folder => {
  const ca=await bundle(folder);
  const fake=await fakeClaude(folder,{login:{after:subscription},status:{loggedIn:false}});
  const {result,refreshed,text,status}=await runSignIn(folder,fake,{config:{claude:{caCertificates:ca}}});
  assert.deepEqual(result,{state:'done',reason:'signed-in',message:S.done});
  assert.equal(refreshed.length,1);
  assert.deepEqual(Object.keys(status).sort(),['message','reason','schema','state','updatedAt']);
  assert.equal(status.state,'done');
  assert.equal(status.message,S.done);
  assert.doesNotMatch(text,/synthetic|example\.invalid|\.pem/,'no account details or paths');
  // Status first, then the login, then the confirmation. Each got the recorded certificate file and no parent variables.
  assert.deepEqual(await fake.calls(),['auth status --json ca=yes parent=no',`${LOGIN_ARGUMENTS.join(' ')} ca=yes parent=no`,'auth status --json ca=yes parent=no']);
}));

test('already signed in with a subscription: no login, only a refresh', {skip:!posix && 'Requires POSIX executable scripts'}, () => withFolder(async folder => {
  const fake=await fakeClaude(folder,{login:{code:9},status:subscription});
  const {result,refreshed}=await runSignIn(folder,fake);
  assert.equal(result.state,'done');
  assert.equal(refreshed.length,1);
  assert.deepEqual(await fake.calls(),['auth status --json ca=no parent=no']);
}));

test('failed sign-ins write the plain line and do not refresh', {skip:!posix && 'Requires POSIX executable scripts'}, () => withFolder(async folder => {
  const cases=[
    [{login:{print:'Token exchange failed: unable to get local issuer certificate',code:1},status:{loggedIn:false}},S.certificate],
    [{login:{after:{loggedIn:true,authMethod:'console',apiProvider:'firstParty'}},status:{loggedIn:false}},S.console],
    [{login:{hang:true,print:'Opening browser'},status:{loggedIn:false}},S.timedOut],
    [{login:{hang:true,print:'Paste code here if prompted >'},status:{loggedIn:false}},S.terminal],
    [{login:{code:1},status:{loggedIn:false}},S.failed],
  ];
  let index=0;
  for(const [plan,message] of cases) {
    const sub=path.join(folder,`case-${index++}`);
    await mkdir(sub);
    const fake=await fakeClaude(sub,plan);
    const {result,refreshed,status,text}=await runSignIn(sub,fake,{loginTimeoutMs:800});
    assert.equal(result.state,'failed',message);
    assert.equal(status.message,message);
    assert.equal(refreshed.length,0);
    assert.doesNotMatch(text,/Token exchange|Paste code|Opening browser/,'none of claude\'s own output');
  }
  const missing=await runSignIn(path.join(folder,'case-0'),null);
  assert.equal(missing.status.message,S.notFound);
  // The recorded certificate file is gone: the line says so.
  const gone=path.join(folder,'case-0','gone');
  await mkdir(gone);
  const fake=await fakeClaude(gone,cases[0][0]);
  assert.equal((await runSignIn(gone,fake,{config:{claude:{caCertificates:path.join(realpathSync(gone),'gone.pem')}}})).status.message,S.certificateMissing);
}));

test('a second sign-in while one runs leaves the first alone', {skip:!posix && 'Requires POSIX executable scripts'}, () => withFolder(async folder => {
  const fake=await fakeClaude(folder,{login:{hang:true},status:{loggedIn:false}});
  const data=path.join(realpathSync(folder),'data');
  await mkdir(data,{recursive:true,mode:0o700});
  const options={find:async()=>fake.file,refresh:async()=>{},loginTimeoutMs:1500,source:{PATH:'/usr/bin:/bin'}};
  const first=signIn(testConfig(data),options);
  // Wait until the first one has started its login.
  for(const until=Date.now()+5000;Date.now()<until;await new Promise(resolve=>setImmediate(resolve))) {
    if((await fake.calls().catch(()=>[])).some(line=>line.startsWith('auth login')))break;
  }
  assert.equal((await signIn(testConfig(data),options)).state,'busy');
  assert.equal((await first).reason,'timed-out');
}));

test('the check names each problem with one fix, and never signs in', async () => {
  const config={...testConfig('/synthetic/data'),claude:{caCertificates:null}};
  const run=overrides=>doctor({config,source:{},platform:'darwin',find:async()=>'/synthetic/claude',status:async()=>({loggedIn:true,subscription:true}),
    probe:async()=>'trusted',readCa:async()=>PEM,...overrides});
  const text=lines=>describe(lines);
  assert.ok((await run()).every(line=>line.ok!==false),text(await run()));
  assert.match(text(await run({find:async()=>null})),/fix\s+Claude Code was not found\.\n\s+Install Claude Code/);
  assert.match(text(await run({status:async()=>({loggedIn:false,subscription:false})})),/Claude Code is signed out\.\n\s+Use Sign in to Claude in the menu bar panel, or run claude auth login --claudeai\./);
  assert.match(text(await run({platform:'win32',status:async()=>({loggedIn:false,subscription:false})})),/the tray panel/);
  assert.match(text(await run({platform:'linux',status:async()=>({loggedIn:false,subscription:false})})),/fix\s+Claude Code is signed out\.\n\s+Run claude auth login --claudeai\./);
  assert.match(text(await run({status:async()=>({loggedIn:true,subscription:false})})),/Anthropic Console account.*\n\s+Sign in with your Claude subscription: claude auth login --claudeai/);
  assert.match(text(await run({probe:async()=>'certificate'})),/cannot trust this network's certificate.*\n\s+.*NODE_EXTRA_CA_CERTS/);
  assert.match(text(await run({probe:async()=>'unreachable'})),/note\s+Anthropic could not be reached/);
  assert.match(text(await run({config:null,configError:'synthetic'})),/fix\s+Settings could not be read: synthetic/);
  assert.match(text(await run({config:{...config,sources:{claudeLimits:false}}})),/Claude limits are off/);
  await withFolder(async folder => {
    const file=await bundle(folder);
    let given=null;
    const lines=await run({source:{SSL_CERT_FILE:file},probe:async(host,extra)=>{given=extra;return 'trusted';}});
    assert.match(text(lines),/fix\s+This shell trusts an extra certificate file.*\n\s+Run npm run setup again/);
    assert.ok(!text(lines).includes(file),'the path is not printed');
    const recorded=await run({config:{...config,claude:{caCertificates:file}},probe:async(host,extra)=>{given=extra;return 'trusted';}});
    assert.match(text(recorded),/ok\s+Claude Code gets the certificate file recorded by setup/);
    assert.equal(given,PEM,'the probe trusts what claude would');
    assert.match(text(await run({config:{...config,claude:{caCertificates:path.join(folder,'gone.pem')}}})),/fix\s+The certificate file recorded by setup is missing/);
  });
});

test('the TLS probe tells a certificate failure from no network', async () => {
  const fake=outcome=>(options,ready)=>{
    const socket=new EventEmitter();socket.destroy=()=>{};
    setImmediate(()=>outcome==='ok'?ready():socket.emit('error',Object.assign(Error('synthetic'),{code:outcome})));
    return socket;
  };
  assert.equal(await probeTls('example.invalid',{connect:fake('ok')}),'trusted');
  assert.equal(await probeTls('example.invalid',{connect:fake('UNABLE_TO_GET_ISSUER_CERT_LOCALLY')}),'certificate');
  assert.equal(await probeTls('example.invalid',{connect:fake('SELF_SIGNED_CERT_IN_CHAIN')}),'certificate');
  assert.equal(await probeTls('example.invalid',{connect:fake('ENOTFOUND')}),'unreachable');
  assert.equal(await probeTls('example.invalid',{connect:()=>{const socket=new EventEmitter();socket.destroy=()=>{};return socket;},timeoutMs:50}),'unreachable');
});

test('the dashboard\'s Limits view says where Claude is signed out and how to sign in there', () => {
  const now=Date.now();
  const signedOut=host=>ownSnapshot(host,now,snapshot=>({...snapshot,claudeLimits:{provider:'Claude Code',scope:'account',status:'needs-auth',windows:[]}}));
  for(const [host,line] of [['Mac',S.panelMac],['Windows',S.panelWindows]]) {
    const combined=combine([{host,snapshot:signedOut(host)}],{now});
    const claude=buildLimits(combined,defaultScope(combined,{now}),{now}).engines.find(engine=>engine.engine==='claude');
    assert.deepEqual(claude.signIn,{on:host==='Mac'?'Test Mac':'Test PC',line},host);
  }
});

test('both panels draw the Sign in to Claude button from glance.json and run the sign-in script', () => {
  const read=file=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
  const swift=read('glance/mac/Glance.swift'),cs=read('glance/windows/Glance.cs');
  assert.match(swift,/json\["signIn"\]/);
  assert.match(swift,/scripts\/claude-sign-in\.mjs/);
  assert.match(swift,/\.disabled\(state\.signingIn\)/);
  assert.match(swift,/localFile\("sign-in\.json"\)/);
  assert.match(cs,/Get\(json, "signIn"\)/);
  assert.match(cs,/Path\.Combine\("scripts", "claude-sign-in\.mjs"\)/);
  assert.match(cs,/if \(hits != null && !s\.SigningIn\) hits\.Add\(Tuple\.Create\(button, "signin"\)\)/);
  assert.match(cs,/name == "signin"\) StartSignIn\(\)/);
  assert.match(cs,/"sign-in\.json"/);
  // C# 5 for the .NET Framework compiler: no interpolated strings and no null-conditional operators.
  assert.doesNotMatch(cs,/\$"|\?\.[A-Za-z]/);
});

test('the sign-in file is not one the dashboard server hands out', () => {
  const server=()=>readFileSync(new URL('../serve-local.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(server(),/sign-in/);
  assert.match(server(),/path\.extname\(requested\)==='\.json'/,'other .json paths are refused');
});
