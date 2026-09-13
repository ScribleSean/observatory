import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {createInvitation,invitationLifetimeMs} from './peer-invitation.mjs';

const hex256=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const digest=value=>createHash('sha256').update(value,'ascii').digest();
const refused=()=>{throw Error('Pairing invitation is unavailable');};

// One instance belongs to one setup listener in one process. It is deliberately
// not serialized. A listener restart must require a newly displayed invitation.
// No method writes trust, pairing configuration or sharing consent.
export class InvitationSession {
  #state=null;
  #wall;
  #monotonic;

  constructor({wall=Date.now,monotonic=()=>performance.now()}={}) {
    this.#wall=wall;
    this.#monotonic=monotonic;
  }

  #live() {
    const state=this.#state;
    if(!state)return null;
    const now=this.#wall(),tick=this.#monotonic();
    if(!Number.isSafeInteger(now) || !Number.isFinite(tick) ||
      now<state.createdAt || now>=state.expiresAt || tick<state.started ||
      tick-state.started>=invitationLifetimeMs) {
      this.cancel();
      return null;
    }
    return state;
  }

  issue(options) {
    // Even a failed replacement invalidates the previous invitation.
    this.cancel();
    const now=this.#wall(),started=this.#monotonic();
    if(!Number.isFinite(started))refused();
    const invitation=createInvitation(options,now);
    this.#state={phase:'waiting',createdAt:invitation.createdAt,
      expiresAt:invitation.expiresAt,started,secretHash:digest(invitation.secret)};
    return invitation;
  }

  status() {
    return this.#live()?.phase??'inactive';
  }

  // The transport must obtain peerCertificateSha256 from the actual TLS peer
  // certificate with proof of private-key possession, never from request JSON.
  // This synchronous transition occurs before any async UI or storage work.
  claim(secret,peerCertificateSha256) {
    const state=this.#live();
    if(!state || state.phase!=='waiting' || !hex256(secret) ||
      !hex256(peerCertificateSha256) || !timingSafeEqual(state.secretHash,digest(secret)))refused();
    state.secretHash.fill(0);
    const claimId=randomBytes(32).toString('hex');
    this.#state={phase:'confirming',createdAt:state.createdAt,expiresAt:state.expiresAt,
      started:state.started,claimHash:digest(claimId),peerCertificateSha256};
    return {claimId,peerCertificateSha256};
  }

  // Only an explicit local confirmation handler may call this. The returned
  // identity still needs an atomic trust commit using the existing peer lock.
  confirm(claimId) {
    const state=this.#live();
    if(!state || state.phase!=='confirming' || !hex256(claimId) ||
      !timingSafeEqual(state.claimHash,digest(claimId)))refused();
    const peerCertificateSha256=state.peerCertificateSha256;
    this.cancel();
    return {peerCertificateSha256};
  }

  cancel() {
    this.#state?.secretHash?.fill(0);
    this.#state?.claimHash?.fill(0);
    this.#state=null;
  }
}
