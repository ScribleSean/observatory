// Signing in to Claude Code from the panel, the certificate file every claude process gets, and npm run doctor.
// The real `claude auth login` is never run here: a fake claude executable stands in for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {readFileSync,realpathSync} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {CA_VARIABLES,certStoreValue,certificateSource,certificateStore,claudeEnvironment,claudeVariables,settingsCertificates,shellCertificateFile} from '../lib/claude-env.mjs';
import {parseConfig,configEcho} from '../lib/config.mjs';
import {usageEnvironment,USAGE_ARGUMENTS} from '../scripts/claude-usage-command.mjs';
import {TICK_DEADLINE_MS} from '../scripts/tick.mjs';
import {classify,parseAuthStatus,signIn,runLimitMs,SIGN_IN_FILE,LOGIN_ARGUMENTS,LOGIN_TIMEOUT_MS,REFRESH_LIMIT_MS,REFRESH_WAIT_MS} from '../scripts/claude-sign-in.mjs';
import {doctor,describe,probeTls,storeRoots,systemRoots} from '../scripts/doctor.mjs';
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

test('one list names the certificate variables claude may get: the extra file and the certificate store', () => {
  assert.deepEqual(CA_VARIABLES,['NODE_EXTRA_CA_CERTS','CLAUDE_CODE_CERT_STORE']);
  for(const platform of ['darwin','linux','win32'])for(const name of CA_VARIABLES)assert.ok(claudeVariables(platform).includes(name),`${platform} ${name}`);
  assert.ok(!claudeVariables('darwin').includes('SSL_CERT_FILE'),'OpenSSL\'s variable is not passed: claude does not read it');
});

test('the environment keeps the allowlist, and the process\'s own certificate variable wins over the recorded file', () => withFolder(async folder => {
  const recorded=await bundle(folder,'recorded.pem'),own=await bundle(folder,'own.pem');
  const config={claude:{caCertificates:recorded}};
  const source={HOME:'/synthetic/home',PATH:'/synthetic/bin',ANTHROPIC_API_KEY:'synthetic',CLAUDECODE:'1',SSL_CERT_FILE:own,NODE_OPTIONS:'--use-openssl-ca'};
  // The real platform: the files are real, and a Windows path is not absolute on POSIX.
  const kept=process.platform==='win32'?{PATH:'/synthetic/bin'}:{HOME:'/synthetic/home',PATH:'/synthetic/bin'};
  assert.deepEqual(claudeEnvironment(config,source,process.platform),{...kept,NODE_EXTRA_CA_CERTS:recorded});
  assert.equal(claudeEnvironment(config,{...source,NODE_EXTRA_CA_CERTS:own},process.platform).NODE_EXTRA_CA_CERTS,own);
  assert.deepEqual(certificateSource(config,{},process.platform),{file:recorded,from:'settings',missing:false});
  // No settings: only the process's own variable, as the limits read always had.
  assert.deepEqual(usageEnvironment({PATH:'/synthetic/bin',NODE_EXTRA_CA_CERTS:own},'darwin'),{PATH:'/synthetic/bin',NODE_EXTRA_CA_CERTS:own});
  assert.deepEqual(usageEnvironment({PATH:'/synthetic/bin'},'darwin'),{PATH:'/synthetic/bin'});
}));

test('the certificate store is passed only when the user set it: this process first, then the one recorded at setup', () => withFolder(async folder => {
  const file=await bundle(folder);
  const source={PATH:'/synthetic/bin'};
  // Never invented: nothing set, nothing passed, with or without a certificate file.
  assert.equal(claudeEnvironment({claude:{caCertificates:file}},source,process.platform).CLAUDE_CODE_CERT_STORE,undefined);
  assert.equal(certificateStore({claude:{caCertificates:file,certStore:null}},{}),null);
  const recorded={claude:{caCertificates:file,certStore:'system'}};
  const environment=claudeEnvironment(recorded,source,process.platform);
  assert.equal(environment.CLAUDE_CODE_CERT_STORE,'system');
  assert.equal(environment.NODE_EXTRA_CA_CERTS,file);
  assert.equal(claudeEnvironment(recorded,{...source,CLAUDE_CODE_CERT_STORE:'bundled'},process.platform).CLAUDE_CODE_CERT_STORE,'bundled');
  // Only the two known stores: anything else is left out, from either place.
  assert.equal(claudeEnvironment(recorded,{...source,CLAUDE_CODE_CERT_STORE:'synthetic'},process.platform).CLAUDE_CODE_CERT_STORE,'system');
  assert.equal(certificateStore({claude:{certStore:'synthetic'}},{CLAUDE_CODE_CERT_STORE:''}),null);
  // The limits read with no settings passes this process's own value.
  assert.deepEqual(usageEnvironment({PATH:'/synthetic/bin',CLAUDE_CODE_CERT_STORE:'system'},'darwin'),{PATH:'/synthetic/bin',CLAUDE_CODE_CERT_STORE:'system'});
  assert.equal(parseConfig({claude:{certStore:'system'}},{platform:'linux',environment:{}}).claude.certStore,'system');
  assert.equal(parseConfig({},{platform:'linux',environment:{}}).claude.certStore,null);
  assert.throws(()=>parseConfig({claude:{certStore:'other'}},{platform:'linux',environment:{}}),/claude\.certStore/);
  // Read as Claude Code reads it: a list separated by commas, any letter case, spaces around names, known names only.
  for(const [given,value] of [['system','system'],['BUNDLED','bundled'],[' System , bundled ','system,bundled'],['bundled,system','bundled,system'],
    ['system,system','system'],['system,synthetic','system'],['synthetic',null],['',null],[',',null],[7,null],[null,null],[undefined,null]])
    assert.equal(certStoreValue(given),value,JSON.stringify(given));
  assert.equal(claudeEnvironment(null,{...source,CLAUDE_CODE_CERT_STORE:' Bundled, SYSTEM '},process.platform).CLAUDE_CODE_CERT_STORE,'bundled,system');
  assert.equal(claudeEnvironment({claude:{certStore:'System'}},source,process.platform).CLAUDE_CODE_CERT_STORE,'system');
  assert.equal(parseConfig({claude:{certStore:' System , Bundled '}},{platform:'linux',environment:{}}).claude.certStore,'system,bundled');
  assert.throws(()=>parseConfig({claude:{certStore:7}},{platform:'linux',environment:{}}),/claude\.certStore/);
}));

test('setup takes what the shell lacks from the env block of Claude Code\'s settings file, reads it only, and prints nothing of it', () => withFolder(async folder => {
  const shellFile=await bundle(folder,'shell.pem'),ownFile=await bundle(folder,'own.pem');
  const claudeSettings=path.join(realpathSync(folder),'claude-settings.json');
  const settingsText=JSON.stringify({env:{NODE_EXTRA_CA_CERTS:ownFile,CLAUDE_CODE_CERT_STORE:'system',SYNTHETIC_OTHER:'synthetic-value'},statusLine:{command:'synthetic'}});
  await writeFile(claudeSettings,settingsText);
  assert.deepEqual(settingsCertificates(JSON.parse(settingsText)),{file:ownFile,store:'system'});
  for(const bad of [null,[],{},{env:null},{env:[]},{env:{NODE_EXTRA_CA_CERTS:'relative.pem',CLAUDE_CODE_CERT_STORE:'synthetic'}},{env:{NODE_EXTRA_CA_CERTS:path.join(realpathSync(folder),'gone.pem'),CLAUDE_CODE_CERT_STORE:7}}])
    assert.deepEqual(settingsCertificates(bad),{file:null,store:null},JSON.stringify(bad));
  const configFile=path.join(folder,'observatory.config.json');
  const original={device:{name:'Mac'}};
  const printed=[];
  const log=line=>printed.push(line);
  const record=(source,extra={})=>recordCertificates(configFile,{source,claudeSettings,step:log,log,...extra});
  await writeFile(configFile,JSON.stringify(original));
  assert.equal(await record({},{dryRun:true}),'would-record');
  assert.deepEqual(JSON.parse(await readFile(configFile,'utf8')),original,'a dry run writes nothing');
  // The shell lacks both: both come from Claude Code's settings file.
  assert.equal(await record({}),'recorded');
  assert.deepEqual(JSON.parse(await readFile(configFile,'utf8')),{...original,claude:{caCertificates:ownFile,certStore:'system'}});
  assert.equal(await record({}),'kept');
  // The shell wins for each value it sets.
  assert.equal(await record({NODE_EXTRA_CA_CERTS:shellFile,CLAUDE_CODE_CERT_STORE:'bundled'}),'recorded');
  assert.deepEqual(JSON.parse(await readFile(configFile,'utf8')),{...original,claude:{caCertificates:shellFile,certStore:'bundled'}});
  // The variable claude reads comes first, from the shell and then from Claude Code's settings. The shell's OpenSSL
  // variable is used only when neither has one. The store is recorded as Claude Code reads it.
  await writeFile(configFile,JSON.stringify(original));
  assert.equal(await record({SSL_CERT_FILE:shellFile,CLAUDE_CODE_CERT_STORE:' Bundled , SYSTEM '}),'recorded');
  assert.deepEqual(JSON.parse(await readFile(configFile,'utf8')),{...original,claude:{caCertificates:ownFile,certStore:'bundled,system'}});
  await writeFile(configFile,JSON.stringify(original));
  assert.equal(await record({SSL_CERT_FILE:shellFile},{claudeSettings:path.join(realpathSync(folder),'none.json')}),'recorded');
  assert.deepEqual(JSON.parse(await readFile(configFile,'utf8')),{...original,claude:{caCertificates:shellFile}});
  // The shell's store alone, with no certificate file anywhere.
  await writeFile(configFile,JSON.stringify(original));
  assert.equal(await record({CLAUDE_CODE_CERT_STORE:'system'},{claudeSettings:path.join(realpathSync(folder),'none.json')}),'recorded');
  assert.deepEqual(JSON.parse(await readFile(configFile,'utf8')),{...original,claude:{certStore:'system'}});
  // A settings file that is not JSON, and one with no env block, record nothing.
  await writeFile(configFile,JSON.stringify(original));
  const broken=path.join(realpathSync(folder),'broken.json');
  await writeFile(broken,'synthetic, not json');
  assert.equal(await record({},{claudeSettings:broken}),'none');
  await writeFile(broken,JSON.stringify({statusLine:{command:'synthetic'}}));
  assert.equal(await record({},{claudeSettings:broken}),'none');
  assert.deepEqual(JSON.parse(await readFile(configFile,'utf8')),original);
  assert.equal(await readFile(claudeSettings,'utf8'),settingsText,'Claude Code\'s settings file is never changed');
  const said=printed.join('\n');
  for(const secret of [ownFile,shellFile,'own.pem','shell.pem','claude-settings.json','synthetic-value','SYNTHETIC_OTHER'])assert.ok(!said.includes(secret),said);
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
  // No Claude Code settings file here: the test never reads a real one.
  const claudeSettings=path.join(realpathSync(folder),'no-claude-settings.json');
  assert.equal(await recordCertificates(configFile,{source:{SSL_CERT_FILE:file},dryRun:true,step:log,log,claudeSettings}),'would-record');
  assert.deepEqual(JSON.parse(await readFile(configFile,'utf8')),original,'a dry run writes nothing');
  assert.equal(await recordCertificates(configFile,{source:{},step:log,log,claudeSettings}),'none');
  assert.equal(await recordCertificates(configFile,{source:{NODE_EXTRA_CA_CERTS:path.join(folder,'gone.pem')},step:log,log,claudeSettings}),'none');
  assert.deepEqual(JSON.parse(await readFile(configFile,'utf8')),original);
  assert.equal(await recordCertificates(configFile,{source:{SSL_CERT_FILE:file},step:log,log,claudeSettings}),'recorded');
  const saved=JSON.parse(await readFile(configFile,'utf8'));
  assert.deepEqual(saved,{...original,claude:{caCertificates:file}});
  assert.equal(await recordCertificates(configFile,{source:{SSL_CERT_FILE:file},step:log,log,claudeSettings}),'kept');
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
  assert.deepEqual(parseAuthStatus(status()),{loggedIn:true,subscription:true,console:false});
  // An Anthropic Console sign-in is the API key Claude Code's own login saved. Any other key or provider is not one.
  assert.deepEqual(parseAuthStatus(status({authMethod:'api_key',apiKeySource:'/login managed key'})),{loggedIn:true,subscription:false,console:true});
  assert.deepEqual(parseAuthStatus(status({authMethod:'api_key',apiKeySource:'ANTHROPIC_API_KEY'})),{loggedIn:true,subscription:false,console:false});
  assert.deepEqual(parseAuthStatus(status({authMethod:'api_key_helper',apiKeySource:'apiKeyHelper'})),{loggedIn:true,subscription:false,console:false});
  assert.deepEqual(parseAuthStatus(status({authMethod:'oauth_token'})),{loggedIn:true,subscription:false,console:false});
  assert.deepEqual(parseAuthStatus(status({authMethod:'third_party',apiProvider:'bedrock'})),{loggedIn:true,subscription:false,console:false});
  assert.deepEqual(parseAuthStatus(status({apiProvider:'bedrock'})),{loggedIn:true,subscription:false,console:false});
  assert.deepEqual(parseAuthStatus(JSON.stringify({loggedIn:false})),{loggedIn:false,subscription:false,console:false});
  for(const bad of ['not json','{}','null','[]'])assert.equal(parseAuthStatus(bad),null,bad);
});

test('each way a sign-in ends gets one plain line with its fix', () => {
  const cases=[
    [{ending:'exited',code:1,output:'Error: unable to get local issuer certificate (UNABLE_TO_GET_ISSUER_CERT_LOCALLY)'},'certificate',S.certificate],
    [{ending:'exited',code:1,output:'SELF_SIGNED_CERT_IN_CHAIN'},'certificate',S.certificate],
    [{ending:'exited',code:1,output:'CERT_HAS_EXPIRED',certificateMissing:true},'certificate',S.certificateMissing],
    [{ending:'exited',code:0,status:{loggedIn:true,subscription:false,console:true}},'console',S.console],
    // An API key or a cloud provider is not a Console account, and is not called one.
    [{ending:'exited',code:0,status:{loggedIn:true,subscription:false,console:false}},'not-subscription',S.notSubscription],
    [{ending:'not-found'},'not-found',S.notFound],
    [{ending:'timed-out',output:'Opening the browser'},'timed-out',S.timedOut],
    // Claude Code prints its paste prompt in every browser sign-in, so a timeout after it is only a timeout.
    [{ending:'timed-out',output:'Opening browser to sign in\nPaste code here if prompted > '},'timed-out',S.timedOut],
    // A terminal is named only when Claude Code says the browser cannot do it from here.
    [{ending:'timed-out',output:'Couldn\'t open your browser. Visit the address to sign in.\nPaste code here if prompted > '},'terminal',S.terminal],
    [{ending:'timed-out',output:'Failed to open browser.'},'terminal',S.terminal],
    [{ending:'timed-out',output:'The browser can\'t return the sign-in to Claude Code automatically. After you sign in, paste the code shown.'},'terminal',S.terminal],
    [{ending:'exited',code:1,output:'Input ended before a code was pasted. Sign in again and paste the code shown.'},'terminal',S.terminal],
    [{ending:'exited',code:1,output:'Raw mode is not supported on the current process.stdin'},'terminal',S.terminal],
    [{ending:'exited',code:130,output:''},'failed',S.failed],
    [{ending:'exited',code:0,status:{loggedIn:false,subscription:false}},'not-confirmed',S.failed],
    // Signed in is said only once the limits read.
    [{ending:'exited',code:0,status:{loggedIn:true,subscription:true},usage:'read'},'signed-in',S.done],
    [{ending:'exited',code:0,status:{loggedIn:true,subscription:true},usage:'signed-out'},'no-limits',S.noLimits],
    [{ending:'exited',code:0,status:{loggedIn:true,subscription:true},usage:'unrecognized'},'no-limits',S.noLimits],
    [{ending:'exited',code:0,status:{loggedIn:true,subscription:true},usage:'timed-out'},'limits-unread',S.limitsUnread],
    [{ending:'exited',code:0,status:{loggedIn:true,subscription:true}},'limits-unread',S.limitsUnread],
  ];
  for(const [input,reason,message] of cases)assert.deepEqual(classify(input),{state:['signed-in','limits-unread'].includes(reason)?'done':'failed',reason,message},JSON.stringify(input));
  assert.match(S.waiting,/browser should open.*there/i,'the waiting line says where to finish');
  assert.equal(S.waitingCode,undefined,'no line sends a normal browser sign-in to a terminal');
  assert.match(S.notSubscription,/^This sign-in is not a Claude subscription\. Sign in with: claude auth login --claudeai$/);
  assert.doesNotMatch(S.notSubscription,/Console/);
  assert.match(S.noLimits,/no Claude plan limits to read.*try again/);
  // Every line is plain: no secrets, no claude output, the fix in it.
  assert.match(S.certificate,/NODE_EXTRA_CA_CERTS.*npm run setup again/);
  assert.match(S.console,/claude auth login --claudeai/);
});

// What `/usage` prints for a plan with limits, and without one (the session cost summary).
const resetText=()=>{
  const at=new Date(Date.now()+2*3600000);
  const hour=at.getUTCHours();
  return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][at.getUTCMonth()]} ${at.getUTCDate()}, ${at.getUTCFullYear()} at ${hour%12 || 12}${hour<12?'am':'pm'} (UTC)`;
};
const envelope=result=>({is_error:false,num_turns:0,total_cost_usd:0,local_command:'usage',result});
const USAGE={limits:()=>envelope(`Current session: 12% used · resets ${resetText()}`),cost:()=>envelope('Total cost: $0.00\nTotal duration: 0s'),junk:()=>({synthetic:true})};
const USAGE_CALL=USAGE_ARGUMENTS.join(' ');

// A fake claude: `auth status` answers from state.json beside it, `auth login` acts as told by login.json, and the
// usage read prints usage.json (once signed in: usageAfter.json when there is one).
async function fakeClaude(folder,{login,status,usage='limits',usageAfter=null}) {
  const bin=path.join(realpathSync(folder),'bin');
  await mkdir(bin,{recursive:true});
  await writeFile(path.join(bin,'login.json'),JSON.stringify(login));
  await writeFile(path.join(bin,'state.json'),JSON.stringify(status));
  await writeFile(path.join(bin,'usage.json'),JSON.stringify(USAGE[usage]()));
  if(usageAfter)await writeFile(path.join(bin,'usageAfter.json'),JSON.stringify(USAGE[usageAfter]()));
  const file=path.join(bin,'claude');
  await writeFile(file,`#!${process.execPath}
const fs=require('fs'),path=require('path');
const here=__dirname,args=process.argv.slice(2).join(' ');
fs.appendFileSync(path.join(here,'calls.log'),args+' ca='+(process.env.NODE_EXTRA_CA_CERTS?'yes':'no')+' parent='+(process.env.CLAUDECODE?'yes':'no')+(process.env.CLAUDE_CODE_CERT_STORE?' store='+process.env.CLAUDE_CODE_CERT_STORE:'')+'\\n');
if(args==='auth status --json'){process.stdout.write(fs.readFileSync(path.join(here,'state.json'),'utf8'));process.exit(0);}
if(args===${JSON.stringify(USAGE_CALL)}){
  const after=path.join(here,'usageAfter.json');
  process.stdout.write(fs.readFileSync(fs.existsSync(path.join(here,'loggedin'))&&fs.existsSync(after)?after:path.join(here,'usage.json'),'utf8'));process.exit(0);
}
if(args==='auth login --claudeai'){
  const plan=JSON.parse(fs.readFileSync(path.join(here,'login.json'),'utf8'));
  if(plan.print)process.stderr.write(plan.print);
  if(plan.hang){
    // What a real sign-in leaves running while it waits: claude and a process claude started.
    const helper=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    fs.writeFileSync(path.join(here,'pids.json'),JSON.stringify([process.pid,helper.pid]));
    setInterval(()=>{},1000);return;
  }
  fs.writeFileSync(path.join(here,'loggedin'),'');
  if(plan.after)fs.writeFileSync(path.join(here,'state.json'),JSON.stringify(plan.after));
  process.exit(plan.code??0);
}
process.exit(2);
`);
  await chmod(file,0o700);
  return {file,bin,calls:async()=>(await readFile(path.join(bin,'calls.log'),'utf8')).trim().split('\n')};
}

const subscription={loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',email:'synthetic@example.invalid',orgId:'synthetic-org'};

async function runSignIn(folder,fake,{source={PATH:'/usr/bin:/bin'},config={},loginTimeoutMs=10000,refresh=null,refreshLimitMs=10000}={}) {
  const data=path.join(realpathSync(folder),'data');
  await mkdir(data,{recursive:true,mode:0o700});
  const refreshed=[];
  const result=await signIn({...testConfig(data),...config},{source:{...source,CLAUDECODE:'1'},find:async()=>fake?.file ?? null,
    refresh:async config=>{refreshed.push(config.dataFolder);await refresh?.();},loginTimeoutMs,refreshLimitMs});
  const text=await readFile(path.join(data,'public','local',SIGN_IN_FILE),'utf8');
  return {result,refreshed,text,status:JSON.parse(text)};
}

test('a sign-in that works is confirmed with auth status and one read of the limits, then every source is read again', {skip:!posix && 'Requires POSIX executable scripts'}, () => withFolder(async folder => {
  const ca=await bundle(folder);
  const fake=await fakeClaude(folder,{login:{after:subscription},status:{loggedIn:false}});
  const {result,refreshed,text,status}=await runSignIn(folder,fake,{config:{claude:{caCertificates:ca,certStore:'system'}}});
  assert.deepEqual(result,{state:'done',reason:'signed-in',message:S.done});
  assert.equal(refreshed.length,1);
  assert.deepEqual(Object.keys(status).sort(),['message','reason','schema','state','updatedAt']);
  assert.equal(status.state,'done');
  assert.equal(status.message,S.done);
  assert.doesNotMatch(text,/synthetic|example\.invalid|\.pem/,'no account details or paths');
  // Status first, then the login, then the confirmation and the limits read. Each got the recorded certificate file
  // and certificate store, and no parent variables.
  const got=' ca=yes parent=no store=system';
  assert.deepEqual(await fake.calls(),[`auth status --json${got}`,`${LOGIN_ARGUMENTS.join(' ')}${got}`,`auth status --json${got}`,`${USAGE_CALL}${got}`]);
}));

test('signed in is not said until the limits read', {skip:!posix && 'Requires POSIX executable scripts'}, () => withFolder(async folder => {
  // The login works and auth status reads a subscription, but the usage read prints no plan limits.
  for(const [index,usage] of ['cost','junk'].entries()) {
    const sub=path.join(folder,`none-${index}`);
    await mkdir(sub);
    const fake=await fakeClaude(sub,{login:{after:subscription},status:{loggedIn:false},usage});
    const {result,refreshed,status}=await runSignIn(sub,fake);
    assert.deepEqual(result,{state:'failed',reason:'no-limits',message:S.noLimits},usage);
    assert.equal(status.message,S.noLimits);
    assert.equal(refreshed.length,0);
  }
  // Auth status already reads a subscription, yet the limits do not read: the login runs, and then they do.
  const stuck=path.join(folder,'stuck');
  await mkdir(stuck);
  const fake=await fakeClaude(stuck,{login:{after:subscription},status:subscription,usage:'cost',usageAfter:'limits'});
  const {result,refreshed}=await runSignIn(stuck,fake);
  assert.deepEqual(result,{state:'done',reason:'signed-in',message:S.done});
  assert.equal(refreshed.length,1);
  assert.deepEqual((await fake.calls()).map(line=>line.replace(/ ca=.*$/,'')),['auth status --json',USAGE_CALL,LOGIN_ARGUMENTS.join(' '),'auth status --json',USAGE_CALL]);
}));

test('the refresh after a sign-in has a limit, and the lock outlasts the longest run', {skip:!posix && 'Requires POSIX executable scripts'}, () => withFolder(async folder => {
  const fake=await fakeClaude(folder,{login:{code:9},status:subscription});
  const started=Date.now();
  // A refresh that never ends.
  const {result,status}=await runSignIn(folder,fake,{refresh:()=>new Promise(()=>{}),refreshLimitMs:300});
  assert.deepEqual(result,{state:'done',reason:'limits-unread',message:S.limitsUnread});
  assert.equal(status.state,'done','the panel leaves Signing in');
  assert.ok(Date.now()-started<8000);
  // The refresh may wait for a tick already running and then run one to its deadline.
  assert.ok(REFRESH_LIMIT_MS>=REFRESH_WAIT_MS+TICK_DEADLINE_MS);
  assert.ok(runLimitMs()>LOGIN_TIMEOUT_MS+REFRESH_LIMIT_MS);
  // The lock is given up as stale only after the whole run's limit.
  const source=readFileSync(new URL('../scripts/claude-sign-in.mjs',import.meta.url),'utf8');
  assert.match(source,/staleMs:runLimitMs\(\{loginTimeoutMs,refreshLimitMs\}\)\+60000/);
  assert.match(source,/deadlineMs:runLimitMs\(options\)/);
}));

const gone=pid=>{try {process.kill(pid,0);return false;}catch(error) {return error.code==='ESRCH';}};

test('stopping the sign-in script stops claude and what claude started', {skip:!posix && 'Requires POSIX signals'}, () => withFolder(async folder => {
  for(const signal of ['SIGTERM','SIGINT']) {
    const sub=path.join(folder,signal);
    await mkdir(sub);
    const fake=await fakeClaude(sub,{login:{hang:true,print:'Paste code here if prompted > '},status:{loggedIn:false}});
    const data=path.join(realpathSync(sub),'data');
    await mkdir(data,{recursive:true,mode:0o700});
    // The script's own entry (runSignIn) with the fake claude: the real one is never looked for.
    const driver=path.join(realpathSync(sub),'driver.mjs');
    await writeFile(driver,`import {runSignIn} from ${JSON.stringify(new URL('../scripts/claude-sign-in.mjs',import.meta.url).href)};
const [data,claude,refresh]=process.argv.slice(2);
const result=await runSignIn({dataFolder:data,claude:{caCertificates:null,certStore:null}},{source:{PATH:'/usr/bin:/bin'},find:async()=>claude,
  refresh:async()=>{if(refresh==='hang') {setInterval(()=>{},1000);await new Promise(()=>{});}}});
console.log(result.reason);
`);
    if(signal==='SIGTERM') {
      // Stopped during the refresh after a sign-in that worked: the last line says signed in.
      const signed=path.join(sub,'signed');
      await mkdir(signed);
      const ready=await fakeClaude(signed,{login:{code:9},status:subscription});
      const folder=path.join(realpathSync(signed),'data');
      await mkdir(folder,{recursive:true,mode:0o700});
      const file=path.join(folder,'public','local',SIGN_IN_FILE);
      const running=spawn(process.execPath,[driver,folder,ready.file,'hang'],{stdio:'ignore'});
      const ended=new Promise(resolve=>running.once('close',(code,by)=>resolve({code,by})));
      try {
        let line=null;
        for(const until=Date.now()+15000;Date.now()<until && line?.message!==S.refreshing;await new Promise(resolve=>setTimeout(resolve,25))) {
          try {line=JSON.parse(await readFile(file,'utf8'));}catch {}
        }
        assert.equal(line?.message,S.refreshing);
        running.kill(signal);
        assert.deepEqual(await ended,{code:0,by:null});
        const last=JSON.parse(await readFile(file,'utf8'));
        assert.deepEqual([last.state,last.message],['done',S.limitsUnread]);
        assert.deepEqual((await readdir(path.dirname(file))).filter(name=>name.endsWith('.tmp')),[],'no temporary file is left');
      } finally {running.kill('SIGKILL');}
    }
    const child=spawn(process.execPath,[driver,data,fake.file],{stdio:'ignore'});
    const exited=new Promise(resolve=>child.once('close',(code,by)=>resolve({code,by})));
    try {
      let pids=null;
      for(const until=Date.now()+15000;Date.now()<until && !pids;await new Promise(resolve=>setTimeout(resolve,25))) {
        try {pids=JSON.parse(await readFile(path.join(fake.bin,'pids.json'),'utf8'));}catch {}
      }
      assert.ok(Array.isArray(pids) && pids.length===2,'the fake login is waiting');
      assert.ok(pids.every(pid=>!gone(pid)));
      child.kill(signal);
      assert.deepEqual(await exited,{code:0,by:null},signal);
      for(const until=Date.now()+5000;Date.now()<until && !pids.every(gone);await new Promise(resolve=>setTimeout(resolve,25)));
      assert.deepEqual(pids.map(gone),[true,true],`${signal}: claude and its helper are gone`);
      const status=JSON.parse(await readFile(path.join(data,'public','local',SIGN_IN_FILE),'utf8'));
      assert.equal(status.state,'failed');
      assert.equal(status.message,S.failed);
    } finally {
      child.kill('SIGKILL');
      try {for(const pid of JSON.parse(await readFile(path.join(fake.bin,'pids.json'),'utf8')))try {process.kill(pid,'SIGKILL');}catch {}}catch {}
    }
  }
}));

test('already signed in with a subscription: no login, only a refresh', {skip:!posix && 'Requires POSIX executable scripts'}, () => withFolder(async folder => {
  const fake=await fakeClaude(folder,{login:{code:9},status:subscription});
  const {result,refreshed}=await runSignIn(folder,fake);
  assert.deepEqual(result,{state:'done',reason:'signed-in',message:S.done});
  assert.equal(refreshed.length,1);
  assert.deepEqual(await fake.calls(),['auth status --json ca=no parent=no',`${USAGE_CALL} ca=no parent=no`]);
}));

test('failed sign-ins write the plain line and do not refresh', {skip:!posix && 'Requires POSIX executable scripts'}, () => withFolder(async folder => {
  const cases=[
    [{login:{print:'Token exchange failed: unable to get local issuer certificate',code:1},status:{loggedIn:false}},S.certificate],
    [{login:{after:{loggedIn:true,authMethod:'api_key',apiKeySource:'/login managed key',apiProvider:'firstParty'}},status:{loggedIn:false}},S.console],
    [{login:{after:{loggedIn:true,authMethod:'api_key',apiKeySource:'ANTHROPIC_API_KEY',apiProvider:'firstParty'}},status:{loggedIn:false}},S.notSubscription],
    [{login:{after:{loggedIn:true,authMethod:'third_party',apiProvider:'bedrock'}},status:{loggedIn:false}},S.notSubscription],
    [{login:{hang:true,print:'Opening browser'},status:{loggedIn:false}},S.timedOut],
    // The paste prompt of every browser sign-in: a timeout, not "needs a terminal".
    [{login:{hang:true,print:'Paste code here if prompted >'},status:{loggedIn:false}},S.timedOut],
    [{login:{hang:true,print:'Couldn\'t open your browser. Visit the address shown.\nPaste code here if prompted >'},status:{loggedIn:false}},S.terminal],
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
    assert.doesNotMatch(text,/Token exchange|Paste code|Opening browser|Visit the address/,'none of claude\'s own output');
    // A login that timed out is stopped, with the helper it started.
    try {for(const pid of JSON.parse(await readFile(path.join(fake.bin,'pids.json'),'utf8')))try {process.kill(pid,'SIGKILL');}catch {}}catch {}
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
  try {for(const pid of JSON.parse(await readFile(path.join(fake.bin,'pids.json'),'utf8')))try {process.kill(pid,'SIGKILL');}catch {}}catch {}
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
  assert.match(text(await run({status:async()=>({loggedIn:true,subscription:false,console:true})})),/Anthropic Console account.*\n\s+Sign in with your Claude subscription: claude auth login --claudeai/);
  const other=text(await run({status:async()=>({loggedIn:true,subscription:false,console:false})}));
  assert.match(other,/fix\s+Claude Code is signed in, but not with a Claude subscription.*\n\s+Sign in with: claude auth login --claudeai/);
  assert.doesNotMatch(other,/Console/);
  assert.match(text(await run({probe:async()=>'certificate'})),/cannot trust this network's certificate.*\n\s+.*NODE_EXTRA_CA_CERTS/);
  assert.match(text(await run({probe:async()=>'unreachable'})),/note\s+Anthropic could not be reached/);
  assert.match(text(await run({config:null,configError:'synthetic'})),/fix\s+Settings could not be read: synthetic/);
  assert.match(text(await run({config:{...config,sources:{claudeLimits:false}}})),/Claude limits are off/);
  await withFolder(async folder => {
    const file=await bundle(folder);
    let given=null;
    // The real platform from here: the files are real.
    const real={platform:process.platform};
    const lines=await run({...real,source:{SSL_CERT_FILE:file},probe:async(host,extra)=>{given=extra;return 'trusted';}});
    assert.match(text(lines),/fix\s+This shell trusts an extra certificate file.*\n\s+Run npm run setup again/);
    // Worded for the computer it runs on: Linux has a collector and no menu bar or tray app.
    // The file is real, so only platforms with this computer's kind of path can find it.
    const platforms=process.platform==='win32'?[['win32',/the tray app does not know about/]]
      :[['darwin',/the menu bar app does not know about/],['linux',/Observatory's collector does not know about/]];
    for(const [platform,reader] of platforms) {
      const worded=text(await run({platform,source:{SSL_CERT_FILE:file},probe:async()=>'trusted'}));
      assert.match(worded,reader,platform);
      if(platform==='linux')assert.doesNotMatch(worded,/menu bar|tray/);
    }
    // Recorded from Claude Code's settings while the shell has only OpenSSL's variable: nothing to record again.
    const other=await bundle(folder,'other.pem');
    assert.doesNotMatch(text(await run({...real,config:{...config,claude:{caCertificates:file}},source:{SSL_CERT_FILE:other}})),/This shell trusts/);
    assert.match(text(await run({...real,config:{...config,claude:{caCertificates:file}},source:{NODE_EXTRA_CA_CERTS:other}})),/fix\s+This shell trusts/);
    // The check says nothing about the certificate store: that choice is the user's.
    assert.doesNotMatch(text(await run({...real,config:{...config,claude:{caCertificates:file,certStore:null}}})),/CERT_STORE|certificate store/i);
    assert.ok(!text(lines).includes(file),'the path is not printed');
    const recorded=await run({...real,config:{...config,claude:{caCertificates:file}},probe:async(host,extra)=>{given=extra;return 'trusted';}});
    assert.match(text(recorded),/ok\s+Claude Code gets the certificate file recorded by setup/);
    assert.equal(given,PEM,'the probe trusts what claude would');
    assert.match(text(await run({...real,config:{...config,claude:{caCertificates:path.join(folder,'gone.pem')}}})),/fix\s+The certificate file recorded by setup is missing/);
  });
});

test('the check probes with the certificates Claude Code starts from, and never fails over ones it cannot read', async () => {
  const bundled=['BUNDLED'];
  assert.deepEqual(storeRoots(null,{system:()=>['SYSTEM'],bundled}),{roots:['BUNDLED'],complete:true});
  assert.deepEqual(storeRoots('bundled',{system:()=>null,bundled}),{roots:['BUNDLED'],complete:true});
  assert.deepEqual(storeRoots('system',{system:()=>['SYSTEM'],bundled}),{roots:['SYSTEM'],complete:true});
  assert.deepEqual(storeRoots('bundled,system',{system:()=>['SYSTEM'],bundled}),{roots:['BUNDLED','SYSTEM'],complete:true});
  // A Node that cannot read the system's certificates: probe with what there is, and say the list is not whole.
  assert.deepEqual(storeRoots('system',{system:()=>null,bundled}),{roots:['BUNDLED'],complete:false});
  assert.equal(systemRoots(null),null,'an older Node has no such read');
  assert.equal(systemRoots(()=>{throw Error('synthetic');}),null);
  assert.deepEqual(systemRoots(kind=>[kind]),['system']);
  const config={...testConfig('/synthetic/data'),claude:{caCertificates:null,certStore:'system'}};
  const run=overrides=>doctor({config,source:{},platform:'darwin',find:async()=>'/synthetic/claude',status:async()=>({loggedIn:true,subscription:true}),
    readCa:async()=>PEM,...overrides});
  let given=null;
  const failing=async(host,extra,roots)=>{given=roots;return 'certificate';};
  // The system's certificates are in the probe when this Node reads them, and a failure then is a real one.
  const real=await run({system:()=>['SYSTEM'],probe:failing});
  assert.deepEqual(given,['SYSTEM']);
  assert.match(describe(real),/fix\s+Claude Code cannot trust this network's certificate/);
  // When it cannot read them, a certificate it could not check is a note: nothing to fix, nothing failing.
  const unread=await run({system:()=>null,probe:failing});
  assert.match(describe(unread),/note\s+The certificate check was skipped: Claude Code uses the system's certificates here/);
  assert.ok(unread.every(line=>line.ok!==false),describe(unread));
  // This process's own store wins over the recorded one, as it does for claude.
  await run({source:{CLAUDE_CODE_CERT_STORE:'bundled'},system:()=>['SYSTEM'],probe:failing});
  assert.equal(given.includes('SYSTEM'),false);
  assert.ok(given.length>10,'Node\'s own certificates');
  // What the check finds is advice: setup prints it and goes on, whatever it found.
  const setup=readFileSync(new URL('../scripts/setup.mjs',import.meta.url),'utf8');
  const calls=setup.match(/^.*runDoctor\(.*$/gm);
  assert.equal(calls.length,2);
  for(const call of calls)assert.match(call,/^\s*try \{await runDoctor\(\{log,configFile\}\);\}catch \{\}$/);
});

test('the TLS probe tells a certificate failure from no network', async () => {
  const fake=outcome=>(options,ready)=>{
    const socket=new EventEmitter();socket.destroy=()=>{};
    setImmediate(()=>outcome==='ok'?ready():socket.emit('error',Object.assign(Error('synthetic'),{code:outcome})));
    return socket;
  };
  assert.equal(await probeTls('example.invalid',{connect:fake('ok')}),'trusted');
  let options=null;
  await probeTls('example.invalid',{roots:['SYSTEM'],extra:PEM,connect:(given,ready)=>{options=given;return fake('ok')(given,ready);}});
  assert.deepEqual(options.ca,['SYSTEM',PEM]);
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
