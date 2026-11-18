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
  assert.deepEqual(config.hub.spokes,[{name:'PC',ssh:'my-pc',platform:'windows',dataFolder:null,off:false}]);
});

test('Windows uses LOCALAPPDATA for its data folder',()=>{
  assert.equal(parseConfig({},win).dataFolder,'C:\\Users\\a\\AppData\\Local\\Observatory');
  assert.equal(parseConfig({},win).host,'Windows');
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
  assert.deepEqual(parseConfig({hub:{spokes:[spoke]}},mac).hub.spokes,[{...spoke,dataFolder:null,off:false}]);
  assert.deepEqual(parseConfig({hub:{spokes:[spoke]}},win).hub.spokes,[{...spoke,dataFolder:null,off:false}]);
  assert.equal(parseConfig({hub:{spokes:[{ssh:'lx',platform:'linux'}]}},mac).hub.spokes[0].name,'Linux');
  assert.throws(()=>parseConfig({hub:{spokes:[spoke,{...spoke,ssh:'other'}]}},mac),/at most one/);
  assert.throws(()=>parseConfig({hub:{spokes:[{ssh:'lx',platform:'linux'}]}},linux),/at most one/);
  assert.throws(()=>parseConfig({hub:{spokes:[{ssh:'lx',platform:'linux',dataFolder:'relative'}]}},mac),/dataFolder/);
});
