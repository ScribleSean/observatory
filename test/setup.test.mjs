import test from 'node:test';
import assert from 'node:assert/strict';
import {nodeSupported,paths,launchAgent,infoPlist,glanceSettings,LABEL} from '../scripts/setup.mjs';

test('Node 22.13 or later is required',()=>{
  assert.equal(nodeSupported('22.13.0'),true);
  assert.equal(nodeSupported('24.1.0'),true);
  assert.equal(nodeSupported('22.12.9'),false);
  assert.equal(nodeSupported('20.18.0'),false);
});

test('the glance app is built inside the clone, not in Applications',()=>{
  const mac=paths('darwin','/Users/a/Developer/observatory','/Users/a');
  assert.equal(mac.app,'/Users/a/Developer/observatory/build/Observatory.app');
  assert.equal(mac.launchAgent,`/Users/a/Library/LaunchAgents/${LABEL}.plist`);
  const win=paths('win32','C:\\src\\observatory','C:\\Users\\a',{WINDIR:'C:\\Windows'});
  assert.equal(win.executable,'C:\\src\\observatory\\build\\windows\\ObservatoryGlance.exe');
  assert.equal(win.compiler,'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe');
});

test('the login item starts the app and escapes its path',()=>{
  const plist=launchAgent('/Users/a & b/build/Observatory.app/Contents/MacOS/ObservatoryGlance');
  assert.match(plist,/<string>\/Users\/a &amp; b\/build/);
  assert.match(plist,/<key>RunAtLoad<\/key><true\/>/);
  assert.match(infoPlist(),/<key>LSUIElement<\/key><true\/>/);
});

test('the app settings hold paths only, no source data',()=>{
  const settings=glanceSettings({dataFolder:'/d',dashboard:{port:5601}},'/n/node','/r','/r/observatory.config.json');
  assert.deepEqual(settings,{node:'/n/node',repo:'/r',config:'/r/observatory.config.json',dataFolder:'/d',port:5601});
});
