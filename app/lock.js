/* Device privacy lock. The Google bridge continues to require its own access key. */
const PFVaultCrypto = (() => {
  const iterations = 210000;
  const validPin = pin => typeof pin === 'string' && /^[0-9]{6}$/.test(pin);
  const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const decode = text => Uint8Array.from(atob(text), c=>c.charCodeAt(0));
  async function derive(pin, salt) {
    if (!validPin(pin)) throw Error('Use exactly six digits.');
    const material = await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt:decode(salt),iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},true,['encrypt','decrypt']);
  }
  async function verifyPin(pin, config) {
    if(!validPin(pin)||!config)return false;
    const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:decode(config.salt),iterations:config.iterations,hash:'SHA-256'},material,256);
    return encode(bits)===config.verifier;
  }
  async function seal(key, value) {
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)));
    // Avoid argument limits for large transaction exports.
    const bytes=new Uint8Array(cipher);let text='';
    for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return {iv:encode(iv),cipher:btoa(text)};
  }
  async function unseal(key, record) {
    const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(record.iv)},key,decode(record.cipher));
    return JSON.parse(new TextDecoder().decode(raw));
  }
  async function createSession(key,salt,config){
    return {salt,verifier:config.verifier,key:encode(await crypto.subtle.exportKey('raw',key))};
  }
  async function restoreSession(session,record,config){
    if(!session||!record||session.salt!==record.salt||session.verifier!==config.verifier)return null;
    try{
      const key=await crypto.subtle.importKey('raw',decode(session.key),{name:'AES-GCM'},true,['encrypt','decrypt']);
      const data=await unseal(key,record);
      return data.format==='perfin-vault-v1'?{key,data}:null;
    }catch{return null;}
  }
  return {validPin,verifyPin,derive,seal,unseal,createSession,restoreSession,encode,iterations};
})();
if(typeof module!=='undefined')module.exports=PFVaultCrypto;

const PFVault = typeof document==='undefined' ? null : (()=>{
  const STORE='perfin.vault.v1',SESSION='perfin.session-key.v1',UNLOCK='perfin.unlock-session.v1';
  let key=null,salt=null,queue=Promise.resolve(),snapshot=null,rememberedKey='',ready=false;
  const read=()=>{const raw=localStorage.getItem(STORE);return raw?JSON.parse(raw):null;};
  function save(saved,accessKey=''){
    if(!key)return Promise.reject(Error('Unlock PerFin first.'));
    // Serialize now: a later mutation must not change an already queued write.
    const payload=JSON.stringify({format:'perfin-vault-v1',saved,accessKey});
    const task=queue.catch(()=>{}).then(async()=>{
      const encrypted=await PFVaultCrypto.seal(key,JSON.parse(payload));
      localStorage.setItem(STORE,JSON.stringify({salt,iterations:PFVaultCrypto.iterations,...encrypted,failures:0,blockedUntil:0}));
      snapshot=JSON.parse(payload).saved;rememberedKey=accessKey;
    });
    queue=task;return task;
  }
  async function setSessionKey(value){
    if(value)sessionStorage.setItem(SESSION,JSON.stringify(await PFVaultCrypto.seal(key,value)));
    else sessionStorage.removeItem(SESSION);
  }
  async function sessionKey(){
    try{const raw=sessionStorage.getItem(SESSION);return raw?await PFVaultCrypto.unseal(key,JSON.parse(raw)):'';}catch{return '';}
  }
  async function open(){
    if(typeof PF_PIN_CONFIG!=='undefined'&&crypto?.subtle){
      try{
        const restored=await PFVaultCrypto.restoreSession(JSON.parse(sessionStorage.getItem(UNLOCK)||'null'),read(),PF_PIN_CONFIG);
        if(restored){
          key=restored.key;salt=read().salt;snapshot=restored.data.saved;rememberedKey=restored.data.accessKey||'';ready=true;
          return {saved:snapshot,accessKey:rememberedKey||await sessionKey()};
        }
        sessionStorage.removeItem(UNLOCK);
      }catch{sessionStorage.removeItem(UNLOCK);}
    }
    return new Promise(resolve=>{
      const form=document.querySelector('#pin-form'),error=document.querySelector('#pin-error');
      let record;
      try{record=read();}catch{error.textContent='Device storage is unavailable or damaged. Use a supported browser with local storage enabled.';return;}
      if(!crypto?.subtle){error.textContent='This browser cannot encrypt your cache. Use Safari, Chrome or Edge over HTTPS, localhost, or a supported local file preview.';return;}
      if(typeof PF_PIN_CONFIG==='undefined'){error.textContent='PIN configuration is missing. Rebuild the app before opening it.';return;}
      form.onsubmit=async e=>{
        e.preventDefault();error.textContent='';
        const pin=document.querySelector('#pin-input').value;
        if(!PFVaultCrypto.validPin(pin)){error.textContent='Use exactly six digits.';return;}
        const submit=document.querySelector('#pin-submit');submit.disabled=true;
        try{
          record=read();
          const attempts=JSON.parse(localStorage.getItem('perfin.pin-attempts.v1')||'{}');
          if(attempts.blockedUntil>Date.now())throw Error(`Please try again in ${Math.ceil((attempts.blockedUntil-Date.now())/1000)} seconds.`);
          if(!await PFVaultCrypto.verifyPin(pin,PF_PIN_CONFIG)){
            const failures=(attempts.failures||0)+1;
            localStorage.setItem('perfin.pin-attempts.v1',JSON.stringify({failures,blockedUntil:failures>=5?Date.now()+Math.min(300000,30000*2**Math.min(failures-5,4)):0}));
            throw Error(failures>=5?'Incorrect PIN. Please wait before trying again.':'Incorrect PIN. Try again.');
          }
          salt=record?.salt||PFVaultCrypto.encode(crypto.getRandomValues(new Uint8Array(16)));
          const candidate=await PFVaultCrypto.derive(pin,salt);
          let data;
          if(record){
            try{data=await PFVaultCrypto.unseal(candidate,record);}
            catch{
              const failures=(record.failures||0)+1;
              localStorage.setItem(STORE,JSON.stringify({...record,failures,blockedUntil:failures>=5?Date.now()+Math.min(300000,30000*2**Math.min(failures-5,4)):0}));
              throw Error(failures>=5?'Incorrect PIN. Please wait before trying again.':'Incorrect PIN. Try again.');
            }
            if(data.format!=='perfin-vault-v1')throw Error('This cache format is not supported.');
          }
          localStorage.removeItem('perfin.pin-attempts.v1');
          key=candidate;snapshot=data?.saved||null;rememberedKey=data?.accessKey||'';
          await save(snapshot,rememberedKey);
          sessionStorage.setItem(UNLOCK,JSON.stringify(await PFVaultCrypto.createSession(key,salt,PF_PIN_CONFIG)));
          form.reset();ready=true;resolve({saved:snapshot,accessKey:rememberedKey||await sessionKey()});
        }catch(err){error.textContent=err.message;document.querySelector('#pin-input').value='';document.querySelector('#pin-input').focus();}
        finally{submit.disabled=false;}
      };
      document.querySelector('#pin-input').focus();
    });
  }
  async function lock(){
    if(!ready)return;
    sessionStorage.removeItem(UNLOCK);
    conceal();await queue.catch(()=>{});location.reload();
  }
  function conceal(){
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());
    document.documentElement.classList.add('app-locked');
    document.querySelector('#pin-input').value='';
  }
  // sessionStorage survives reloads and app switches, and is scoped to this tab/app session.
  return {open,save,setSessionKey,lock,flush:()=>queue};
})();
