/* Shared calculations. Also copied to Apps Script as Core.gs by npm run build. */
const PF = (() => {
  'use strict';
  const VERSION = 1;
  // Existing journal history is closed through October 2026. No figures are fabricated.
  const TRACKING_START = '2026-11';
  const sum = (rows, key) => rows.reduce((n, r) => n + (typeof r[key] === 'number' ? r[key] : 0), 0);
  const portfolioTotal = p => p && Object.values(p).every(Number.isFinite) ? Object.values(p).reduce((a, b) => a + b, 0) : null;
  const money = (v, compact = false) => v == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0, ...(compact ? { notation: 'compact', maximumFractionDigits: 1 } : {}) }).format(v);
  const pct = v => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
  const monthLabel = (m, long = false) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en-IN', { month: long ? 'long' : 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  function currentMonth(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(date);
    return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
  }
  function currentDate(date = new Date()) {
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
  }
  function transactionRange(filter={mode:'ytd'},date=new Date()) {
    const today=currentDate(date),year=today.slice(0,4);
    const monthEnd=m=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(m||''))throw Error('Choose a valid month.');const [y,n]=m.split('-').map(Number);return new Date(Date.UTC(y,n,0)).toISOString().slice(0,10);};
    const trailing={'last-month':[1,'Last month'],'6-months':[6,'Last 6 months'],'2-years':[24,'Last 2 years'],'3-years':[36,'Last 3 years'],'5-years':[60,'Last 5 years']};
    if(Object.hasOwn(trailing,filter.mode)){
      const [count,label]=trailing[filter.mode],endDate=new Date(today.slice(0,7)+'-01T12:00:00Z'),startDate=new Date(endDate);
      startDate.setUTCMonth(startDate.getUTCMonth()-count);
      return {start:startDate.toISOString().slice(0,10),end:new Date(endDate.getTime()-86400000).toISOString().slice(0,10),label,mode:filter.mode,completedMonths:true};
    }
    if(filter.mode==='ytd')return {start:`${year}-01-01`,end:today,label:'Year to date',mode:'ytd'};
    if(filter.mode==='monthly')return {start:`${filter.month}-01`,end:monthEnd(filter.month),label:monthLabel(filter.month,true),mode:'monthly'};
    if(filter.mode==='yearly'){
      if(!/^\d{4}$/.test(filter.year||''))throw Error('Choose a valid year.');
      return {start:`${filter.year}-01-01`,end:`${filter.year}-12-31`,label:filter.year,mode:'yearly'};
    }
    if(filter.mode==='custom'){
      const start=parseDate(filter.start||''),end=parseDate(filter.end||'');
      if(start>end)throw Error('Start date must be on or before end date.');
      return {start,end,label:'Custom date range',mode:'custom'};
    }
    throw Error('Choose a valid reporting period.');
  }
  function transactionsInRange(rows,range,search=''){
    const term=search.trim().toLowerCase();
    return rows.filter(t=>t.date>=range.start&&t.date<=range.end&&(!term||`${t.category} ${t.note} ${t.wallet}`.toLowerCase().includes(term)));
  }
  function monthInRange(month,range){const bounds=transactionRange({mode:'monthly',month});return bounds.start>=range.start&&bounds.end<=range.end;}
  function journalInRange(rows,range){return rows.filter(r=>r.complete&&monthInRange(r.month,range)).sort((a,b)=>a.month.localeCompare(b.month));}
  function periodPortfolioGain(state,rows){
    if(!rows.length)return {gain:null,rate:null};
    const first=rows[0].month,last=rows.at(-1).month;
    const previous=new Date(first+'-01T12:00:00Z');previous.setUTCMonth(previous.getUTCMonth()-1);
    const before=previous.toISOString().slice(0,7),opening=portfolioMetrics(state,before),closing=portfolioMetrics(state,last);
    const expected=(Number(last.slice(0,4))-Number(first.slice(0,4)))*12+Number(last.slice(5))-Number(first.slice(5))+1;
    if(rows.length!==expected||rows.some(r=>r.withdrawal==null)||opening.asOf!==before||closing.asOf!==last)return {gain:null,rate:null};
    const contributions=sum(rows,'investment'),gain=closing.value-opening.value-contributions+sum(rows,'withdrawal'),denom=opening.value+contributions;
    return {gain,rate:denom>0?gain/denom:null};
  }
  function emptyState() { return { version: VERSION, revision: 0, trackingStart: TRACKING_START, historyThrough: '2026-10', months: [], annual: [], transactions: [], mappings: {}, updatedAt: null }; }
  function dueMonth(rows, now = currentMonth()) {
    const date = new Date(`${TRACKING_START}-01T12:00:00Z`);
    for (let m = TRACKING_START; m < now; date.setUTCMonth(date.getUTCMonth() + 1), m = date.toISOString().slice(0,7)) {
      if (!rows.some(r => r.month === m && r.complete)) return m;
    }
    return null;
  }
  function validateMonth(row, rows, now = currentMonth()) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.month || '')) throw Error('Choose a valid month.');
    if (row.month >= now) throw Error('Enter a completed month. The current month is still in progress.');
    for (const key of ['income', 'expense', 'investment', 'withdrawal', 'bank']) {
      if (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < 0 || row[key] > 1e12) throw Error(`Enter a valid, non-negative ${key} amount.`);
    }
    if (!row.portfolio || !Object.keys(row.portfolio).length || Object.values(row.portfolio).some(v => !Number.isFinite(v) || v < 0 || v > 1e12)) throw Error('Enter portfolio values, including 0 for unused asset classes.');
    const due = dueMonth(rows, now);
    if (due && row.month > due) throw Error(`Complete ${monthLabel(due)} first.`);
    return true;
  }
  function cashSurplus(r) { return r.income - r.expense - r.investment + (r.withdrawal || 0); }
  function validateCurrentBank(record) {
    if(!record || (record.amount!==null && (typeof record.amount!=='number'||!Number.isFinite(record.amount)||record.amount<0||record.amount>1e12)))throw Error('Enter a valid, non-negative bank balance.');
    return true;
  }
  function currentNetWorth(state) {
    const months=[...state.months.filter(r=>r.complete).map(r=>r.month),...state.annual.map(a=>a.asOf)].sort();
    const p=portfolioMetrics(state,months.at(-1)||currentMonth());
    const bank=state.currentBank ? state.currentBank.amount : p.bank;
    return {...p,bank,netWorth:bank==null||p.value==null?null:bank+p.value,bankUpdatedAt:state.currentBank?.updatedAt||null};
  }
  function recordNetWorthSnapshot(state,date=new Date()){
    const p=currentNetWorth(state);
    if(p.bank==null||p.value==null||!Number.isFinite(p.bank)||!Number.isFinite(p.value))return {recorded:false,message:'Add a bank balance and portfolio value to start monthly net-worth history.'};
    const month=currentMonth(date),snapshot={month,capturedAt:date.toISOString(),capturedDate:currentDate(date),bank:p.bank,portfolio:p.value,netWorth:p.bank+p.value,portfolioAsOf:p.asOf,bankUpdatedAt:p.bankUpdatedAt};
    state.netWorthSnapshots=(state.netWorthSnapshots||[]).filter(r=>r.month!==month).concat(snapshot).sort((a,b)=>a.month.localeCompare(b.month));
    return {recorded:true,month};
  }
  function netWorthHistory(state,range){
    const points=new Map();
    state.months.filter(r=>r.complete&&r.bank!=null&&portfolioTotal(r.portfolio)!=null).forEach(r=>{
      const end=transactionRange({mode:'monthly',month:r.month}).end;
      points.set(r.month,{month:r.month,capturedDate:end,netWorth:r.bank+portfolioTotal(r.portfolio),source:'journal'});
    });
    (state.netWorthSnapshots||[]).forEach(r=>{if(Number.isFinite(r.netWorth)&&r.capturedDate)points.set(r.month,{...r,source:'sync'});});
    return [...points.values()].filter(r=>r.capturedDate>=range.start&&r.capturedDate<=range.end).sort((a,b)=>a.month.localeCompare(b.month));
  }
  const needs = ['Electricity','Family Stuffs','Groceries/water/house holds','Grooming + massage','Gym + Supplements','Health Insurance','Internet','Meals/Snacks','Mobile bills','Rent','Transport','Treatment + meds + supplements','Investment on skills'];
  const wants = ['Shopping','Hobby stuffs','Charity','Food (Non-essential)','Friends/Outings','Gifting','Others','Sports','TV/Streaming Services','Travel','💗','💖','Flight to Home','Shopping (Gadgets/things)','Ai'];
  const investmentCategories = ['Investment','Crypto','FD/RD','Mutual Fund','Stocks','Emergency fund'];
  const incomes = ['Salary','Other Income','Gifts','Selling','Salary (Side Income)','ITR return'];
  function normalize(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
  const included = (list, v) => list.some(x => normalize(x) === normalize(v));
  function classify(t, mappings = {}) {
    const override = mappings[`${normalize(t.category)}|${t.amount < 0 ? '-' : '+'}`];
    if (override) return override;
    if (included(['Incoming transfer','Outgoing transfer','Withdrawal','Transfer'], t.category)) return 'transfer';
    if (included(['Investment Withdrawal'], t.category)) return 'withdrawal';
    if (included(investmentCategories, t.category)) return t.amount < 0 ? 'investment' : 'withdrawal';
    if (included(needs.concat('Need'), t.category)) return 'need';
    if (included(wants.concat('Want'), t.category)) return 'want';
    if (included(incomes, t.category)) return 'income';
    if (included(['Other Expense'], t.category)) return 'other';
    return 'unmapped';
  }
  function parseDelimited(text) {
    text = text.replace(/^\uFEFF/, '');
    const first = text.split(/\r?\n/, 1)[0];
    const sep = first.includes('\t') ? '\t' : ',';
    const rows = []; let row = [], cell = '', quote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') { if (quote && text[i + 1] === '"') { cell += '"'; i++; } else quote = !quote; }
      else if (!quote && c === sep) { row.push(cell); cell = ''; }
      else if (!quote && (c === '\n' || c === '\r')) {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); if (row.some(x => x.trim())) rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (quote) throw Error('Unclosed quote in the uploaded file.');
    row.push(cell); if (row.some(x => x.trim())) rows.push(row);
    return rows;
  }
  function parseDate(s) {
    const raw = s.trim(); let y, m, d;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) [d, m, y] = raw.split('/').map(Number);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) [y, m, d] = raw.split('-').map(Number);
    else throw Error(`Unsupported date “${s}”. Use DD/MM/YYYY or YYYY-MM-DD.`);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) throw Error(`Invalid date “${s}”.`);
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  function transactionKey(t) { return JSON.stringify([t.wallet, t.id, t.date, t.category, t.amount, t.currency, t.note]); }
  function importTransactions(text, existing = []) {
    const rows = parseDelimited(text);
    if (rows.length < 2) throw Error('The file needs a header and at least one transaction.');
    const headers = rows.shift().map(normalize);
    for (const h of ['date','category','amount']) if (!headers.includes(h)) throw Error(`Missing “${h}” column.`);
    const get = (r, h) => (r[headers.indexOf(h)] || '').trim();
    const seen = new Set(existing.map(transactionKey));
    let duplicates = 0; const errors = [], transactions = [];
    rows.forEach((r, i) => {
      try {
        const raw = get(r, 'amount').replace(/,/g, '');
        if (!raw || !Number.isFinite(Number(raw))) throw Error('Invalid amount.');
        const currency = get(r, 'currency').toUpperCase() || 'INR';
        if (currency !== 'INR') throw Error(`Currency ${currency} is not supported; no exchange rate was applied.`);
        const t = { id: get(r, 'id'), date: parseDate(get(r, 'date')), category: get(r, 'category'), amount: Number(raw), currency, wallet: get(r, 'wallet'), note: get(r, 'note') };
        if (!t.category) throw Error('Missing category.');
        const k = transactionKey(t);
        if (seen.has(k)) duplicates++; else { seen.add(k); transactions.push(t); }
      } catch (e) { errors.push(`Row ${i + 2}: ${e.message}`); }
    });
    return { transactions, duplicates, errors, rowCount: rows.length };
  }
  function expenseAnalysis(transactions, mappings = {}) {
    const categories = {}, groups = { need: 0, want: 0, other: 0 }, monthly = {};
    let unmapped = 0, excluded = 0;
    transactions.forEach(t => {
      const group = classify(t, mappings);
      if (group === 'unmapped') { unmapped++; return; }
      if (!Object.hasOwn(groups, group)) { excluded++; return; }
      const spend = -t.amount; // A positive amount in an expense category is a refund.
      groups[group] += spend;
      categories[t.category] = (categories[t.category] || 0) + spend;
      monthly[t.date.slice(0, 7)] = (monthly[t.date.slice(0, 7)] || 0) + spend;
    });
    return { categories: Object.entries(categories).sort((a, b) => b[1] - a[1]), groups, monthly, total: Object.values(groups).reduce((a, b) => a + b, 0), unmapped, excluded };
  }
  function spendingChanges(transactions, mappings = {}) {
    const periods = [...new Set(transactions.map(t => t.date.slice(0,7)))].sort();
    if (periods.length < 2) return null;
    const current = periods.at(-1), previous = periods.at(-2);
    const recent = Object.fromEntries(expenseAnalysis(transactions.filter(t=>t.date.startsWith(current)),mappings).categories);
    const prior = Object.fromEntries(expenseAnalysis(transactions.filter(t=>t.date.startsWith(previous)),mappings).categories);
    const increases = Object.entries(recent).map(([category,amount])=>({category,amount,previous:prior[category]||0,increase:amount-(prior[category]||0)})).filter(r=>r.increase>0).sort((a,b)=>b.increase-a.increase);
    return { current, previous, increases };
  }
  function monthlyPortfolioGains(state) {
    const rows = state.months.filter(r=>r.complete && portfolioTotal(r.portfolio)!=null).sort((a,b)=>a.month.localeCompare(b.month));
    return rows.flatMap((r,i)=>{
      if(!i || r.withdrawal==null)return [];
      const date=new Date(`${r.month}-01T12:00:00Z`);date.setUTCMonth(date.getUTCMonth()-1);
      const prev=rows[i-1];
      if(prev.month!==date.toISOString().slice(0,7))return [];
      return [{month:r.month,gain:portfolioTotal(r.portfolio)-portfolioTotal(prev.portfolio)-r.investment+r.withdrawal,contribution:r.investment,withdrawal:r.withdrawal}];
    });
  }
  function portfolioMetrics(state, through) {
    const rows = state.months.filter(r => r.complete && r.month <= through).sort((a, b) => a.month.localeCompare(b.month));
    const latest = rows.filter(r => portfolioTotal(r.portfolio) != null).at(-1);
    const annual = state.annual.filter(a => a.asOf <= through).sort((a, b) => a.year - b.year).at(-1);
    const useMonthly = latest && (!annual || latest.month >= annual.asOf);
    const value = useMonthly ? portfolioTotal(latest.portfolio) : (annual?.portfolio ?? null);
    const asOf = useMonthly ? latest.month : annual?.asOf;
    if (value == null) return { value: null, asOf: null, bank: null, netWorth: null, gain: null, gainRate: null, annualGain: null, annualRate: null };
    const anchor = state.annual.filter(a => a.asOf <= asOf && a.investedAllTime != null).sort((a, b) => a.asOf.localeCompare(b.asOf)).at(-1);
    let gain = null, gainRate = null;
    if (anchor) {
      const after = rows.filter(r => r.month > anchor.asOf && r.month <= asOf);
      // Preserve the source's cumulative net-capital basis, including its historical adjustments.
      const netCapital = anchor.investedAllTime + sum(after, 'investment') - sum(after, 'withdrawal');
      gain = value - netCapital;
      gainRate = netCapital > 0 ? gain / netCapital : null;
    }
    const year = asOf.slice(0, 4);
    const opening = state.annual.find(a => a.asOf === `${Number(year) - 1}-12`);
    const yr = rows.filter(r => r.month.startsWith(year) && r.month <= asOf);
    const completeFlows = yr.length === Number(asOf.slice(5)) && yr.every(r => r.withdrawal != null);
    const annualGain = opening && completeFlows ? value - opening.portfolio - sum(yr, 'investment') + sum(yr, 'withdrawal') : null;
    const denom = opening ? opening.portfolio + sum(yr, 'investment') : 0;
    const bank = useMonthly ? latest.bank : null;
    return { value, asOf, bank, netWorth: bank == null ? null : bank + value, gain, gainRate, annualGain, annualRate: annualGain != null && denom > 0 ? annualGain / denom : null };
  }
  function validateTransaction(t) {
    if (!t || typeof t.date !== 'string' || parseDate(t.date) !== t.date || typeof t.category !== 'string' || !t.category || t.category.length > 200 || typeof t.amount !== 'number' || !Number.isFinite(t.amount) || Math.abs(t.amount) > 1e12 || t.currency !== 'INR') throw Error('Invalid transaction.');
    for (const k of ['id','note','wallet']) if (typeof t[k] !== 'string' || t[k].length > 2000) throw Error('Invalid transaction text.');
    return true;
  }
  return { VERSION, TRACKING_START, sum, money, pct, monthLabel, currentMonth, currentDate, transactionRange, transactionsInRange, monthInRange, journalInRange, periodPortfolioGain, emptyState, dueMonth, validateMonth, cashSurplus, validateCurrentBank, currentNetWorth, recordNetWorthSnapshot, netWorthHistory, portfolioTotal, needs, wants, investmentCategories, incomes, normalize, classify, parseDelimited, parseDate, transactionKey, importTransactions, expenseAnalysis, spendingChanges, monthlyPortfolioGains, portfolioMetrics, validateTransaction };
})();
if (typeof module !== 'undefined') module.exports = PF;
