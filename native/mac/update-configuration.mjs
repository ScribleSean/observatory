// Release configuration is supplied at build time, never by a downloaded feed.
export const macUpdateFeed='https://scriblesean.github.io/observatory/updates/macos-arm64.xml';

export function macUpdateConfiguration(publicKey,{hasFramework=false}={}) {
  const flags=['SUEnableAutomaticChecks','SUAutomaticallyUpdate','SUAllowsAutomaticUpdates','SUSendProfileInfo']
    .map(name=>`<key>${name}</key><false/>`).join('\n');
  if(publicKey===undefined)return flags;
  if(!hasFramework)throw Error('A release update key requires the pinned Sparkle framework');
  if(typeof publicKey!=='string' || publicKey.length!==44)throw Error('Expected a canonical 32-byte Ed25519 public key');
  const bytes=Buffer.from(publicKey,'base64');
  if(bytes.length!==32 || bytes.toString('base64')!==publicKey || !bytes.some(byte=>byte!==0))
    throw Error('Expected a canonical nonzero 32-byte Ed25519 public key');
  return `${flags}\n<key>SUFeedURL</key><string>${macUpdateFeed}</string>\n<key>SUPublicEDKey</key><string>${publicKey}</string>`;
}
