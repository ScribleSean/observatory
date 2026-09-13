import test from 'node:test';
import assert from 'node:assert/strict';
import {X509Certificate} from 'node:crypto';
import {generateMacDeviceIdentity} from './generate-mac-device-identity.mjs';
import {validateDeviceIdentity} from './peer-device-identity.mjs';

test('Mac generates distinct valid P-256 identities using the system executable',
  {skip:process.platform!=='darwin'},async()=>{
    const first=await generateMacDeviceIdentity(),second=await generateMacDeviceIdentity();
    assert.deepEqual(validateDeviceIdentity(first),first);
    assert.notEqual(first.key,second.key);
    const cert=new X509Certificate(first.cert);
    assert.equal(cert.subject,'CN=Observatory device');
    assert.equal(cert.publicKey.asymmetricKeyType,'ec');
    assert.equal(cert.publicKey.asymmetricKeyDetails.namedCurve,'prime256v1');
    assert.ok(Date.parse(cert.validTo)-Date.parse(cert.validFrom)>=364*86400000);
  });
test('other platforms do not fall back to a PATH executable',
  {skip:process.platform==='darwin'},async()=>{
    await assert.rejects(generateMacDeviceIdentity(),{message:'Mac device identity generation unavailable'});
  });
