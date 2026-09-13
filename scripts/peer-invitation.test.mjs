import test from 'node:test';
import assert from 'node:assert/strict';
import {createInvitation,encodeInvitation,decodeInvitation,validateInvitation,
  isPairingAddress,invitationLifetimeMs} from './peer-invitation.mjs';

const now=1_800_000_000_000;
const options={address:'192.168.1.2',port:43127,certificateSha256:'ab'.repeat(32)};
const raw=json=>'observatory-pair:v1:'+Buffer.from(json).toString('base64url');

test('invitation round trips with independent cryptographic bearer secrets',()=>{
  const first=createInvitation(options,now),second=createInvitation(options,now);
  assert.match(first.secret,/^[a-f0-9]{64}$/);
  assert.notEqual(first.secret,second.secret);
  assert.deepEqual(decodeInvitation(encodeInvitation(first,now),now),first);
  assert.equal(first.expiresAt,now+invitationLifetimeMs);
});

test('only numeric private LAN and VPN addresses are accepted',()=>{
  for(const address of ['10.0.0.1','172.16.0.1','172.31.255.254','192.168.1.2',
    '100.64.0.1','100.127.255.254','fd7a:115c:a1e0::1','fc00::1'])
    assert.equal(isPairingAddress(address),true,address);
  for(const address of ['127.0.0.1','0.0.0.0','8.8.8.8','172.32.0.1','100.63.0.1',
    '100.128.0.1','169.254.1.2','::1','::','fe80::1%en0','::ffff:192.168.1.2',
    '2001:db8::1','localhost','peer.local','192.168.1.2/path','192.168.01.2',null])
    assert.equal(isPairingAddress(address),false,String(address));
});

test('future, expired and extended invitations fail closed',()=>{
  const value=createInvitation(options,now);
  assert.deepEqual(validateInvitation(value,now+invitationLifetimeMs-1),value);
  for(const time of [now-1,now+invitationLifetimeMs,NaN,Infinity,now+0.5])
    assert.throws(()=>validateInvitation(value,time));
  assert.throws(()=>validateInvitation({...value,expiresAt:value.expiresAt+1},now));
});

test('strict schema rejects malformed identity, port and unknown fields',()=>{
  const value=createInvitation(options,now);
  for(const change of [{version:true},{secret:'123456'},{certificateSha256:'ab'},
    {port:443},{port:65536},{port:1234.5},{port:'43127'},{address:'example.com'},
    {extra:'ignored'},{createdAt:-1},{expiresAt:Infinity}])
    assert.throws(()=>validateInvitation({...value,...change},now));
  for(const key of Object.keys(value)) {
    const missing={...value};delete missing[key];
    assert.throws(()=>validateInvitation(missing,now));
  }
});

test('decoder rejects duplicate keys, oversized and noncanonical encodings without echoing secrets',()=>{
  const value=createInvitation(options,now),json=JSON.stringify(value),encoded=encodeInvitation(value,now);
  for(const text of [null,'x'.repeat(3000),encoded+'=',encoded+'\n',
    raw(json.replace('"version":1','"version":1,"version":1')),
    raw(' '+json),raw('{'),raw('[]'),raw(JSON.stringify({...value,secret:'private-secret'}))]) {
    assert.throws(()=>decodeInvitation(text,now),{message:'Invalid or expired pairing invitation'});
  }
});
