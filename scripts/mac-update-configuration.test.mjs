import test from 'node:test';
import assert from 'node:assert/strict';
import {macUpdateConfiguration,macUpdateFeed} from '../native/mac/update-configuration.mjs';

const key=Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','hex').toString('base64');

test('Mac release configuration fixes feed and disables automatic checks, installation and profile sharing',()=>{
  const config=macUpdateConfiguration(key,{hasFramework:true});
  assert.ok(config.includes(`<key>SUFeedURL</key><string>${macUpdateFeed}</string>`));
  assert.ok(config.includes(`<key>SUPublicEDKey</key><string>${key}</string>`));
  for(const flag of ['SUEnableAutomaticChecks','SUAutomaticallyUpdate','SUAllowsAutomaticUpdates','SUSendProfileInfo'])
    assert.ok(config.includes(`<key>${flag}</key><false/>`));
});

test('Mac unsigned builds omit trust and a supplied key requires the pinned framework',()=>{
  assert.doesNotMatch(macUpdateConfiguration(),/SUFeedURL|SUPublicEDKey/);
  assert.doesNotMatch(macUpdateConfiguration(undefined,{hasFramework:true}),/SUFeedURL|SUPublicEDKey/);
  assert.throws(()=>macUpdateConfiguration(key),/requires the pinned/);
});

test('Mac release configuration rejects malformed, PEM-formatted, zero and noncanonical keys',()=>{
  for(const bad of ['',null,{},key+'\n',key+' ',key.replace(/=$/,''),Buffer.alloc(32).toString('base64'),
    Buffer.alloc(64,1).toString('base64'),'-----BEGIN PRIVATE KEY-----','<key>override</key>'])
    assert.throws(()=>macUpdateConfiguration(bad,{hasFramework:true}));
});
