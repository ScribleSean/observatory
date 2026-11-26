import test from 'node:test';
import assert from 'node:assert/strict';
import {parseConfig} from '../lib/config.mjs';

const mac={platform:'darwin',environment:{}};
const win={platform:'win32',environment:{LOCALAPPDATA:'C:\\Users\\a\\AppData\\Local'}};

test('sources are off unless listed as true',()=>{
  const config=parseConfig({sources:{codex:true}},mac);
  assert.deepEqual(config.sources,{screenTime:false,codex:true,codexLimits:false,claudeCode:false,claudeLimits:false,grokLimits:false,sessions:false,wsl:false});
  assert.equal(config.role,'spoke');
  assert.equal(config.host,'Mac');
  assert.match(config.dataFolder,/Library[\\/]Application Support[\\/]Observatory$/);
});

test('a hub lists spokes by SSH alias',()=>{
  const config=parseConfig({hub:{spokes:[{name:'PC',ssh:'my-pc',platform:'windows'}]}},mac);
  assert.equal(config.role,'hub');
  assert.deepEqual(config.hub.spokes,[{name:'PC',ssh:'my-pc',platform:'windows',dataFolder:null,off:false,offSwitch:null}]);
});

test('Windows uses LOCALAPPDATA for its data folder',()=>{
  assert.equal(parseConfig({},win).dataFolder,'C:\\Users\\a\\AppData\\Local\\Observatory');
  assert.equal(parseConfig({},win).host,'Windows');
});

test('glance.accent picks the accent menu bar icon, off by default, and nothing else is accepted under glance',()=>{
  assert.deepEqual(parseConfig({},mac).glance,{accent:false});
  assert.deepEqual(parseConfig({glance:{accent:true}},mac).glance,{accent:true});
  assert.deepEqual(parseConfig({glance:{}},mac).glance,{accent:false});
  assert.throws(()=>parseConfig({glance:{accent:'yes'}},mac),/glance.accent must be true or false/);
  assert.throws(()=>parseConfig({glance:{color:true}},mac),/unknown setting/);
});

test('mistakes in the settings file are refused with a clear message',()=>{
  assert.throws(()=>parseConfig({source:{}},mac),/unknown setting source/);
  assert.throws(()=>parseConfig({sources:{codex:'yes'}},mac),/sources.codex must be true or false/);
  assert.throws(()=>parseConfig({hub:{spokes:[{ssh:'bad alias',platform:'windows'}]}},mac),/SSH host alias/);
  assert.throws(()=>parseConfig({hub:{spokes:[{ssh:'pc',platform:'beos'}]}},mac),/platform/);
  assert.throws(()=>parseConfig({hub:{spokes:[{ssh:'other-mac',platform:'mac'}]}},mac),/at most one Mac/);
  assert.throws(()=>parseConfig({hub:{spokes:[{ssh:'pc',platform:'windows',dataFolder:"C:\\x'; rm"}]}},mac),/dataFolder/);
  assert.throws(()=>parseConfig({hub:{spokes:[{ssh:'pc',platform:'windows',off:'yes'}]}},mac),/off must be true or false/);
  assert.equal(parseConfig({hub:{spokes:[{ssh:'pc',platform:'windows',off:true}]}},mac).hub.spokes[0].off,true);
  assert.throws(()=>parseConfig({dashboard:{port:80}},mac),/port/);
  assert.throws(()=>parseConfig({},{platform:'freebsd',environment:{}}),/macOS, Windows and Linux only/);
});

test('an older settings file that still lists agents loads, and the key is ignored',()=>{
  const config=parseConfig({sources:{codex:true,agents:true}},mac);
  assert.equal('agents' in config.sources,false);
  assert.throws(()=>parseConfig({sources:{agentz:true}},mac),/unknown setting agentz/);
});

test('grok paths and engine settings are optional and checked', () => {
  const plain=parseConfig({},mac);
  assert.deepEqual(plain.grok,{appFolder:null,requestLog:null});
  assert.deepEqual(plain.engines,{claude:'auto',codex:'auto',grok:'auto'});
  const set=parseConfig({sources:{grokLimits:true},grok:{appFolder:'/data/app',requestLog:'/data/sent.jsonl'},engines:{codex:'off'}},mac);
  assert.equal(set.sources.grokLimits,true);
  assert.deepEqual(set.grok,{appFolder:'/data/app',requestLog:'/data/sent.jsonl'});
  assert.equal(set.engines.codex,'off');
  assert.throws(()=>parseConfig({grok:{appFolder:'relative'}},mac),/grok.appFolder must be an absolute path/);
  assert.throws(()=>parseConfig({grok:{other:'/x'}},mac),/unknown setting other/);
  assert.throws(()=>parseConfig({engines:{codex:'maybe'}},mac),/engines.codex must be/);
  assert.throws(()=>parseConfig({engines:{gemini:'off'}},mac),/unknown setting gemini/);
});

const linux={platform:'linux',environment:{}};

test('Linux keeps its data under XDG_DATA_HOME, or ~/.local/share without it',()=>{
  const plain=parseConfig({},linux);
  assert.equal(plain.host,'Linux');
  assert.equal(plain.platform,'linux');
  assert.equal(plain.device.name,'Linux');
  assert.match(plain.dataFolder,/\.local[\\/]share[\\/]observatory$/);
  assert.equal(parseConfig({},{platform:'linux',environment:{XDG_DATA_HOME:'/srv/share'}}).dataFolder,'/srv/share/observatory');
  assert.match(parseConfig({},{platform:'linux',environment:{XDG_DATA_HOME:'relative'}}).dataFolder,/\.local[\\/]share[\\/]observatory$/);
  assert.equal(parseConfig({dataFolder:'/data/obs'},linux).dataFolder,'/data/obs');
});

test('screen time is off on Linux unless the file turns it on, and WSL is refused',()=>{
  assert.equal(parseConfig({sources:{codex:true}},linux).sources.screenTime,false);
  assert.throws(()=>parseConfig({sources:{wsl:true}},linux),/Windows only/);
});

test('a Linux computer can be a spoke of a Mac or a Windows hub, once',()=>{
  const spoke={name:'Build box',ssh:'build-box',platform:'linux'};
  assert.deepEqual(parseConfig({hub:{spokes:[spoke]}},mac).hub.spokes,[{...spoke,dataFolder:null,off:false,offSwitch:null}]);
  assert.deepEqual(parseConfig({hub:{spokes:[spoke]}},win).hub.spokes,[{...spoke,dataFolder:null,off:false,offSwitch:null}]);
  assert.equal(parseConfig({hub:{spokes:[{ssh:'lx',platform:'linux'}]}},mac).hub.spokes[0].name,'Linux');
  assert.throws(()=>parseConfig({hub:{spokes:[spoke,{...spoke,ssh:'other'}]}},mac),/at most one/);
  assert.throws(()=>parseConfig({hub:{spokes:[{ssh:'lx',platform:'linux'}]}},linux),/at most one/);
  assert.throws(()=>parseConfig({hub:{spokes:[{ssh:'lx',platform:'linux',dataFolder:'relative'}]}},mac),/dataFolder/);
});

test('sessions.roles maps the user\'s own title starts to a known role, and the echo holds no path',async()=>{
  const {configEcho}=await import('../lib/config.mjs');
  const parsed=parseConfig({sessions:{roles:{' tidepool notes ':'Researcher',chief:'Chief of staff'}},dataFolder:'/fictional/data',codexPath:'/fictional/bin/codex',
    grok:{requestLog:'/fictional/grok.jsonl'},hub:{spokes:[{ssh:'tower',platform:'windows',dataFolder:'C:/fictional'}]}},{platform:'darwin'});
  assert.deepEqual(parsed.sessions.roles,{'tidepool notes':'Researcher',chief:'Chief of staff'});
  assert.deepEqual(parseConfig({},{platform:'darwin'}).sessions.roles,{});
  assert.throws(()=>parseConfig({sessions:{roles:{notes:'Wizard'}}},{platform:'darwin'}),/must be one of/);
  assert.throws(()=>parseConfig({sessions:{roles:['Builder']}},{platform:'darwin'}),/sessions.roles/);
  assert.throws(()=>parseConfig({sessions:{roles:{'':'Builder'}}},{platform:'darwin'}),/title start/);
  assert.throws(()=>parseConfig({sessions:{roles:Object.fromEntries(Array.from({length:101},(_,index)=>[`start ${index}`,'Builder']))}},{platform:'darwin'}),/at most/);
  const echo=configEcho(parsed,'2026-11-18T15:00:00.000Z');
  assert.deepEqual(Object.keys(echo).sort(),['checkedAt','engines','host','name','role','roleAliases','sources','titles']);
  assert.equal(echo.role,'hub');
  assert.deepEqual(echo.roleAliases,parsed.sessions.roles);
  const text=JSON.stringify(echo);
  for(const secret of ['/fictional','tower','C:/','codex.exe','grok.jsonl'])assert.ok(!text.includes(secret),secret);
});

test('the example settings file parses',async()=>{
  const {readFile}=await import('node:fs/promises');
  const example=JSON.parse(await readFile(new URL('../observatory.config.example.json',import.meta.url),'utf8'));
  assert.deepEqual(parseConfig(example,{platform:'darwin'}).sessions,{titles:true,roles:{}});
});

test('the off switch, self-check tickets and archive take absolute paths and are off when unset',()=>{
  const plain=parseConfig({},mac);
  assert.deepEqual([plain.selfCheck.tickets,plain.archive.folder],[null,null],'nothing private is on by default');
  const config=parseConfig({hub:{spokes:[{ssh:'pc',platform:'windows',offSwitch:'/state/pc.json'}]},
    selfCheck:{tickets:{file:'/queue/QUEUE.md',lock:'/bin/lock',engine:'Runner',commit:true}},archive:{folder:'/keep/observatory'}},mac);
  assert.equal(config.hub.spokes[0].offSwitch,'/state/pc.json');
  assert.deepEqual(config.selfCheck.tickets,{file:'/queue/QUEUE.md',lock:'/bin/lock',engine:'Runner',commit:true});
  assert.equal(parseConfig({selfCheck:{tickets:{file:'/q.md'}}},mac).selfCheck.tickets.engine,'agent');
  assert.equal(config.archive.folder,'/keep/observatory');
  for(const [raw,message] of [
    [{hub:{spokes:[{ssh:'pc',platform:'windows',offSwitch:'pc.json'}]}},/offSwitch must be an absolute path/],
    [{selfCheck:{tickets:{file:'QUEUE.md'}}},/tickets.file must be an absolute path/],
    [{selfCheck:{tickets:{file:'/q.md',lock:'lock'}}},/tickets.lock must be an absolute path/],
    [{selfCheck:{tickets:{file:'/q.md',commit:'yes'}}},/commit must be true or false/],
    [{selfCheck:{tickets:{file:'/q.md',engine:'a\nb'}}},/engine must be short text/],
    [{selfCheck:{other:true}},/unknown setting other/],
    [{archive:{folder:'relative'}},/archive.folder must be an absolute path/],
  ])assert.throws(()=>parseConfig(raw,mac),message);
});
