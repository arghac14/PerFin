const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function bridge(){
  const cells=new Map();let mutations=0;const props={PF_ACCESS_KEY:'a'.repeat(64)};
  const range=(r,c,nr=1,nc=1)=>({getValue:()=>cells.get(`${r},${c}`)||'',getValues:()=>Array.from({length:nr},(_,y)=>Array.from({length:nc},(_,x)=>cells.get(`${r+y},${c+x}`)||'')),setValues:rows=>{assert.ok(c>=8&&c+nc<=12,'writes must stay inside H:K');mutations++;rows.forEach((row,y)=>row.forEach((v,x)=>cells.set(`${r+y},${c+x}`,v)));return range(r,c,nr,nc);},setFontWeight:()=>range(r,c,nr,nc),setBackground:()=>range(r,c,nr,nc),clearContent:()=>{assert.ok(c>=8);mutations++;for(let y=0;y<nr;y++)for(let x=0;x<nc;x++)cells.delete(`${r+y},${c+x}`);}});
  const sheet={getMaxColumns:()=>26,getMaxRows:()=>1000,getRange:range,getLastRow:()=>Math.max(1,...[...cells.keys()].map(k=>Number(k.split(',')[0])))};
  const c=vm.createContext({console,Intl,Date,JSON,Set,Map,SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet,getSheets:()=>[],insertSheet:()=>sheet}),flush:()=>{}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>s})}});
  for(const file of ['app/core.js','app/workbook.js','apps-script/Code.gs'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),c);
  const post=obj=>JSON.parse(c.doPost({postData:{contents:JSON.stringify(obj)}}));
  const sync=(extra={})=>post({key:props.PF_ACCESS_KEY,action:'sync',baseRevision:0,mutations:{months:[],transactions:[],mappings:{}},...extra});
  return {c,cells,post,sync,get writes(){return mutations;}};
}
test('unauthorized requests cannot read or mutate finance data',()=>{
  const b=bridge();const r=b.post({key:'wrong',action:'sync'});assert.equal(r.ok,false);assert.match(r.error,/Access denied/);assert.equal(b.writes,0);assert.equal(r.state,undefined);
});

test('mismatched Core gives deployment instructions without writing data',()=>{
  const b=bridge();vm.runInContext('PF.recordNetWorthSnapshot = undefined',b.c);
  const result=b.sync();assert.equal(result.ok,false);
  assert.match(result.error,/Replace Core.gs/);assert.match(result.error,/New version/);
  assert.equal(b.writes,0);
});
test('sync persists only in Temp Calc H:K and rejects stale revisions',()=>{
  const b=bridge();assert.equal(b.sync().ok,true);
  const mappings={'rent|-':'need'};
  const a=b.sync({mutations:{months:[],transactions:[],mappings}});assert.equal(a.ok,true);assert.equal(a.state.revision,1);
  const stale=b.sync({mutations:{months:[],transactions:[],mappings:{'rent|-':'want'}}});assert.equal(stale.code,'CONFLICT');assert.equal(stale.state.mappings['rent|-'],'need');
  const fresh=b.sync({baseRevision:1,mutations:{months:[],transactions:[],mappings:{'rent|-':'want'}}});assert.equal(fresh.ok,true);assert.equal(fresh.state.revision,2);
});
test('invalid batch is rejected before any transaction records are persisted',()=>{
  const b=bridge();b.sync();const before=b.writes;
  const result=b.sync({mutations:{months:[],transactions:[{date:'2026-01-01',amount:'not a number'}],mappings:{}}});
  assert.equal(result.ok,false);assert.equal(b.writes,before);assert.equal(b.sync().state.transactions.length,0);
});
test('overlapping transaction uploads merge idempotently',()=>{
  const b=bridge();const t={id:'1',date:'2026-10-01',amount:-100,category:'Rent',currency:'INR',note:'',wallet:'A'};
  const r=b.sync({mutations:{months:[],transactions:[t,t],mappings:{}}});assert.equal(r.state.transactions.length,1);
  const again=b.sync({baseRevision:1,mutations:{months:[],transactions:[t],mappings:{}}});assert.equal(again.state.transactions.length,1);
});
test('current bank balance round-trips through Temp Calc with revision checks',()=>{
  const b=bridge();const mutations={months:[],transactions:[],mappings:{},currentBank:{amount:12500}};
  const result=b.sync({mutations});assert.equal(result.ok,true);assert.equal(result.state.currentBank.amount,12500);assert.ok(result.features.includes('current-bank-balance'));
  assert.equal(b.sync().state.currentBank.amount,12500);
  assert.equal(b.sync({mutations}).code,'CONFLICT');
  const zero=b.sync({baseRevision:1,mutations:{...mutations,currentBank:{amount:0}}});assert.equal(zero.state.currentBank.amount,0);
  const invalid=b.sync({baseRevision:2,mutations:{...mutations,currentBank:{amount:-1}}});assert.equal(invalid.ok,false);assert.equal(b.sync().state.currentBank.amount,0);
});
test('successful sync stores and reloads one current-month net-worth snapshot in Temp Calc',()=>{
  const b=bridge();
  b.c.persistState_({version:1,revision:0,months:[{month:'2026-10',complete:true,source:'app',income:100,expense:20,investment:30,withdrawal:0,bank:50,portfolio:{mf:1000}}],annual:[],transactions:[],mappings:{},currentBank:{amount:200}});
  const first=b.sync();assert.equal(first.netWorthSnapshot.recorded,true);assert.equal(first.state.netWorthSnapshots[0].netWorth,1200);
  assert.ok(first.features.includes('monthly-net-worth-snapshots'));
  const updated=b.sync({mutations:{months:[],transactions:[],mappings:{},currentBank:{amount:300}}});assert.equal(updated.state.netWorthSnapshots.length,1);assert.equal(updated.state.netWorthSnapshots[0].netWorth,1300);
  const read=b.sync();assert.equal(read.state.netWorthSnapshots.length,1);assert.equal(read.state.netWorthSnapshots[0].bank,300);
  assert.equal([...b.cells.values()].filter(v=>v==='net-worth-snapshot').length,1);
});
