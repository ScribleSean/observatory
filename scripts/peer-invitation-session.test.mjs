import test from 'node:test';
import assert from 'node:assert/strict';
import {InvitationSession} from './peer-invitation-session.mjs';
import {invitationLifetimeMs} from './peer-invitation.mjs';

const options={address:'10.0.0.2',port:43127,certificateSha256:'ab'.repeat(32)};
const peer='cd'.repeat(32);
function fixture() {
  let wall=1_800_000_000_000,tick=100;
  const session=new InvitationSession({wall:()=>wall,monotonic:()=>tick});
  return {session,clock:(w,t)=>{wall=w;tick=t;},wall,tick};
}
const unavailable=action=>assert.throws(action,{message:'Pairing invitation is unavailable'});

test('single-use claim and explicit confirmation bind the peer identity',()=>{
  const {session}=fixture();
  assert.equal(session.status(),'inactive');
  const invitation=session.issue(options);
  assert.equal(session.status(),'waiting');
  const claim=session.claim(invitation.secret,peer);
  assert.equal(session.status(),'confirming');
  unavailable(()=>session.claim(invitation.secret,peer));
  unavailable(()=>session.confirm('00'.repeat(32)));
  assert.deepEqual(session.confirm(claim.claimId),{peerCertificateSha256:peer});
  assert.equal(session.status(),'inactive');
  unavailable(()=>session.confirm(claim.claimId));
});

test('concurrent claims have exactly one winner before asynchronous confirmation',async()=>{
  const {session}=fixture(),invitation=session.issue(options);
  const results=await Promise.allSettled(Array.from({length:20},()=>
    Promise.resolve().then(()=>session.claim(invitation.secret,peer))));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected').length,19);
});

test('bad secrets and malformed peer identities do not consume a valid invitation',()=>{
  const {session}=fixture(),invitation=session.issue(options);
  for(const secret of ['',null,'123456','00'.repeat(32)])
    unavailable(()=>session.claim(secret,peer));
  unavailable(()=>session.claim(invitation.secret,'untrusted-device-name'));
  assert.equal(session.status(),'waiting');
  assert.equal(session.claim(invitation.secret,peer).peerCertificateSha256,peer);
});

test('cancellation and restart invalidate invitations and pending confirmations',()=>{
  const {session}=fixture(),invitation=session.issue(options);
  session.cancel();
  unavailable(()=>session.claim(invitation.secret,peer));
  const next=session.issue(options),claim=session.claim(next.secret,peer);
  session.cancel();
  unavailable(()=>session.confirm(claim.claimId));
  unavailable(()=>new InvitationSession().claim(next.secret,peer));
});

test('replacement fences old secrets and confirmations, including failed replacement',()=>{
  const {session}=fixture(),old=session.issue(options);
  const current=session.issue(options);
  unavailable(()=>session.claim(old.secret,peer));
  const claim=session.claim(current.secret,peer);
  session.issue(options);
  unavailable(()=>session.confirm(claim.claimId));
  assert.throws(()=>session.issue({...options,address:'8.8.8.8'}));
  assert.equal(session.status(),'inactive');
});

test('wall and monotonic expiry both invalidate pending confirmation',()=>{
  for(const change of [f=>f.clock(f.wall+invitationLifetimeMs,f.tick),
    f=>f.clock(f.wall,f.tick+invitationLifetimeMs),
    f=>f.clock(f.wall-1,f.tick),f=>f.clock(f.wall,f.tick-1),
    f=>f.clock(NaN,f.tick),f=>f.clock(f.wall,Infinity)]) {
    const f=fixture(),invitation=f.session.issue(options);
    const claim=f.session.claim(invitation.secret,peer);
    change(f);
    unavailable(()=>f.session.confirm(claim.claimId));
    assert.equal(f.session.status(),'inactive');
  }
});

test('expired waiting invitation cannot be claimed or revived by changing clocks back',()=>{
  const f=fixture(),invitation=f.session.issue(options);
  f.clock(f.wall+invitationLifetimeMs,f.tick);
  unavailable(()=>f.session.claim(invitation.secret,peer));
  f.clock(f.wall,f.tick);
  unavailable(()=>f.session.claim(invitation.secret,peer));
});

test('public serialization does not expose stored secrets or peer identity',()=>{
  const {session}=fixture(),invitation=session.issue(options);
  assert.equal(JSON.stringify(session),'{}');
  session.claim(invitation.secret,peer);
  assert.equal(JSON.stringify(session),'{}');
  assert.equal(session.status(),'confirming');
});
