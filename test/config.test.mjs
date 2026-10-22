import test from 'node:test';
import assert from 'node:assert/strict';
import {parseConfig} from '../lib/config.mjs';

const mac={platform:'darwin',environment:{}};
const win={platform:'win32',environment:{LOCALAPPDATA:'C:\\Users\\a\\AppData\\Local'}};

test('sources are off unless listed as true',()=>{
  const config=parseConfig({sources:{codex:true}},mac);
  assert.deepEqual(config.sources,{screenTime:false,codex:true,codexLimits:false,claudeCode:false,claudeLimits:false});
  assert.equal(config.role,'spoke');
  assert.equal(config.host,'Mac');
  assert.match(config.dataFolder,/Library\/Application Support\/Observatory$/);
});

test('a hub lists spokes by SSH alias',()=>{
  const config=parseConfig({hub:{spokes:[{name:'PC',ssh:'my-pc',platform:'windows'}]}},mac);
  assert.equal(config.role,'hub');
  assert.deepEqual(config.hub.spokes,[{name:'PC',ssh:'my-pc',platform:'windows',dataFolder:null}]);
});

test('Windows uses LOCALAPPDATA for its data folder',()=>{
  assert.equal(parseConfig({},win).dataFolder,'C:\\Users\\a\\AppData\\Local\\Observatory');
  assert.equal(parseConfig({},win).host,'Windows');
});

test('mistakes in the settings file are refused with a clear message',()=>{
  assert.throws(()=>parseConfig({source:{}},mac),/unknown setting source/);
  assert.throws(()=>parseConfig({sources:{codex:'yes'}},mac),/sources.codex must be true or false/);
  assert.throws(()=>parseConfig({hub:{spokes:[{ssh:'bad alias',platform:'windows'}]}},mac),/SSH host alias/);
  assert.throws(()=>parseConfig({hub:{spokes:[{ssh:'pc',platform:'linux'}]}},mac),/platform/);
  assert.throws(()=>parseConfig({hub:{spokes:[{ssh:'other-mac',platform:'mac'}]}},mac),/at most one Mac/);
  assert.throws(()=>parseConfig({hub:{spokes:[{ssh:'pc',platform:'windows',dataFolder:"C:\\x'; rm"}]}},mac),/dataFolder/);
  assert.throws(()=>parseConfig({dashboard:{port:80}},mac),/port/);
  assert.throws(()=>parseConfig({},{platform:'linux',environment:{}}),/macOS and Windows/);
});

test('an older settings file that still lists agents loads, and the key is ignored',()=>{
  const config=parseConfig({sources:{codex:true,agents:true}},mac);
  assert.equal('agents' in config.sources,false);
  assert.throws(()=>parseConfig({sources:{agentz:true}},mac),/unknown setting agentz/);
});
