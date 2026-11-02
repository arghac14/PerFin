const {test}=require('node:test');
const assert=require('node:assert/strict');
const vault=require('../app/lock.js');
const nodeCrypto=require('node:crypto');

test('PIN accepts exactly six numeric digits, including leading zeroes',()=>{
  assert.equal(vault.validPin('012345'),true);
  for(const pin of ['12345','1234567','abcdef','123 45',123456,''])assert.equal(vault.validPin(pin),false);
});
test('fixed configured PIN is verified without needing setup or plaintext in the public configuration',async()=>{
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const config={salt:vault.encode(salt),iterations:vault.iterations,verifier:nodeCrypto.pbkdf2Sync('012345',salt,vault.iterations,32,'sha256').toString('base64')};
  assert.equal(await vault.verifyPin('012345',config),true);
  assert.equal(await vault.verifyPin('012346',config),false);
  assert.ok(!JSON.stringify(config).includes('012345'));
});
test('device cache encrypts financial data and rejects an incorrect PIN',async()=>{
  const salt=vault.encode(crypto.getRandomValues(new Uint8Array(16)));
  const key=await vault.derive('012345',salt);
  const data={format:'perfin-vault-v1',saved:{bank:184923,transactions:[{note:'private note'}]},accessKey:'private-bridge-key'};
  const encrypted=await vault.seal(key,data);
  assert.ok(!JSON.stringify(encrypted).includes('private note'));
  assert.ok(!JSON.stringify(encrypted).includes('private-bridge-key'));
  assert.deepEqual(await vault.unseal(key,encrypted),data);
  const wrong=await vault.derive('012346',salt);
  await assert.rejects(()=>vault.unseal(wrong,encrypted));
});
test('encrypted writes use fresh IVs, support large exports and detect tampering',async()=>{
  const salt=vault.encode(crypto.getRandomValues(new Uint8Array(16))),key=await vault.derive('012345',salt);
  const data={notes:'A'.repeat(200000)};
  const a=await vault.seal(key,data),b=await vault.seal(key,data);
  assert.notEqual(a.iv,b.iv);assert.deepEqual(await vault.unseal(key,a),data);
  const corrupted={...a,cipher:(a.cipher[0]==='A'?'B':'A')+a.cipher.slice(1)};
  await assert.rejects(()=>vault.unseal(key,corrupted));
});
test('unlock session survives reload without retaining the PIN and rejects mismatched vaults',async()=>{
  const salt=vault.encode(crypto.getRandomValues(new Uint8Array(16))),key=await vault.derive('012345',salt);
  const config={verifier:'public-verifier'};
  const record={salt,...await vault.seal(key,{format:'perfin-vault-v1',saved:{months:[]},accessKey:''})};
  const session=await vault.createSession(key,salt,config);
  assert.ok(!JSON.stringify(session).includes('012345'));
  const restored=await vault.restoreSession(JSON.parse(JSON.stringify(session)),record,config);
  assert.deepEqual(restored.data.saved,{months:[]});
  assert.equal(await vault.restoreSession(null,record,config),null);
  assert.equal(await vault.restoreSession(session,{...record,salt:'different'},config),null);
  assert.equal(await vault.restoreSession(session,record,{verifier:'changed'}),null);
});
