import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {createInvitation,invitationLifetimeMs} from './peer-invitation.mjs';

const hex256=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const digest=value=>createHash('sha256').update(value,'ascii').digest();
const refused=()=>{throw Error('Pairing invitation is unavailable');};

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
