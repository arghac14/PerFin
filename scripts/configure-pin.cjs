const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const secretPath=path.join(root,'.private','pin.json');
const target=path.join(root,'app','pin-config.js');
if(fs.existsSync(secretPath)){
  const {pin}=JSON.parse(fs.readFileSync(secretPath,'utf8'));
  if(typeof pin!=='string'||!/^\d{6}$/.test(pin))throw Error('Private PIN configuration must contain exactly six digits.');
  let salt;
  if(fs.existsSync(target)){
    const match=fs.readFileSync(target,'utf8').match(/"salt":"([A-Za-z0-9+/=]+)"/);
    if(match)salt=Buffer.from(match[1],'base64');
  }
  salt=salt||crypto.randomBytes(16);
  const verifier=crypto.pbkdf2Sync(pin,salt,210000,32,'sha256').toString('base64');
  fs.writeFileSync(target,'// Derived PIN verifier only. Plaintext PIN stays in ignored .private/pin.json.\nconst PF_PIN_CONFIG = '+JSON.stringify({salt:salt.toString('base64'),verifier,iterations:210000})+';\n');
}else if(!fs.existsSync(target)){
  throw Error('Missing public PIN verifier. Configure the ignored local PIN file and run the build before deploying.');
}
