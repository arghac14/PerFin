const {test}=require('node:test');
const assert=require('node:assert/strict');
const PF=require('../app/core.js');
global.PF=PF;
const WB=require('../app/workbook.js');
const month=(m,extra={})=>({month:m,income:100,expense:20,investment:30,withdrawal:0,bank:50,portfolio:{mf:100,stocks:0,crypto:0,fd:0},complete:true,source:'app',...extra});

test('monthly gate starts in November 2026 and carries all overdue submissions across years',()=>{
  assert.equal(PF.currentMonth(new Date('2026-10-31T19:00:00Z')),'2026-11');
  assert.equal(PF.dueMonth([],'2026-11'),null);
  assert.equal(PF.dueMonth([],'2026-12'),'2026-11');
  assert.equal(PF.dueMonth([month('2026-11',{complete:false})],'2027-02'),'2026-11');
  assert.equal(PF.dueMonth([month('2026-11')],'2027-02'),'2026-12');
  assert.equal(PF.dueMonth([month('2026-11'),month('2026-12')],'2027-02'),'2027-01');
  assert.equal(PF.dueMonth([month('2026-11'),month('2026-12'),month('2027-01')],'2027-02'),null);
});
test('server and client gate reject out-of-order entries, future months and missing balances',()=>{
  assert.throws(()=>PF.validateMonth(month('2027-01'),[],'2027-02'),/Nov 2026/);
  assert.throws(()=>PF.validateMonth(month('2026-04'),[],'2026-04'),/still in progress/);
  assert.throws(()=>PF.validateMonth(month('2026-01',{bank:null}),[],'2026-04'),/bank/);
  assert.throws(()=>PF.validateMonth(month('2026-01',{portfolio:{mf:NaN}}),[],'2026-04'),/portfolio/);
  assert.equal(PF.validateMonth(month('2026-01',{income:0,expense:0,investment:0,bank:0}),[],'2026-04'),true);
});
test('withdrawal restores cash without being counted as income or reducing spending',()=>{
  assert.equal(PF.cashSurplus(month('2026-01',{withdrawal:40})),90);
  const data=[{date:'2026-01-01',category:'Stocks',amount:-1000},{date:'2026-01-01',category:'Stocks',amount:200},{date:'2026-01-01',category:'Investment Withdrawal',amount:300},{date:'2026-01-01',category:'Rent',amount:-100},{date:'2026-01-01',category:'Rent',amount:20},{date:'2026-01-01',category:'Outgoing transfer',amount:-500}];
  const result=PF.expenseAnalysis(data);
  assert.equal(result.total,80);assert.equal(result.excluded,4);
  assert.equal(PF.classify(data[0]),'investment');assert.equal(PF.classify(data[1]),'withdrawal');
});
test('all screenshot categories are supported, with signed overrides and unknown categories visible',()=>{
  for(const category of PF.needs)assert.equal(PF.classify({category,amount:-1}),'need');
  for(const category of PF.wants)assert.equal(PF.classify({category,amount:-1}),'want');
  assert.equal(PF.classify({category:'Investment on skills',amount:-100}),'need');
  assert.equal(PF.classify({category:'a new category',amount:-1}),'unmapped');
  assert.equal(PF.classify({category:'Stocks',amount:50},{'stocks|+':'income'}),'income');
  assert.equal(PF.classify({category:'Stocks',amount:-50},{'stocks|+':'income'}),'investment');
});
test('CSV/TSV parser handles quoted separators, multiline notes, Indian dates and duplicate imports',()=>{
  const csv='Id,Date,Category,Amount,Currency,Note,Wallet\r\n1,03/11/2026,Stocks,-11000,INR,"a, note\nnext line",A\r\n2,04/11/2026,Rent,-100,INR,,A';
  const a=PF.importTransactions(csv);assert.equal(a.transactions.length,2);assert.equal(a.transactions[0].date,'2026-11-03');assert.equal(a.transactions[0].note,'a, note\nnext line');
  assert.equal(PF.importTransactions(csv,a.transactions).duplicates,2);
  const tsv='Id\tDate\tCategory\tAmount\tCurrency\tNote\tWallet\n1\t03/11/2026\tStocks\t-11000.00\tINR\t\tA';
  assert.equal(PF.importTransactions(tsv).transactions[0].amount,-11000);
});
test('bad dates, currencies, blank amounts and malformed quotes do not enter analysis',()=>{
  const rows=PF.importTransactions('Date,Category,Amount,Currency\n31/02/2026,Rent,-5,INR\n03/11/2026,Rent,,INR\n03/11/2026,Rent,-5,USD');
  assert.equal(rows.errors.length,3);assert.equal(rows.transactions.length,0);
  assert.throws(()=>PF.importTransactions('Date,Category,Amount\n"03/11/2026,Rent,-5'),/quote/);
  assert.throws(()=>PF.validateTransaction({date:'2026-02-31',category:'Rent',amount:-5,currency:'INR'}),/Invalid date/);
});
test('portfolio returns account for withdrawals and never fabricate missing bank balances',()=>{
  const state=PF.emptyState();state.annual=[{year:2025,asOf:'2025-12',portfolio:1000,investedAllTime:800}];
  state.months=[month('2026-01',{investment:100,withdrawal:200,bank:300,portfolio:{mf:950}})];
  let p=PF.portfolioMetrics(state,'2026-01');assert.equal(p.netWorth,1250);assert.equal(p.gain,250);assert.equal(p.annualGain,50);assert.equal(p.annualRate,50/1100);
  state.months[0].withdrawal=null;p=PF.portfolioMetrics(state,'2026-01');assert.equal(p.annualGain,null);
  p=PF.portfolioMetrics(state,'2025-12');assert.equal(p.bank,null);assert.equal(p.netWorth,null);
});
test('workbook import recalculates incorrect sheet formulas and skips unsubmitted template zeros',()=>{
  const grid=Array.from({length:45},()=>[]);
  grid[4]=['January',100,999,30,20];grid[5]=['February',0,0,0,0];grid[32]=['Total',30,800,0,950];
  const s=WB.read({SheetNames:['Temp Calc','Template','2026'],Sheets:{2026:grid}},{utils:{sheet_to_json:x=>x}},'2026-03');
  assert.equal(s.months.length,1);assert.equal(PF.cashSurplus(s.months[0]),50);assert.equal(s.warnings.length,1);assert.equal(s.annual[0].asOf,'2026-01');assert.equal(s.annual[0].dateInferred,true);
});
test('new cash-flow rows in the online yearly tab do not bypass required form submission',()=>{
  const grid=Array.from({length:45},()=>[]);grid[14]=['November',100,50,30,20];
  const s=WB.read({SheetNames:['2026'],Sheets:{2026:grid}},{utils:{sheet_to_json:x=>x}},'2026-12');
  assert.equal(s.months[0].complete,false);assert.equal(PF.dueMonth(s.months,'2026-12'),'2026-11');
});
test('monthly investment gains require adjacent snapshots and adjust for cash flows',()=>{
  const s=PF.emptyState();s.months=[month('2026-01',{portfolio:{mf:1000}}),month('2026-02',{portfolio:{mf:950},investment:100,withdrawal:200}),month('2026-04',{portfolio:{mf:500}})];
  const gains=PF.monthlyPortfolioGains(s);assert.equal(gains.length,1);assert.equal(gains[0].gain,50);
});
test('category spending increases are computed after refunds and investment exclusions',()=>{
  const rows=[{date:'2026-01-01',category:'Rent',amount:-100},{date:'2026-02-01',category:'Rent',amount:-200},{date:'2026-02-01',category:'Rent',amount:20},{date:'2026-02-01',category:'Stocks',amount:-10000}];
  const changes=PF.spendingChanges(rows);assert.equal(changes.increases[0].category,'Rent');assert.equal(changes.increases[0].increase,80);assert.equal(changes.increases.length,1);
});
test('current bank balance changes current net worth without rewriting monthly history',()=>{
  const s=PF.emptyState();s.months=[month('2026-10',{bank:50,portfolio:{mf:1000}})];
  assert.equal(PF.currentNetWorth(s).netWorth,1050);
  s.currentBank={amount:200,updatedAt:'2026-11-03T10:00:00Z'};
  assert.equal(PF.currentNetWorth(s).netWorth,1200);assert.equal(PF.portfolioMetrics(s,'2026-10').netWorth,1050);
  s.currentBank.amount=0;assert.equal(PF.currentNetWorth(s).netWorth,1000);
  s.currentBank.amount=null;assert.equal(PF.currentNetWorth(s).netWorth,null);
  s.months[0].portfolio=null;assert.equal(PF.currentNetWorth(s).netWorth,null);
  assert.equal(PF.validateCurrentBank({amount:0}),true);
  assert.throws(()=>PF.validateCurrentBank({amount:-1}),/bank balance/);
  assert.throws(()=>PF.validateCurrentBank({amount:NaN}),/bank balance/);
});
test('YTD ends today in India, excludes future and previous-year transactions',()=>{
  const range=PF.transactionRange({mode:'ytd'},new Date('2026-11-02T20:00:00Z'));
  assert.deepEqual([range.start,range.end],['2026-01-01','2026-11-03']);
  const rows=['2025-12-31','2026-01-01','2026-11-03','2026-11-04'].map(date=>({date,category:'Rent',note:'',wallet:''}));
  assert.deepEqual(PF.transactionsInRange(rows,range).map(r=>r.date),['2026-01-01','2026-11-03']);
});
test('monthly and yearly filters handle leap days and inclusive period boundaries',()=>{
  const feb=PF.transactionRange({mode:'monthly',month:'2024-02'});
  assert.deepEqual([feb.start,feb.end],['2024-02-01','2024-02-29']);
  const yr=PF.transactionRange({mode:'yearly',year:'2025'});
  assert.deepEqual([yr.start,yr.end],['2025-01-01','2025-12-31']);
  assert.throws(()=>PF.transactionRange({mode:'monthly',month:'2026-13'}),/valid month/);
});
test('custom ranges include both endpoints, cross years and combine with search',()=>{
  const range=PF.transactionRange({mode:'custom',start:'2025-12-31',end:'2026-01-02'});
  const rows=[{date:'2025-12-31',category:'Rent',note:'',wallet:''},{date:'2026-01-02',category:'Shopping',note:'rent deposit',wallet:''},{date:'2026-01-03',category:'Rent',note:'',wallet:''}];
  assert.equal(PF.transactionsInRange(rows,range,'rent').length,2);
  assert.equal(PF.transactionsInRange(rows,range,'shopping').length,1);
  assert.throws(()=>PF.transactionRange({mode:'custom',start:'2026-02-01',end:'2026-01-01'}),/Start date/);
  assert.throws(()=>PF.transactionRange({mode:'custom',start:'2026-02-31',end:'2026-03-01'}),/Invalid date/);
});
test('relative month and multi-year presets end at the last completed calendar month',()=>{
  const now=new Date('2026-11-03T08:00:00Z');
  for(const [mode,start] of [['last-month','2026-10-01'],['6-months','2026-05-01'],['2-years','2024-11-01'],['3-years','2023-11-01'],['5-years','2021-11-01']]){
    const r=PF.transactionRange({mode},now);assert.equal(r.start,start);assert.equal(r.end,'2026-10-31');assert.equal(r.completedMonths,true);
  }
  const january=PF.transactionRange({mode:'last-month'},new Date('2027-01-01T01:00:00Z'));assert.equal(january.start,'2026-12-01');assert.equal(january.end,'2026-12-31');
});
test('sync snapshots update one point per month, preserve past months and include current YTD',()=>{
  const s=PF.emptyState();s.annual=[{year:2026,asOf:'2026-10',portfolio:1000}];s.currentBank={amount:200};
  assert.equal(PF.recordNetWorthSnapshot(s,new Date('2026-11-03T10:00:00Z')).recorded,true);
  s.currentBank.amount=300;PF.recordNetWorthSnapshot(s,new Date('2026-11-10T10:00:00Z'));
  assert.equal(s.netWorthSnapshots.length,1);assert.equal(s.netWorthSnapshots[0].netWorth,1300);assert.equal(s.netWorthSnapshots[0].portfolioAsOf,'2026-10');
  const ytd=PF.transactionRange({mode:'ytd'},new Date('2026-11-10T12:00:00Z'));assert.equal(PF.netWorthHistory(s,ytd).length,1);
  s.currentBank.amount=400;PF.recordNetWorthSnapshot(s,new Date('2026-12-02T10:00:00Z'));
  assert.equal(s.netWorthSnapshots.length,2);assert.equal(s.netWorthSnapshots[0].netWorth,1300);assert.equal(s.netWorthSnapshots[1].netWorth,1400);
  assert.equal(PF.netWorthHistory(s,{start:'2026-11-01',end:'2026-11-30'}).length,1);
});
test('missing bank or portfolio values do not create invented sync snapshots',()=>{
  const s=PF.emptyState();assert.equal(PF.recordNetWorthSnapshot(s).recorded,false);
  s.currentBank={amount:0};assert.equal(PF.recordNetWorthSnapshot(s).recorded,false);
  s.annual=[{year:2026,asOf:'2026-10',portfolio:0}];assert.equal(PF.recordNetWorthSnapshot(s).recorded,true);assert.equal(s.netWorthSnapshots[0].netWorth,0);
});
