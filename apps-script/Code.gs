/** PerFin private bridge. Deploy as yourself / Anyone; every data request requires a key. */
const PF_SHEET_ID = '1WFnpE_lp5tGC-AeR15TxKbE7isUqMnjl7ypV9f9oYl8';
const PF_TAB = 'Temp Calc';
const PF_MARKER = 'PERFIN_STATE_V1';

function setupPerFin() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PF_ACCESS_KEY')) props.setProperty('PF_ACCESS_KEY', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  withLock_(function () { persistState_(refreshSource_(loadState_())); });
  installDailyRefresh();
  // The key is deliberately not logged. Copy it from Project Settings → Script properties.
  console.log('PerFin is ready. Copy PF_ACCESS_KEY from Project Settings → Script properties, then deploy the web app.');
}

function installDailyRefresh() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyRefresh').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyRefresh').timeBased().everyDays(1).atHour(6).inTimezone('Asia/Kolkata').create();
}

function rotateAccessKey() {
  PropertiesService.getScriptProperties().setProperty('PF_ACCESS_KEY', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  console.log('Access key rotated. Pair your devices again using the new Script property value.');
}

function dailyRefresh() {
  withLock_(function () {
    const state = refreshSource_(loadState_());
    state.updatedAt = new Date().toISOString();
    // A source refresh does not alter app entries, so it does not advance their revision.
    persistState_(state);
  });
  if(typeof generateGeminiInsights_==='function')generateGeminiInsights_(false);
}

function doGet() {
  return json_({ ok: true, service: 'PerFin private bridge', version: 1, message: 'Pair in PerFin Settings. Authenticated POST requests only.' });
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 8000000) throw Error('Request is empty or exceeds the 8 MB sync limit.');
    const request = JSON.parse(raw);
    if (!authorized_(request.key)) throw Error('Access denied. Check your private access key.');
    if(request.action==='generateInsights'){
      const result=generateGeminiInsights_(true);
      return json_({ok:true,result,state:withLock_(loadState_)});
    }
    if (request.action !== 'sync') throw Error('Unsupported action.');
    const result=withLock_(function () { return sync_(request); });
    if(result.ok&&typeof generateGeminiInsights_==='function'&&PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')&&(request.mutations?.months?.length||request.mutations?.transactions?.length)){
      result.geminiGeneration=generateGeminiInsights_(false);result.state=withLock_(loadState_);
    }
    return json_(result);
  } catch (err) {
    return json_({ ok: false, error: String(err.message || 'Sync failed.') });
  }
}

function authorized_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('PF_ACCESS_KEY');
  if (!expected || typeof key !== 'string' || key.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= key.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function sync_(request) {
  if (typeof PF.recordNetWorthSnapshot !== 'function') throw Error('Apps Script files are out of date. Replace Core.gs with the latest apps-script/Core.gs, save, then deploy a New version of this web app and retry Sync.');
  const state = refreshSource_(loadState_());
  const changes = request.mutations || {};
  if (!Array.isArray(changes.months) || !Array.isArray(changes.transactions) || !changes.mappings || typeof changes.mappings !== 'object' || Array.isArray(changes.mappings)) throw Error('Malformed sync request.');
  if (changes.months.length > 120 || changes.transactions.length > 20000 || Object.keys(changes.mappings).length > 500) throw Error('Too many records in one sync.');
  const bankChanged=Object.prototype.hasOwnProperty.call(changes,'currentBank');
  if(bankChanged)PF.validateCurrentBank(changes.currentBank);
  const mutating = changes.months.length || changes.transactions.length || Object.keys(changes.mappings).length || bankChanged;
  if (mutating && Number(request.baseRevision) !== state.revision) {
    // Return the latest state to let the user inspect it before rebasing local changes.
    return { ok: false, code: 'CONFLICT', error: 'Another device saved changes. Review the latest sheet data before retrying.', state };
  }
  const rows = changes.months.slice().sort((a, b) => a.month.localeCompare(b.month));
  rows.forEach(row => {
    PF.validateMonth(row, state.months);
    if (Object.keys(row.portfolio).some(k => !['mf','stocks','crypto','fd'].includes(k))) throw Error('Unsupported portfolio asset class.');
    const clean = { month: row.month, income: row.income, expense: row.expense, investment: row.investment, withdrawal: row.withdrawal, bank: row.bank, portfolio: row.portfolio, complete: true, source: 'app', updatedAt: new Date().toISOString() };
    state.months = state.months.filter(r => r.month !== clean.month).concat(clean);
  });
  const known = new Set(state.transactions.map(PF.transactionKey));
  changes.transactions.forEach(t => {
    PF.validateTransaction(t);
    const k = PF.transactionKey(t);
    if (!known.has(k)) { known.add(k); state.transactions.push(t); }
  });
  const types = ['need','want','other','investment','withdrawal','transfer','income','unmapped'];
  Object.entries(changes.mappings).forEach(([key, value]) => {
    if (key.length > 220 || !/\|[+-]$/.test(key) || !types.includes(value)) throw Error('Invalid category mapping.');
    state.mappings[key] = value;
  });
  state.months.sort((a,b)=>a.month.localeCompare(b.month));
  if(bankChanged)state.currentBank={amount:changes.currentBank.amount,updatedAt:new Date().toISOString()};
  if (mutating) state.revision++;
  state.updatedAt = new Date().toISOString();
  const netWorthSnapshot=PF.recordNetWorthSnapshot(state);
  persistState_(state);
  return { ok: true, features:['current-bank-balance','monthly-net-worth-snapshots'], netWorthSnapshot, state };
}

function refreshSource_(saved) {
  saved.geminiEnabled=PropertiesService.getScriptProperties().getProperty('GEMINI_ENABLED')==='true';
  const book = SpreadsheetApp.openById(PF_SHEET_ID);
  const mock = { SheetNames: [], Sheets: {} };
  book.getSheets().filter(s => /^20\d{2}$/.test(s.getName())).forEach(s => {
    mock.SheetNames.push(s.getName());
    mock.Sheets[s.getName()] = s.getRange(1,1,Math.min(60,s.getMaxRows()),Math.min(9,s.getMaxColumns())).getValues();
  });
  const imported = PFWorkbook.read(mock, { utils: { sheet_to_json: grid => grid } });
  const owned = saved.months.filter(r => r.source === 'app');
  saved.months = imported.months.filter(r => !owned.some(a => a.month === r.month)).concat(owned).sort((a,b)=>a.month.localeCompare(b.month));
  saved.annual = imported.annual;
  saved.warnings = imported.warnings;
  saved.sourceRefreshedAt = new Date().toISOString();
  return saved;
}

function stateSheet_() {
  const book = SpreadsheetApp.openById(PF_SHEET_ID);
  const sheet = book.getSheetByName(PF_TAB) || book.insertSheet(PF_TAB);
  if (sheet.getMaxColumns() < 11) sheet.insertColumnsAfter(sheet.getMaxColumns(), 11-sheet.getMaxColumns());
  const marker = sheet.getRange(1,8).getValue();
  if (marker && marker !== PF_MARKER) throw Error('Temp Calc H1:K is occupied. Move that content before setting up PerFin.');
  if (!marker) {
    const occupied = sheet.getRange(1,8,sheet.getMaxRows(),4).getValues().some(row=>row.some(v=>v!==''));
    if (occupied) throw Error('Temp Calc H:K already contains data. Clear or move it before setup.');
    sheet.getRange(1,8,1,4).setValues([[PF_MARKER,'Key','JSON','Updated at']]);
    sheet.getRange(1,8,1,4).setFontWeight('bold').setBackground('#d9eeaf');
  }
  return sheet;
}

function loadState_() {
  const sheet = stateSheet_();
  const state = PF.emptyState();
  const rows = sheet.getLastRow()>1 ? sheet.getRange(2,8,sheet.getLastRow()-1,4).getValues() : [];
  rows.filter(row=>row[0]).forEach(row => {
    let value;
    try { value = JSON.parse(row[2]); } catch (_) { throw Error('Temp Calc contains invalid saved JSON. Restore a private backup before syncing.'); }
    if (row[0] === 'meta') Object.assign(state,value);
    else if (row[0] === 'month') state.months.push(value);
    else if (row[0] === 'annual') state.annual.push(value);
    else if (row[0] === 'transaction') state.transactions.push(value);
    else if (row[0] === 'mapping') state.mappings[row[1]] = value;
    else if (row[0] === 'gemini-report') {if(!state.geminiReports)state.geminiReports={};state.geminiReports[row[1]]=value;}
    else if (row[0] === 'net-worth-snapshot') {if(!state.netWorthSnapshots)state.netWorthSnapshots=[];state.netWorthSnapshots.push(value);}
  });
  return state;
}

function persistState_(state) {
  const sheet = stateSheet_(), at = new Date().toISOString();
  const data = [['meta','state',JSON.stringify({version:1,trackingStart:PF.TRACKING_START,historyThrough:'2026-10',currentBank:state.currentBank||null,revision:state.revision,updatedAt:state.updatedAt,sourceRefreshedAt:state.sourceRefreshedAt,warnings:state.warnings||[]}),at]];
  const add = (kind,key,value)=>data.push([kind,String(key),JSON.stringify(value),at]);
  state.months.forEach(r=>add('month',r.month,r));
  state.annual.forEach(a=>add('annual',a.year,a));
  state.transactions.forEach((t,i)=>add('transaction',String(i),t));
  Object.entries(state.mappings).forEach(([key,value])=>add('mapping',key,value));
  Object.entries(state.geminiReports||{}).forEach(([key,value])=>add('gemini-report',key,value));
  (state.netWorthSnapshots||[]).forEach(r=>add('net-worth-snapshot',r.month,r));
  add('meta','gemini',{geminiEnabled:!!state.geminiEnabled,geminiReport:state.geminiReport||null,geminiStatus:state.geminiStatus||null});
  if (data.some(r=>r[2].length>45000)) throw Error('A stored record is too large.');
  if (sheet.getMaxRows()<data.length+1) sheet.insertRowsAfter(sheet.getMaxRows(),data.length+1-sheet.getMaxRows());
  const oldLast = sheet.getLastRow();
  // All variable strings are JSON-encoded; keys are forced to plain text to avoid formula injection.
  const safeData = data.map(row=>row.map((v,i)=>i===1&&/^[=+\-@]/.test(v)?"'"+v:v));
  sheet.getRange(2,8,data.length,4).setValues(safeData);
  if (oldLast>data.length+1) sheet.getRange(data.length+2,8,oldLast-data.length-1,4).clearContent();
  SpreadsheetApp.flush();
}
