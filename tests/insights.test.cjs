const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
global.PF=require('../app/core.js');
const insights=require('../app/insights.js');
function history(){const s=PF.emptyState();for(let n=5;n<=10;n++){const month=`2026-${String(n).padStart(2,'0')}`;s.months.push({month,income:100000,expense:30000+n*500,investment:10000,withdrawal:0,complete:true});s.transactions.push({date:month+'-02',category:'Shopping',amount:-(n===10?20000:3000),note:'PRIVATE NOTE',wallet:'PRIVATE WALLET',id:'private-id',currency:'INR'});}s.currentBank={amount:777777};return s;}
function resultFor(payload){return {insights:payload.facts.slice(0,5).map(f=>({title:'Supported observation',explanation:'The recorded evidence shows a useful pattern.',suggestion:'Review this pattern before choosing a change.',factIds:[f.id]}))};}
test('six-month summaries exclude current partial month and private transaction details',()=>{
  const s=history();s.transactions.push({date:'2026-11-01',category:'Shopping',amount:-999999,note:'SECRET'});
  const p=insights.summarize(s,'2026-11');assert.equal(p.start,'2026-05-01');assert.equal(p.end,'2026-10-31');assert.equal(p.months.length,6);
  const json=JSON.stringify(p);for(const secret of ['PRIVATE NOTE','PRIVATE WALLET','private-id','777777','999999'])assert.ok(!json.includes(secret));
  assert.ok(p.facts.some(f=>f.id.startsWith('spike_')));assert.ok(p.facts.some(f=>f.id.startsWith('reduction_')));
});
test('missing upload months remain unknown and supported reports attach script-calculated evidence',()=>{
  const s=history();s.transactions=s.transactions.filter(t=>!t.date.startsWith('2026-07'));
  const p=insights.summarize(s,'2026-11');assert.ok(p.facts.find(f=>f.id==='category_0').evidence.includes('—'));
  const valid=insights.validate(resultFor(p),p);assert.equal(valid.length,5);assert.equal(valid[0].evidence[0],p.facts[0].evidence);
  const invalid=resultFor(p);invalid.insights[0].factIds=['made_up'];assert.throws(()=>insights.validate(invalid,p),/unknown evidence/);
  const invented=resultFor(p);invented.insights[0].explanation='You will save 5000';assert.throws(()=>insights.validate(invented,p),/unsupported/);
});
function aiService({key='fake-test-key',http=200,enabled=true}={}){
  let state=history(),calls=0;const props={GEMINI_API_KEY:key,GEMINI_ENABLED:enabled?'true':'false'};
  const ctx=vm.createContext({console:{log:()=>{}},Intl,Date,JSON,Map,Set,PF,PFInsights:insights,
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k],setProperty:(k,v)=>props[k]=v,deleteProperty:k=>delete props[k]})},
    Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,s)=>crypto.createHash('sha256').update(s).digest(),base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url')},
    withLock_:fn=>fn(),loadState_:()=>JSON.parse(JSON.stringify(state)),refreshSource_:s=>s,persistState_:s=>{state=JSON.parse(JSON.stringify(s));},
    UrlFetchApp:{fetch:(_,opts)=>{calls++;const payload=JSON.parse(JSON.parse(opts.payload).contents[0].parts[0].text);state.currentBank={amount:123};return {getResponseCode:()=>http,getContentText:()=>JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(resultFor(payload))}]}}]})};}}
  });
  vm.runInContext(fs.readFileSync('apps-script/Gemini.gs','utf8'),ctx);
  return {run:force=>ctx.generateGeminiInsights_(force),get state(){return state;},get calls(){return calls;}};
}
test('Gemini service skips absent keys, caches unchanged summaries and preserves concurrent bank edits',()=>{
  const disabled=aiService({enabled:false});assert.equal(disabled.run(true).code,'disabled');assert.equal(disabled.calls,0);
  const absent=aiService({key:''});assert.equal(absent.run(true).code,'not_configured');assert.equal(absent.calls,0);
  const service=aiService();assert.equal(service.run(false).code,'ready');assert.equal(service.state.currentBank.amount,123);assert.equal(service.state.geminiReport.insights.length,5);
  assert.equal(service.run(false).code,'cached');assert.equal(service.calls,1);
  service.run(true);service.run(true);assert.equal(service.run(true).code,'daily_limit');assert.equal(service.calls,3);
});
test('Gemini API errors retain data and record a retryable status without fabricated insights',()=>{
  const service=aiService({http:429});const result=service.run(true);assert.equal(result.code,'error');assert.equal(service.state.geminiReport,undefined);assert.equal(service.state.geminiStatus.code,'error');assert.ok(result.message.includes('429'));
});
test('Trends includes full months only and computes gains against exact boundary valuations',()=>{
  const s=history();const range=PF.transactionRange({mode:'custom',start:'2026-05-15',end:'2026-08-10'});
  assert.deepEqual(PF.journalInRange(s.months,range).map(r=>r.month),['2026-06','2026-07']);
  s.months=[{month:'2026-09',complete:true,portfolio:{mf:1000},bank:0},{month:'2026-10',complete:true,portfolio:{mf:1150},investment:100,withdrawal:0}];
  assert.equal(PF.periodPortfolioGain(s,[s.months[1]]).gain,50);
  s.months[1].withdrawal=null;assert.equal(PF.periodPortfolioGain(s,[s.months[1]]).gain,null);
});
