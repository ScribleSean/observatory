import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {desktopReleaseVersion,parseReleaseVersion} from '../native/release-version.mjs';
const xml=(version='1.2.3',build='7')=>`<Project><Version>${version}</Version><ObservatoryBuildNumber>${build}</ObservatoryBuildNumber></Project>`;
test('release version provides consistent display, Mac build and Windows file versions',()=>{
  assert.deepEqual(parseReleaseVersion(xml()),{version:'1.2.3',buildNumber:7,fileVersion:'1.2.3.7'});
  assert.ok(desktopReleaseVersion().buildNumber>0);
});
test('invalid, duplicate and platform-incompatible versions fail before packaging',()=>{
  for(const value of [xml('1.2'),xml('01.2.3'),xml('1.2.3-preview'),xml('65535.0.0'),xml('1.2.3','0'),
    xml('1.2.3','65535'),xml('1.2.3','7.1'),xml()+xml(),'',null,'x'.repeat(4097)])
    assert.throws(()=>parseReleaseVersion(value));
});
test('desktop consumers use the same checked-in version source',()=>{
  const read=name=>readFileSync(new URL('../native/'+name,import.meta.url),'utf8');
  assert.match(read('windows/WorkspaceObservatory.csproj'),/<Import Project="\.\.\/Release.props"/);
  assert.doesNotMatch(read('windows/WorkspaceObservatory.csproj'),/<Version>/);
  assert.match(read('build.mjs'),/desktopReleaseVersion\(\)/);
  assert.match(read('windows/generate-installer.mjs'),/desktopReleaseVersion\(\)/);
});
