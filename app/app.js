/* No financial records or access keys are shipped in this file. */
(async () => {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const STORE = 'perfin.workspace.v1', CONFIG = 'perfin.connection.v1';
  function readStore(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } }
  const unlocked = await PFVault.open();
  let saved = unlocked.saved || readStore(STORE, {});
  let drafts = saved.drafts || {};
  const oldDraftKeys = Object.keys(localStorage).filter(k=>k.startsWith('perfin.draft.'));
  oldDraftKeys.forEach(k=>{if(!drafts[k.slice(13)])drafts[k.slice(13)]=readStore(k,null);});
  let state = saved.state || PF.emptyState();
  let pending = saved.pending || { months: [], transactions: [], mappings: {} };
  let config = readStore(CONFIG, { url: '', theme: 'system', remember: false });
  let accessKey = unlocked.accessKey || (config.remember ? localStorage : sessionStorage).getItem('perfin.key') || '';
  let page = 'overview', year = PF.currentMonth().slice(0,4), charts = [], preview = null, activeEntry = null;
  let txSearch = '', busy = false, conflictState = null;
  let txPeriod={mode:'ytd',month:PF.currentMonth(),year:PF.currentMonth().slice(0,4),start:PF.currentDate().slice(0,4)+'-01-01',end:PF.currentDate()};
  let txFilterError='';
  let bankDraft=null;
  const names = { overview: 'Overview', journal: 'Monthly journal', trends: 'Trends', transactions: 'Transactions', settings: 'Settings' };
  let toastTimer;
  function toast(message) { $('#toast').textContent = message; $('#toast').style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').style.display = 'none', 6500); }
  async function persist() {
    try { await PFVault.save({state, pending, drafts}, config.remember ? accessKey : ''); return true; }
    catch { toast('Device storage is full or unavailable. Export a backup before closing this page.'); return false; }
  }
  const hasPending = () => pending.months.length || pending.transactions.length || Object.keys(pending.mappings).length || Object.hasOwn(pending,'currentBank');
  const dirtyText = () => hasPending() ? 'Changes on this device' : state.updatedAt ? `Synced ${new Date(state.updatedAt).toLocaleDateString('en-IN', { day:'numeric', month:'short' })}` : state.importedAt ? 'Local workbook' : 'Not connected';
  function theme() {
    const dark = config.theme === 'dark' || (config.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#131b18' : '#143b32';
  }
  theme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { theme(); render(); });
  function years() { return [...new Set([PF.currentMonth().slice(0,4), ...state.months.map(r => r.month.slice(0,4))])].sort().reverse(); }
  function selectedRows() { return page==='trends'?PF.journalInRange(state.months,PF.transactionRange(txPeriod)):state.months.filter(r => r.complete && (year === 'all' || r.month.startsWith(year))).sort((a,b) => a.month.localeCompare(b.month)); }
  function yearSelect() { return `<select id="year-select" class="period-select" aria-label="Reporting period">${years().map(y => `<option ${year === y ? 'selected' : ''}>${y}</option>`).join('')}<option value="all" ${year === 'all' ? 'selected' : ''}>All years</option></select>`; }
  function heading(title, sub, actions = '') { return `<div class="page-heading"><div><div class="eyebrow">YOUR PERSONAL FINANCES</div><h1>${title}</h1><p>${sub}</p></div><div class="heading-actions">${actions}</div></div>`; }
  const entryButton = '<button class="button primary" data-action="entry"><span>＋</span> Monthly check-in</button>';
  const metricInfo={
    'Net worth':'Bank balance + portfolio value. A current bank balance updates this card immediately for the current year or All years. Past month-end balances stay unchanged. Portfolio value is the latest recorded snapshot, not a live market price.',
    'Portfolio value':'Total recorded mutual funds, stocks, crypto and FD/RD values. The date below the card tells you when that valuation was recorded; Sync reads your sheet, not live brokerage prices.',
    'Savings rate':'(Income − expenses) ÷ income × 100, across the selected period. This is savings before investment contributions. It can be negative; it is unavailable when total income is zero.',
    'All-time portfolio gain':'Portfolio value − cumulative net invested capital, using the all-time capital figure in your sheet and later recorded contributions minus withdrawals. The percentage is gain ÷ positive net capital. This is a simple cumulative comparison, not an annualized return or XIRR.',
    'Income':'Total monthly journal income for the selected period. Transaction imports do not replace these monthly figures. Investment withdrawals belong in their own field.',
    'Expenses':'Total expenses in the monthly journal for the selected period. Investment contributions and transfers are kept separate.',
    'Investment contributions':'Money added to investments during the selected period, before subtracting investment withdrawals. Contributions are not an expense or a market gain.',
    'Year-to-date portfolio gain':'Closing portfolio − previous December portfolio − contributions + withdrawals. It needs complete recorded cash flows through the valuation month. Its simple percentage divides gain by opening portfolio + contributions; it is not annualized.',
    'Portfolio gain for period':'Closing portfolio − value immediately before the first included month − contributions + withdrawals. Requires consecutive full journal months, confirmed withdrawals, and both boundary valuations. The percentage uses opening value + contributions and is not annualized.',
    'Imported net spending':'Spending from the uploaded transactions in this view, after refunds. Only mapped Need, Want and Other spending rows count. Transfers, investments and income are excluded. Uploads may cover only part of a month.',
    'Needs':'Net spending in your Need categories, including refunds that reduce those expenses. Uses the uploaded transactions and active category mappings for this view.',
    'Wants':'Net spending in your Want categories, including refunds that reduce those expenses. Uses the uploaded transactions and active category mappings for this view.',
    'Categories to review':'Number of uploaded transaction rows in this view without a recognized category mapping. This counts rows, not distinct categories. They are excluded from spending totals until classified.'
  };
  function metric(label, value, note, glyph, highlight = false) {
    const id='metric-help-'+label.toLowerCase().replace(/[^a-z0-9]+/g,'-');
    return `<section class="metric ${highlight ? 'highlight' : ''}"><div class="metric-top"><span>${label}</span><span class="metric-actions"><span class="metric-glyph" aria-hidden="true">${glyph}</span><button type="button" class="metric-info" aria-label="About ${esc(label)}" aria-describedby="${id}" aria-expanded="false">i<span class="metric-tooltip" id="${id}" role="tooltip">${esc(metricInfo[label]||'Calculated from the records in the selected period.')}</span></button></span></div><div class="metric-value">${value}</div><div class="metric-foot">${note}</div></section>`;
  }
  function bankEditor(){
    if(year!=='all'&&year!==PF.currentMonth().slice(0,4))return '';
    const p=PF.currentNetWorth(state);
    return `<section class="panel bank-editor"><div><h2>Current bank balance</h2><p>Preview net worth as you type. Submit to save your balance to Temp Calc and reuse it next time.</p></div><form class="bank-field" id="bank-submit-form"><label class="field">Bank balance (INR)<input id="current-bank" type="number" inputmode="decimal" min="0" max="1000000000000" step="0.01" required value="${bankDraft??p.bank??''}" placeholder="Enter your current balance" aria-describedby="bank-feedback"></label><button class="button primary small" type="submit" ${busy?'disabled':''}>Submit & sync</button><p id="bank-feedback" class="field-help" aria-live="polite">${bankDraft!==null?'Preview only. Submit to save this balance.':Object.hasOwn(pending,'currentBank')?'Saved locally; awaiting sync to Temp Calc.':p.bankUpdatedAt?'Using your last saved balance.':p.bank!=null?'Using the latest recorded bank balance.':'Enter a balance to complete your net worth.'}</p></form></section>`;
  }
  function updateBankMetric(){
    if(page!=='overview'||!$('#current-bank'))return;
    const preview=bankDraft===null?state:{...state,currentBank:{amount:bankDraft===''?null:Number(bankDraft)}};
    const p=PF.currentNetWorth(preview),card=$('#main .metrics .metric');
    if(!card)return;
    card.querySelector('.metric-value').textContent=PF.money(p.netWorth);
    card.querySelector('.metric-value').setAttribute('aria-live','polite');
    card.querySelector('.metric-foot').textContent=p.value==null?'Add a portfolio snapshot to calculate net worth':p.bank==null?'Enter your current bank balance':`Bank ${PF.money(p.bank)} + portfolio ${PF.money(p.value)} · portfolio as of ${PF.monthLabel(p.asOf)}`;
    const balanceInsight=$('#main .insight-list .insight:last-child');
    if(balanceInsight&&p.bank!=null&&p.value!=null){balanceInsight.querySelector('h3').textContent='Current balance, recorded portfolio';balanceInsight.querySelector('p').textContent=`Net worth combines your bank balance with the portfolio recorded for ${PF.monthLabel(p.asOf)}. Monthly historical balances stay unchanged.`;}
    else if(balanceInsight){balanceInsight.querySelector('h3').textContent='Complete your balance picture';balanceInsight.querySelector('p').textContent=p.value==null?'Add a portfolio snapshot to combine with your bank balance.':'Enter your current bank balance to calculate net worth. Monthly historical balances stay unchanged.';}
  }
  function panelHeader(title, sub, right = '') { return `<div class="panel-header"><div><h2>${title}</h2><p>${sub}</p></div>${right}</div>`; }
  function insight(title, body, icon = '↗') { return `<div class="insight"><span class="insight-icon" aria-hidden="true">${icon}</span><div><h3>${title}</h3><p>${body}</p></div></div>`; }
  function dueBanner() {
    const due = PF.dueMonth(state.months);
    const now=PF.currentMonth(),date=new Date(`${now}-01T12:00:00Z`);date.setUTCMonth(date.getUTCMonth()+1);
    const opens=date.toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Kolkata'});
    const banner=due ? `<div class="status-banner warning"><p><strong>${PF.monthLabel(due, true)} needs a check-in.</strong><br>Start here, then complete each missing month in order.</p><button class="button secondary small" data-action="entry">Complete month ↗</button></div>` : `<div class="status-banner"><p><strong>You’re up to date.</strong> History through October 2026 is already closed.<br>Your ${PF.monthLabel(now,true)} check-in opens on ${opens}.</p></div>`;
    return banner+(page==='overview'?bankEditor():'');
  }
  function welcome() {
    return heading('A clearer picture starts here.', 'Your monthly journal, with room to see the bigger picture.') + `<section class="panel welcome-panel"><div class="empty-state"><div class="empty-symbol">↗</div><div class="eyebrow">WELCOME TO PERFIN</div><h2>Bring your money into perspective.</h2><p>Connect your Google Sheet or import your existing workbook.<br>Your history becomes the starting point for your next chapter.</p><div class="empty-actions"><a class="button primary" href="#settings">Connect Google Sheet ↗</a><button class="button secondary" data-action="workbook">Import PerFin.xlsx</button><input type="file" id="welcome-workbook" accept=".xlsx,.xls" hidden></div><p>Financial data stays on this device and in your private Google Sheet.</p></div><div class="welcome-details"><div><b>01 &nbsp; A monthly rhythm</b><p>Income, expenses, investments and a balance check. Everything you already track.</p></div><div><b>02 &nbsp; The trends that matter</b><p>Understand your cash flow, savings and portfolio over time.</p></div><div><b>03 &nbsp; A closer look at spending</b><p>Import transactions when you want category-level answers.</p></div></div></section>`;
  }
  function rowsTable(rows, full = false) {
    return `<div class="table-wrap"><table><thead><tr><th>Month</th><th class="numeric">Income</th><th class="numeric">Expenses</th><th class="numeric">Invested</th><th class="numeric">Cash surplus</th>${full ? '<th class="numeric">Net worth</th>' : ''}<th>Status</th><th><span class="screen-reader">Actions</span></th></tr></thead><tbody>${rows.map(r => `<tr><td class="table-month">${PF.monthLabel(r.month)}</td><td class="numeric">${PF.money(r.income)}</td><td class="numeric">${PF.money(r.expense)}</td><td class="numeric">${PF.money(r.investment)}</td><td class="numeric ${PF.cashSurplus(r) < 0 ? 'negative' : 'positive'}">${PF.money(PF.cashSurplus(r))}</td>${full ? `<td class="numeric">${PF.money(r.bank != null && r.portfolio ? r.bank + PF.portfolioTotal(r.portfolio) : null)}</td>` : ''}<td><span class="status-pill ${pending.months.some(p=>p.month===r.month)?'pending':''}">${pending.months.some(p=>p.month===r.month)?'On device':r.source==='sheet'?'From sheet':'Complete'}</span></td><td><button class="link-button" data-edit="${r.month}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  function overview() {
    if (!state.months.length) return welcome();
    const rows = selectedRows(), latest = rows.at(-1);
    const through = latest?.month || `${year}-12`;
    const pm = PF.portfolioMetrics(state, through);
    const income = PF.sum(rows,'income'), expense = PF.sum(rows,'expense'), invested = PF.sum(rows,'investment');
    const rate = income ? (income-expense)/income : null;
    const before = rows.at(-2), spendDelta = before?.expense ? latest.expense/before.expense - 1 : null;
    const coverage = rows.length ? `${PF.monthLabel(rows[0].month)} – ${PF.monthLabel(latest.month)}` : 'No completed months';
    return heading('Your money, in perspective.', 'A little clarity for the decisions ahead.', yearSelect()+entryButton) + dueBanner() + `<div class="period-caption">${coverage} · ${rows.length} completed months</div><div class="metrics">${metric('Net worth',PF.money(pm.netWorth),pm.netWorth==null?'Add a bank + portfolio snapshot':`Bank + portfolio · ${PF.monthLabel(pm.asOf)}`,'↗',true)}${metric('Portfolio value',PF.money(pm.value),pm.asOf?`As of ${PF.monthLabel(pm.asOf)}${!pm.bank?' · sheet snapshot':''}`:'No portfolio snapshot yet','◈')}${metric('Savings rate',PF.pct(rate),'Income less expenses, before investing','↗')}${metric('All-time portfolio gain',PF.money(pm.gain),`${PF.pct(pm.gainRate)} · cumulative net-capital basis`,'∿')}</div><div class="grid-main"><section class="panel">${panelHeader('Your cash flow','Income, expenses and investment contributions',`<span class="chip">${year==='all'?'All years':year}</span>`)}<div class="chart-wrap"><canvas id="cash-chart" aria-label="Income, expenses and contributions over time" role="img"></canvas></div><div class="legend"><span style="--swatch:#315b47">Income</span><span style="--swatch:#d2b995">Expenses</span><span style="--swatch:#a6bd84">Investments</span></div></section><section class="panel">${panelHeader('Where your income went','For the selected period')}<div class="flow-summary"><div class="flow-number">${PF.money(income)}</div><p>Total income</p>${flowRow('Expenses',expense,income,'#d2b995')}${flowRow('Investment contributions',invested,income,'#8eaa70')}${flowRow('Cash surplus',income-expense-invested+PF.sum(rows,'withdrawal'),income,'#315b47')}<div class="flow-bottom"><span>Investment withdrawals</span><b>${PF.money(PF.sum(rows,'withdrawal'))}</b></div></div></section></div><div class="grid-main"><section class="panel">${panelHeader('Recent check-ins','Your latest completed months','<a class="button text" href="#journal">View journal ↗</a>')}${rowsTable([...rows].reverse().slice(0,4))}<p class="table-note">Cash surplus = income − expenses − investments + withdrawals. Historical withdrawals may be unrecorded.</p></section><section class="panel">${panelHeader('Worth a closer look','A few things your numbers are saying')}<div class="insight-list">${rate!=null?insight(`${PF.pct(rate)} of income retained`,`${PF.money(income-expense)} remained after expenses, before investment contributions.`):insight('Your next check-in','Add a completed month to start seeing patterns.')}${spendDelta!=null?insight(`Expenses ${spendDelta>=0?'rose':'fell'} ${PF.pct(Math.abs(spendDelta))}`,`${PF.monthLabel(latest.month)} versus ${PF.monthLabel(before.month)}. One-off costs can explain a change.`,'⇄'):''}${pm.netWorth==null?insight('Complete your balance picture','Your sheet has portfolio values, but no current bank balance. Add a monthly snapshot to calculate net worth.','◫'):insight('A snapshot, not an estimate',`Your net worth uses the bank and portfolio values recorded for ${PF.monthLabel(pm.asOf)}.`,'◫')}</div></section></div>${qualityNote()}`;
  }
  function flowRow(label, value, income, color) { return `<div class="flow-row"><div class="flow-row-top"><span>${label}</span><strong>${PF.money(value)}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${income ? Math.max(0,Math.min(100,value/income*100)) : 0}%;background:${color}"></div></div></div>`; }
  function qualityNote() {
    const w = state.warnings || [];
    const gains=page==='trends'?PF.monthlyPortfolioGains(state).filter(r=>PF.monthInRange(r.month,PF.transactionRange(txPeriod))):[];
    return `${gains.length?`<section class="panel" style="margin-bottom:22px">${panelHeader('What your portfolio earned','Between consecutive month-end snapshots, after contributions and withdrawals.')}<div class="table-wrap"><table><thead><tr><th>Month</th><th class="numeric">Contributions</th><th class="numeric">Withdrawals</th><th class="numeric">Investment gain / loss</th></tr></thead><tbody>${gains.slice().reverse().map(r=>`<tr><td>${PF.monthLabel(r.month)}</td><td class="numeric">${PF.money(r.contribution)}</td><td class="numeric">${PF.money(r.withdrawal)}</td><td class="numeric ${r.gain<0?'negative':'positive'}">${PF.money(r.gain)}</td></tr>`).join('')}</tbody></table></div><p class="table-note">Gain = closing portfolio − previous month-end portfolio − contributions + withdrawals.</p></section>`:''}<details class="subtle-note"><summary>About your figures${w.length ? ` · ${w.length} source checks` : ''}</summary><p>Savings are recalculated from the raw monthly amounts. Missing values stay unavailable. Historical portfolio snapshots use the latest populated month in each year as an inferred date; they are not monthly valuations. Annual performance needs complete contributions and withdrawals.</p>${w.length?`<ul>${w.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>`:''}</details>`;
  }
  function journal() {
    const rows = selectedRows();
    return heading('One month at a time.', 'The small habit behind the bigger picture.', yearSelect()+entryButton)+dueBanner()+`<section class="panel">${panelHeader('Monthly journal','Review a month or add its balance snapshot.',`<span class="chip">${rows.length} entries</span>`)}${rows.length?rowsTable([...rows].reverse(),true):'<div class="empty-state"><h2>A fresh page.</h2><p>No completed entries in this period.</p></div>'}<p class="table-note">Past sheet entries count as completed cash-flow logs. Add bank and portfolio values by editing a month. A saved draft does not mark it complete.</p></section>`;
  }
  function trends() {
    const rows = selectedRows();
    if (!rows.length&&!PF.netWorthHistory(state,PF.transactionRange(txPeriod)).length) return heading('See the longer story.', 'Only the trends that help you understand your money.')+transactionFilters()+insightsPanel()+`<section class="panel empty-state"><h2>No recorded history in this range.</h2><p>Journal metrics need complete calendar months. Net-worth history starts from your successful syncs once bank and portfolio values are available.</p></section>`;
    const pm = PF.periodPortfolioGain(state,rows);
    return heading('See the longer story.', 'Patterns in what you earn, keep and grow.')+transactionFilters()+insightsPanel()+`<div class="metrics">${metric('Income',PF.money(rows.length?PF.sum(rows,'income'):null),`${rows.length} recorded months`,'↗')}${metric('Expenses',PF.money(rows.length?PF.sum(rows,'expense'):null),'Excludes investment contributions','↙')}${metric('Investment contributions',PF.money(rows.length?PF.sum(rows,'investment'):null),'Before withdrawals','◈')}${metric('Portfolio gain for period',PF.money(pm.gain),pm.gain==null?'Needs boundary valuations and complete cash flows':`${PF.pct(pm.rate)} simple return, not annualized`,'∿')}</div><div class="two-col"><section class="panel">${panelHeader('Savings rate over time','(Income − expenses) ÷ income. Zero-income months have no rate.')}<div class="chart-wrap tall"><canvas id="savings-chart" role="img" aria-label="Monthly savings rate"></canvas></div></section><section class="panel">${panelHeader('Investment contributions','What you added, and what you withdrew.')}<div class="chart-wrap tall"><canvas id="invest-chart" role="img" aria-label="Investment contributions and withdrawals"></canvas></div></section></div><div class="two-col"><section class="panel">${panelHeader('Net worth over time','Latest successful sync per month: saved bank balance + latest recorded portfolio. Current-month snapshots are included.')}<div class="chart-wrap"><canvas id="worth-chart" role="img" aria-label="Recorded monthly net worth"></canvas></div></section><section class="panel">${panelHeader('Portfolio value & net capital','Source snapshots and monthly valuations, where available.')}<div class="chart-wrap"><canvas id="portfolio-chart" role="img" aria-label="Portfolio values and net invested capital"></canvas></div></section></div>${qualityNote()}`;
  }
  function filteredTransactions() { return PF.transactionsInRange(state.transactions,PF.transactionRange(txPeriod),txSearch); }
  function transactionFilters(){
    const range=PF.transactionRange(txPeriod);
    const txYears=[...new Set([PF.currentMonth().slice(0,4),...state.transactions.map(t=>t.date.slice(0,4)),...state.months.map(r=>r.month.slice(0,4))])].sort().reverse();
    const dateLabel=d=>new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});
    return `<section class="panel transaction-filters" aria-label="Transaction date filters"><div class="transaction-filter-controls"><label class="field">Reporting period<select id="tx-period" class="form-control">${[['ytd','Year to date'],['monthly','Monthly'],['last-month','Last month'],['6-months','Last 6 months'],['2-years','Last 2 years'],['3-years','Last 3 years'],['5-years','Last 5 years'],['yearly','Yearly'],['custom','Custom date range']].map(([v,n])=>`<option value="${v}" ${txPeriod.mode===v?'selected':''}>${n}</option>`).join('')}</select></label>${txPeriod.mode==='monthly'?`<label class="field">Month<input id="tx-period-month" type="month" value="${txPeriod.month}" required></label>`:''}${txPeriod.mode==='yearly'?`<label class="field">Year<select id="tx-period-year" class="form-control">${txYears.map(y=>`<option value="${y}" ${txPeriod.year===y?'selected':''}>${y}</option>`).join('')}</select></label>`:''}${txPeriod.mode==='custom'?`<form id="tx-custom-form" class="custom-date-form"><label class="field">Start date<input id="tx-start-date" type="date" value="${txPeriod.start}" required></label><label class="field">End date<input id="tx-end-date" type="date" value="${txPeriod.end}" required></label><button type="submit" class="button primary">Apply range</button></form>`:''}</div><p class="period-caption">${esc(range.label)} · ${dateLabel(range.start)} – ${dateLabel(range.end)} · ${page==='trends'?'Charts and journal metrics include only complete calendar months fully inside this range; daily totals are not estimated. Net-worth snapshots use their actual sync dates.':'All metrics and spending trends below use this range.'}${page==='transactions'&&txSearch?' Search is also applied.':''}</p><p id="tx-filter-error" class="form-error" role="alert">${esc(txFilterError)}</p></section>`;
  }
  const typeNames = {need:'Need',want:'Want',other:'Other spending',investment:'Investment',withdrawal:'Investment withdrawal',transfer:'Transfer',income:'Income',unmapped:'Needs mapping'};
  function insightsPanel(){
    if(!state.geminiEnabled)return `<section class="panel gemini-panel">${panelHeader('Gemini insights','Disabled for now. No data is sent to Gemini.','<span class="chip">Disabled</span>')}<p class="field-help">Your regular metrics, charts and daily sheet refresh continue to work.</p></section>`;
    const report=state.geminiReport,status=state.geminiStatus;
    const button='<button class="button secondary small" id="gemini-refresh" '+(busy?'disabled':'')+'>Generate insights ↗</button>';
    const intro=report?`${report.start} – ${report.end} · generated ${new Date(report.generatedAt).toLocaleDateString('en-IN')} · ${esc(report.model)}`:'The last six completed months. Generate after syncing your latest entries and transactions.';
    return `<section class="panel gemini-panel">${panelHeader('Your five Gemini insights',intro,button)}<p class="field-help">This monthly report always uses six completed months, independently of the selected chart range. Suggestions are AI-generated; numeric evidence is calculated by the script.</p>${report?`<div class="gemini-grid">${report.insights.map((r,i)=>`<article class="gemini-insight"><span class="chip">${i+1}</span><h3>${esc(r.title)}</h3><p>${esc(r.explanation)}</p><ul>${r.evidence.map(e=>`<li>${esc(e)}</li>`).join('')}</ul><p><strong>Try:</strong> ${esc(r.suggestion)}</p></article>`).join('')}</div>`:'<p class="muted">No Gemini report yet. Add GEMINI_API_KEY in Apps Script Script properties and run runGeminiInsights, or use Generate insights here after updating the bridge. The key stays on Google’s side.</p>'}${status?.code==='error'?`<p class="form-error">Last generation failed: ${esc(status.message)}. The previous successful report is retained.</p>`:''}<p id="gemini-feedback" class="field-help" role="status"></p></section>`;
  }
  async function generateInsights(){
    if(busy)return;
    if(!config.url||!accessKey){toast('Connect your Apps Script bridge first.');return;}
    if(hasPending()){toast('Sync your unsaved changes first so Gemini analyzes the latest sheet data.');return;}
    const button=$('#gemini-refresh'),feedback=$('#gemini-feedback');button.disabled=true;feedback.textContent='Generating from your last six completed months…';
    try{
      const response=await fetch(config.url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},credentials:'omit',redirect:'follow',body:JSON.stringify({key:accessKey,action:'generateInsights'}),signal:AbortSignal.timeout(60000)});
      const result=await response.json();if(!result.ok)throw Error(result.error||'Update the Apps Script bridge to enable Gemini insights.');
      if(result.state){state.geminiReport=result.state.geminiReport;state.geminiStatus=result.state.geminiStatus;state.geminiReports=result.state.geminiReports;await persist();}
      render();const message=result.result?.report?'Gemini insights are ready.':result.result?.message||'Sync shortly to retrieve the latest report.';if($('#gemini-feedback'))$('#gemini-feedback').textContent=message;toast(message);
    }catch(err){feedback.textContent=err.name==='TimeoutError'?'Generation is still running on Google. Sync shortly to retrieve its result.':err.message;}
    finally{if($('#gemini-refresh'))$('#gemini-refresh').disabled=false;}
  }
  function transactions() {
    const rows = filteredTransactions(), a = PF.expenseAnalysis(rows,state.mappings);
    const range=PF.transactionRange(txPeriod);
    const top = a.categories[0];
    const txMonths = [...new Set(rows.map(t=>t.date.slice(0,7)))].sort();
    const first = rows.length?rows.map(t=>t.date).sort()[0]:null, last=rows.length?rows.map(t=>t.date).sort().at(-1):null;
    const period = first?`Uploaded rows: ${first} to ${last}`:'No uploaded transactions match this period.';
    const reconciliation = txPeriod.mode==='monthly'&&!txSearch ? state.months.find(r=>r.month===txPeriod.month) : null;
    let comparison = '';
    const comparisonMonths=txMonths.filter(m=>{const r=PF.transactionRange({mode:'monthly',month:m});return r.start>=range.start&&r.end<=range.end;});
    const changes=PF.spendingChanges(rows.filter(t=>comparisonMonths.includes(t.date.slice(0,7))),state.mappings);
    if(changes?.increases.length){const c=changes.increases[0];comparison+=insight(`${esc(c.category)} increased most`,`${PF.money(c.increase)} more in uploaded ${PF.monthLabel(changes.current)} rows than ${PF.monthLabel(changes.previous)}. Upload coverage may differ.`,'↗');}
    if(comparisonMonths.length>=2){const lastM=comparisonMonths.at(-1),prevM=comparisonMonths.at(-2);const x=a.monthly[lastM]||0,y=a.monthly[prevM]||0;if(y>0) comparison+=insight(`Uploaded spending ${x>=y?'increased':'decreased'} ${PF.pct(Math.abs(x/y-1))}`,`${PF.monthLabel(lastM)} versus ${PF.monthLabel(prevM)}. Upload coverage may differ; this is not a complete-month comparison.`,'⇄');}
    return heading('Understand your everyday.', 'A closer look at where your money goes.','<button class="button primary" data-action="csv">＋ Import transactions</button>')+transactionFilters()+`<input type="file" id="csv-upload" accept=".csv,.tsv,.txt" hidden><div class="metrics">${metric('Imported net spending',PF.money(a.total),`${rows.length} transactions in this view`,'↙')}${metric('Needs',PF.money(a.groups.need),'Your essential-spending categories','◫')}${metric('Wants',PF.money(a.groups.want),'Your discretionary categories','◇')}${metric('Categories to review',String(a.unmapped),'Unmapped rows excluded from spending','⇄')}</div><section class="panel transaction-trend">${panelHeader('Spending over time','Uploaded net spending. Missing dates are not assumed zero; * marks partial months.')}<div class="chart-wrap"><canvas id="tx-trend-chart" role="img" aria-label="Net spending over the selected date range"></canvas></div></section><div class="grid-main"><section class="panel">${panelHeader('What makes up your spending',period)}${a.categories.length?a.categories.slice(0,8).map(([name,value])=>`<div class="category"><div class="category-row"><span>${esc(name)}</span><b>${PF.money(value)}</b></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0,value/Math.max(1,top[1])*100)}%"></div></div></div>`).join(''):'<div class="empty-state"><div class="empty-symbol">⇄</div><h2>No spending to show yet.</h2><p>Investment purchases and transfers are excluded from spending. Upload your expense history to see category patterns.</p></div>'}</section><section class="panel">${panelHeader('Spending notes','Grounded in the transactions you imported')}<div class="insight-list">${top?insight(`${esc(top[0])} leads this view`,`${PF.money(top[1])}${a.total>0?`, or ${PF.pct(top[1]/a.total)} of imported net spending`:''}. Positive amounts in expense categories reduce spending as refunds.`):insight('Your cash flow stays separate','Monthly totals remain authoritative. Imports explain spending without replacing your journal.','◫')}${comparison}${insight(`${a.excluded} rows outside spending`,'Income, transfers, investment contributions and investment withdrawals do not count as expenses.','⇄')}${a.unmapped?insight('Some rows need your review','Use category mappings below to classify unfamiliar categories.','?'):''}${reconciliation?insight('Compare with your monthly log',`Journal expenses: ${PF.money(reconciliation.expense)}. Imported net spending: ${PF.money(a.total)}. Difference: ${PF.money(a.total-reconciliation.expense)}. A difference can mean incomplete uploads.`,'≋'):''}</div></section></div><section class="panel">${panelHeader('Transactions','Dates in your export use DD/MM/YYYY.')}<div class="toolbar"><input id="tx-search" placeholder="Search category, note or wallet" aria-label="Search transactions" value="${esc(txSearch)}"></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Type</th><th>Note</th><th class="numeric">Amount</th></tr></thead><tbody>${[...rows].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,100).map(t=>`<tr><td>${esc(t.date)}</td><td>${esc(t.category)}</td><td><span class="status-pill ${PF.classify(t,state.mappings)==='unmapped'?'pending':''}">${typeNames[PF.classify(t,state.mappings)]}</span></td><td title="${esc(t.note)}">${esc(t.note.slice(0,55))}</td><td class="numeric ${t.amount<0?'':'positive'}">${PF.money(t.amount)}</td></tr>`).join('')}</tbody></table></div><p class="table-note">${rows.length>100?'Showing the latest 100 matching rows. All matching rows are included in totals. ':''}Refunds reduce their original spending category. Duplicate detection uses wallet, ID, date, category, amount, currency and note.</p></section><section class="panel section-gap">${panelHeader('Category mappings','A category can mean different things for incoming and outgoing amounts.')}<details><summary>Review and edit mappings</summary>${mappingRows()}</details></section>`;
  }
  function mappingRows() {
    const seen=new Map();state.transactions.forEach(t=>seen.set(`${PF.normalize(t.category)}|${t.amount<0?'-':'+'}`,t));
    return [...seen].sort((a,b)=>a[0].localeCompare(b[0])).map(([key,t])=>`<label class="mapping-row"><span>${esc(t.category)}<small>${t.amount<0?'Outgoing / negative':'Incoming / positive'}</small></span><select class="form-control" data-mapping="${esc(key)}">${Object.entries(typeNames).map(([v,label])=>`<option value="${v}" ${PF.classify(t,state.mappings)===v?'selected':''}>${label}</option>`).join('')}</select></label>`).join('')||'<p>Import transactions to review their mappings.</p>';
  }
  function settings() {
    return heading('Make yourself at home.', 'Your connection, your appearance, your data.')+`<div class="settings-grid"><section class="panel">${panelHeader('Connect your Google Sheet','Pair this device with your private Apps Script bridge.')}<form id="connection-form" class="stack"><label class="field">Apps Script deployment URL<input id="script-url" type="url" required placeholder="https://script.google.com/macros/s/…/exec" value="${esc(config.url)}"></label><label class="field">Private access key<input id="access-key" type="password" required autocomplete="off" value="${esc(accessKey)}" placeholder="From Apps Script → Project Settings"></label><label class="check-label"><input id="remember-key" type="checkbox" ${config.remember?'checked':''}>Remember the access key on this device. Otherwise it lasts only for this browser session.</label><div><button class="button primary" type="submit">Save connection & sync ↗</button></div><p class="form-error" id="connection-error" role="alert"></p></form><details><summary>How to connect</summary><ol><li>Open your Google Sheet, then Extensions → Apps Script.</li><li>Add Code.gs, Core.gs and Workbook.gs from the project's generated Apps Script folder.</li><li>Run setupPerFin and authorize with your Google account. Copy PF_ACCESS_KEY from Project Settings → Script properties.</li><li>Deploy as a web app: execute as yourself, access “Anyone”. Requests still require your private key.</li><li>Paste the deployment /exec URL and key above. Never add the key to the repository.</li></ol><p>Full setup, daily trigger, key rotation and deployment instructions are in the project README.</p></details></section><div class="stack"><section class="panel">${panelHeader('Appearance','Comfortable in daylight. Easy after dark.')}<label class="field">Color theme<select id="theme-select" class="form-control">${[['system','Follow device'],['light','Light'],['dark','Dark']].map(([v,n])=>`<option value="${v}" ${config.theme===v?'selected':''}>${n}</option>`).join('')}</select></label></section><section class="panel">${panelHeader('Your data','Local imports stay on this device until you sync.')}<div class="stack"><label class="field">Import existing PerFin workbook<input id="workbook-upload" type="file" accept=".xlsx,.xls"></label><div class="field-help">Reads yearly tabs locally. Replaces imported history, preserving completed app entries and transactions. Does not modify the workbook.</div><button class="button secondary" id="export-backup">Export private backup</button><label class="field">Restore a PerFin backup<input id="backup-upload" type="file" accept=".json"></label><button class="button secondary danger" id="disconnect">Disconnect & forget key</button></div></section><section class="panel">${panelHeader('Sync status','Manual sync keeps you in control.')}<p>${esc(dirtyText())}</p><p>${pending.months.length} monthly entries and ${pending.transactions.length} transactions awaiting sync.</p><p>A daily Google trigger refreshes the source data. Open the app and tap Sync to retrieve it. It never pushes your financial records to GitHub.</p><p class="field-help">This device caches financial records for offline use. The device cache and drafts are encrypted and require your PIN to unlock.</p></section></div></div>`;
  }
  function render() {
    if(document.documentElement.classList.contains('app-locked'))return;
    charts.forEach(c=>c.destroy());charts=[];
    const next=location.hash.slice(1)||'overview';page=Object.hasOwn(names,next)?next:'overview';
    document.querySelectorAll('nav a').forEach(a=>{a.classList.toggle('active',a.dataset.page===page);if(a.dataset.page===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    $('#page-name').textContent=names[page];document.title=`${names[page]} · PerFin`;
    $('#sync-status').textContent=dirtyText();$('#sync-button').disabled=busy;$('#sync-button').innerHTML=busy?'Syncing…':'<span>⟳</span> Sync sheet';
    $('#main').innerHTML=({overview,journal,trends,transactions,settings})[page]();
    $('#main').inert=busy;
    bindPage();renderCharts();
  }
  function chart(id,type,labels,datasets,percent=false) {
    const canvas=document.getElementById(id);if(!canvas)return;
    if(!labels.length){canvas.parentElement.innerHTML=`<div class="chart-fallback">${id==='tx-trend-chart'?'No uploaded transactions match this period.':'Add recorded balance snapshots to see this trend.'}</div>`;return;}
    if(typeof Chart==='undefined'){canvas.parentElement.innerHTML='<div class="chart-fallback">Charts are unavailable. Your figures remain available in the journal.</div>';return;}
    const style=getComputedStyle(document.documentElement),muted=style.getPropertyValue('--muted').trim(),line=style.getPropertyValue('--line').trim();
    charts.push(new Chart(canvas,{type,data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:id!=='cash-chart'&&datasets.length>1,position:'bottom',align:'start',labels:{boxWidth:7,boxHeight:7,usePointStyle:true,pointStyle:'circle',padding:16,color:muted,font:{size:10}}},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${percent?PF.pct(c.raw/100):PF.money(c.raw)}`}}},scales:{x:{grid:{display:false},border:{display:false},ticks:{color:muted,font:{size:9},maxRotation:0,maxTicksLimit:8}},y:{grid:{color:line,drawTicks:false},border:{display:false},ticks:{color:muted,font:{size:9},maxTicksLimit:5,callback:v=>percent?`${v}%`:PF.money(v,true)}}},elements:{point:{radius:labels.length<3?4:2,hoverRadius:5},line:{tension:.2,borderWidth:2},bar:{borderRadius:3,maxBarThickness:24}}}}));
  }
  function renderCharts() {
    const rows=selectedRows(),labels=rows.map(r=>PF.monthLabel(r.month));
    const ds=(label,data,color,extra={})=>({label,data,borderColor:color,backgroundColor:color,...extra});
    if(page==='transactions'){
      const range=PF.transactionRange(txPeriod),transactions=filteredTransactions();
      const days=(new Date(range.end+'T12:00:00Z')-new Date(range.start+'T12:00:00Z'))/86400000;
      const daily=days<=62,totals={};
      transactions.forEach(t=>{const key=daily?t.date:t.date.slice(0,7);if(!Object.hasOwn(totals,key))totals[key]=0;if(['need','want','other'].includes(PF.classify(t,state.mappings)))totals[key]-=t.amount;});
      const periods=Object.keys(totals).sort();
      const display=periods.map(d=>{if(daily)return new Date(d+'T12:00:00Z').toLocaleDateString('en-IN',{day:'numeric',month:'short',timeZone:'Asia/Kolkata'});const bounds=PF.transactionRange({mode:'monthly',month:d});return PF.monthLabel(d)+(bounds.start<range.start||bounds.end>range.end?'*':'');});
      chart('tx-trend-chart','line',display,[ds(daily?'Daily net spending':'Monthly net spending',periods.map(d=>totals[d]),'#7c9e63')]);
    }
    if(page==='overview'){chart('cash-chart','bar',labels,[ds('Income',rows.map(r=>r.income),'#315b47'),ds('Expenses',rows.map(r=>r.expense),'#d2b995'),ds('Investments',rows.map(r=>r.investment),'#a6bd84')]);}
    if(page==='trends'){
      chart('savings-chart','line',labels,[ds('Savings rate',rows.map(r=>r.income?(r.income-r.expense)/r.income*100:null),'#7c9e63')],true);
      chart('invest-chart','bar',labels,[ds('Contributions',rows.map(r=>r.investment),'#315b47'),ds('Withdrawals',rows.map(r=>r.withdrawal),'#d2b995')]);
      const balances=PF.netWorthHistory(state,PF.transactionRange(txPeriod));
      chart('worth-chart','line',balances.map(r=>PF.monthLabel(r.month)),[ds('Net worth',balances.map(r=>r.netWorth),'#7c9e63')]);
      const periods=[...new Set([...state.annual.map(a=>a.asOf),...state.months.filter(r=>r.portfolio).map(r=>r.month)])].filter(m=>PF.monthInRange(m,PF.transactionRange(txPeriod))).sort();
      const metrics=periods.map(m=>PF.portfolioMetrics(state,m));
      chart('portfolio-chart','line',periods.map(m=>PF.monthLabel(m)),[ds('Portfolio value',metrics.map(p=>p.value),'#7c9e63'),ds('Net capital (sheet basis)',metrics.map(p=>p.gain==null?null:p.value-p.gain),'#bfa784',{borderDash:[4,4]})]);
    }
  }
  function bindPage() {
    $('#gemini-refresh')?.addEventListener('click',generateInsights);
    updateBankMetric();
    document.querySelectorAll('.metric-info').forEach(button=>{
      button.addEventListener('click',()=>{const open=button.getAttribute('aria-expanded')!=='true';document.querySelectorAll('.metric-info').forEach(b=>b.setAttribute('aria-expanded','false'));button.setAttribute('aria-expanded',String(open));});
      button.addEventListener('keydown',e=>{if(e.key==='Escape'){button.setAttribute('aria-expanded','false');button.blur();}});
    });
    $('#current-bank')?.addEventListener('input',e=>{
      const field=e.target,feedback=$('#bank-feedback');
      try{
        const record={amount:field.value===''?null:Number(field.value),updatedAt:new Date().toISOString()};
        PF.validateCurrentBank(record);
        if(!field.validity.valid)throw Error('Enter a valid bank balance with up to two decimal places.');
        bankDraft=field.value;updateBankMetric();
        feedback.textContent='Preview only. Submit to save this balance to Temp Calc.';
      }catch(err){feedback.textContent=err.message;}
    });
    $('#bank-submit-form')?.addEventListener('submit',async e=>{
      e.preventDefault();const field=$('#current-bank');
      try{
        if(!field.value||!field.validity.valid)throw Error('Enter a valid bank balance, including zero if appropriate.');
        const record={amount:Number(field.value),updatedAt:new Date().toISOString()};PF.validateCurrentBank(record);
        state.currentBank=record;pending.currentBank=record;bankDraft=null;
        if(!await persist())return;
        if(config.url&&accessKey)await sync();else{render();toast('Balance saved locally. Connect your sheet and sync to save it to Temp Calc.');}
      }catch(err){$('#bank-feedback').textContent=err.message;}
    });
    $('#year-select')?.addEventListener('change',e=>{year=e.target.value;render();});
    document.querySelectorAll('[data-action="entry"]').forEach(b=>b.addEventListener('click',()=>openEntry()));
    document.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>openEntry(b.dataset.edit)));
    $('[data-action="workbook"]')?.addEventListener('click',()=>$('#welcome-workbook').click());
    $('#welcome-workbook')?.addEventListener('change',e=>importWorkbook(e.target.files[0]));
    $('#workbook-upload')?.addEventListener('change',e=>importWorkbook(e.target.files[0]));
    $('[data-action="csv"]')?.addEventListener('click',()=>$('#csv-upload').click());
    $('#csv-upload')?.addEventListener('change',e=>previewCSV(e.target.files[0]));
    $('#tx-period')?.addEventListener('change',e=>{txPeriod.mode=e.target.value;txFilterError='';render();});
    $('#tx-period-month')?.addEventListener('change',e=>{try{PF.transactionRange({...txPeriod,month:e.target.value});txPeriod.month=e.target.value;render();}catch(err){$('#tx-filter-error').textContent=err.message;}});
    $('#tx-period-year')?.addEventListener('change',e=>{txPeriod.year=e.target.value;render();});
    $('#tx-custom-form')?.addEventListener('submit',e=>{e.preventDefault();try{const next={...txPeriod,start:$('#tx-start-date').value,end:$('#tx-end-date').value};PF.transactionRange(next);txPeriod=next;txFilterError='';render();}catch(err){$('#tx-filter-error').textContent=err.message;}});
    $('#tx-search')?.addEventListener('input',e=>{const pos=e.target.selectionStart;txSearch=e.target.value;render();$('#tx-search').focus();$('#tx-search').setSelectionRange(pos,pos);});
    document.querySelectorAll('[data-mapping]').forEach(el=>el.addEventListener('change',async()=>{state.mappings[el.dataset.mapping]=el.value;pending.mappings[el.dataset.mapping]=el.value;await persist();render();toast('Mapping saved on this device. Sync to save it to Temp Calc.');}));
    $('#theme-select')?.addEventListener('change',e=>{config.theme=e.target.value;localStorage.setItem(CONFIG,JSON.stringify(config));theme();render();});
    $('#connection-form')?.addEventListener('submit',async e=>{e.preventDefault();const url=$('#script-url').value.trim();if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)){$('#connection-error').textContent='Use the deployed Apps Script /exec URL.';return;}config.url=url;config.remember=$('#remember-key').checked;accessKey=$('#access-key').value.trim();localStorage.setItem(CONFIG,JSON.stringify(config));await PFVault.setSessionKey(config.remember?'':accessKey);await persist();await sync();});
    $('#export-backup')?.addEventListener('click',exportBackup);
    $('#backup-upload')?.addEventListener('change',e=>restoreBackup(e.target.files[0]));
    $('#disconnect')?.addEventListener('click',async()=>{accessKey='';await PFVault.setSessionKey('');config.url='';localStorage.setItem(CONFIG,JSON.stringify(config));await persist();render();toast('Disconnected. Your local records are still available.');});
  }
  function openEntry(month) {
    if(document.documentElement.classList.contains('app-locked'))return;
    const now=PF.currentMonth();
    const due=PF.dueMonth(state.months);
    if(!month&&!due){toast(`You’re up to date. ${PF.monthLabel(now,true)} opens for completion on the first day of next month. Edit earlier entries from the journal.`);return;}
    month=month||due;
    if(due&&month>due){toast(`Complete ${PF.monthLabel(due)} first.`);month=due;}
    activeEntry=month;
    const existing=state.months.find(r=>r.month===month),draft=drafts[month],r=draft||existing||{};
    const p=r.portfolio||{};
    const field=(id,label,value)=>`<label class="field">${label}<input name="${id}" type="number" inputmode="decimal" min="0" max="1000000000000" step="0.01" required value="${value??''}" placeholder="0"></label>`;
    $('#entry-title').textContent=`Close ${PF.monthLabel(month,true)}.`;
    $('#entry-description').textContent=PF.dueMonth(state.months)===month?'This month must be completed before you can record a later month.':'Use balances as of the end of this month. Enter 0 for unused asset classes.';
    $('#entry-fields').innerHTML=`<label class="field">Month<input name="month" type="month" required value="${month}" max="${new Date(Date.UTC(Number(now.slice(0,4)),Number(now.slice(5))-2,1)).toISOString().slice(0,7)}"></label><div class="form-section">Money in & out <span class="muted">· INR</span></div><div class="form-grid">${field('income','Income',r.income)}${field('expense','Expenses',r.expense)}${field('investment','Investment contributions',r.investment)}${field('withdrawal','Investment withdrawals',r.withdrawal??0)}</div><div class="form-section">Month-end portfolio values</div><div class="form-grid">${field('mf','Mutual funds',p.mf)}${field('stocks','Stocks / Smallcase',p.stocks)}${field('crypto','Crypto',p.crypto??0)}${field('fd','FD / RD',p.fd??0)}</div><div class="form-section">Bank balance</div>${field('bank','Total across your bank accounts',r.bank)}<p class="field-help">Investments are contributions, not expenses. Withdrawals are cash received from selling investments. Enter bank and portfolio values from the same month end.</p>`;
    $('#entry-error').textContent='';$('#entry-dialog').showModal();
    $('#entry-form [name="month"]').addEventListener('change',e=>{const m=e.target.value;$('#entry-dialog').close();openEntry(m);});
  }
  function entryData() {
    const f=new FormData($('#entry-form')),n=k=>f.get(k)===''?null:Number(f.get(k));
    return {month:f.get('month'),income:n('income'),expense:n('expense'),investment:n('investment'),withdrawal:n('withdrawal'),bank:n('bank'),portfolio:{mf:n('mf'),stocks:n('stocks'),crypto:n('crypto'),fd:n('fd')},complete:true,source:'app',updatedAt:new Date().toISOString()};
  }
  $('#entry-form').addEventListener('submit',async e=>{
    e.preventDefault();try{const r=entryData();PF.validateMonth(r,state.months);state.months=state.months.filter(x=>x.month!==r.month).concat(r).sort((a,b)=>a.month.localeCompare(b.month));pending.months=pending.months.filter(x=>x.month!==r.month).concat(r);delete drafts[r.month];const ok=await persist();$('#entry-dialog').close();render();if(ok)toast(`${PF.monthLabel(r.month)} completed on this device. Tap Sync to save to your sheet.`);maybePrompt(true);}catch(err){$('#entry-error').textContent=err.message;}
  });
  $('#save-draft').addEventListener('click',async()=>{drafts[activeEntry]={...entryData(),complete:false};if(await persist()){$('#entry-dialog').close();toast('Encrypted draft saved on this device. The month still needs completion.');}});
  document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  async function importWorkbook(file) {
    if(!file)return;
    if(config.url){toast('Your connected Google Sheet is the persistent source. Disconnect first to use a workbook as a local fallback.');return;}
    try{
      if(file.size>20*1024*1024)throw Error('Workbook must be smaller than 20 MB.');
      const imported=PFWorkbook.read(XLSX.read(await file.arrayBuffer(),{type:'array'}),XLSX);
      if(!imported.months.length)throw Error('No usable yearly tabs were found. Expected tabs such as 2021 and 2026 with your existing PerFin layout.');
      const appEntries=state.months.filter(r=>r.source==='app');
      imported.months=imported.months.filter(r=>!appEntries.some(a=>a.month===r.month)).concat(appEntries).sort((a,b)=>a.month.localeCompare(b.month));
      state={...state,months:imported.months,annual:imported.annual,warnings:imported.warnings,importedAt:imported.importedAt};
      await persist();render();toast(`Imported ${imported.months.length} monthly entries locally. Source workbook unchanged.`);maybePrompt();
    }catch(e){toast(`Workbook import failed: ${e.message}`);}
  }
  async function previewCSV(file) {
    if(!file)return;try{
      if(file.size>10*1024*1024)throw Error('Transaction file must be smaller than 10 MB. Split larger exports.');
      preview=PF.importTransactions(await file.text(),state.transactions);
      const counts={};preview.transactions.forEach(t=>{const k=typeNames[PF.classify(t,state.mappings)];counts[k]=(counts[k]||0)+1;});
      $('#import-preview').innerHTML=`<p class="muted">${esc(file.name)}</p><div class="import-stats"><span><strong>${preview.transactions.length}</strong> new</span><span><strong>${preview.duplicates}</strong> duplicates</span><span><strong>${preview.errors.length}</strong> invalid</span></div><div class="summary-inline">${Object.entries(counts).map(([n,c])=>`<span>${n}: <b>${c}</b></span>`).join('')}</div>${preview.errors.length?`<p class="form-error">Fix invalid rows and upload again. Nothing will be imported from this file until all rows are valid.</p><ul class="import-errors">${preview.errors.slice(0,20).map(e=>`<li>${esc(e)}</li>`).join('')}</ul>`:''}<div class="table-wrap section-gap"><table><thead><tr><th>Date</th><th>Category</th><th class="numeric">Amount</th></tr></thead><tbody>${preview.transactions.slice(0,6).map(t=>`<tr><td>${t.date}</td><td>${esc(t.category)}</td><td class="numeric">${PF.money(t.amount)}</td></tr>`).join('')}</tbody></table></div><p class="table-note">Only the preview above is shown; all ${preview.transactions.length} new valid transactions will be imported. Investment and transfer rows are kept for reference and excluded from spending.</p>`;
      $('#confirm-import').disabled=!!preview.errors.length||!preview.transactions.length;$('#import-dialog').showModal();
    }catch(e){toast(e.message);}
  }
  $('#confirm-import').addEventListener('click',async()=>{if(!preview||preview.errors.length)return;state.transactions.push(...preview.transactions);pending.transactions.push(...preview.transactions);const count=preview.transactions.length;preview=null;await persist();$('#import-dialog').close();render();toast(`Imported ${count} transactions on this device. Tap Sync to save them to Temp Calc.`);});
  async function sync() {
    if(busy)return;
    if(!config.url||!accessKey){location.hash='settings';toast('Connect your Apps Script URL and private access key first.');return;}
    busy=true;render();
    try{
      const response=await fetch(config.url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},redirect:'follow',credentials:'omit',body:JSON.stringify({key:accessKey,action:'sync',baseRevision:state.revision||0,mutations:pending}),signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw Error(`Google returned HTTP ${response.status}. Check your web app deployment.`);
      let result;try{result=await response.json();}catch{throw Error('The deployment did not return JSON. Use /exec and deploy with access set to Anyone.');}
      if(!result.ok){
        if(result.code==='CONFLICT'&&result.state){showConflict(result.state);throw Error('Sync paused for review. Your local edits are safe.');}
        throw Error(result.error||'Sync failed.');
      }
      if(!result.state||!Array.isArray(result.state.months)||!Array.isArray(result.state.transactions))throw Error('Invalid sync response; local changes were kept.');
      const bankPending=Object.hasOwn(pending,'currentBank'),localBank=pending.currentBank;
      const bankSupported=result.features?.includes('current-bank-balance');
      state=result.state;pending={months:[],transactions:[],mappings:{}};
      if(bankPending&&!bankSupported){state.currentBank=localBank;pending.currentBank=localBank;}
      await persist();toast(bankPending&&!bankSupported?'Other records synced. Bank balance stays on this device until you update the Apps Script bridge.':!result.features?.includes('monthly-net-worth-snapshots')?'Synced. Update the Apps Script bridge to enable monthly net-worth snapshots.':result.netWorthSnapshot?.recorded?`Synced. ${PF.monthLabel(result.netWorthSnapshot.month)} net worth saved.`:result.netWorthSnapshot?.message||'Synced. Your latest figures are ready.');
    }catch(e){toast(e.name==='TimeoutError'?'Sync timed out. Local changes were kept; try again.':e.message==='Failed to fetch'?'Could not reach Apps Script. Check the deployment access, connection and /exec URL. Local changes were kept.':e.message);}
    finally{busy=false;render();maybePrompt();}
  }
  $('#sync-button').addEventListener('click',sync);
  function showConflict(remote){
    conflictState=remote;
    const describe=r=>r?`${PF.money(r.income)} income · ${PF.money(r.expense)} expenses · ${PF.money(r.investment)} invested · ${PF.money(r.withdrawal)} withdrawn · ${PF.money(r.bank)} bank · ${PF.money(PF.portfolioTotal(r.portfolio))} portfolio`:'No saved entry';
    $('#conflict-preview').innerHTML=pending.months.map(local=>`<div class="subtle-note section-gap"><b>${PF.monthLabel(local.month)}</b><p>Sheet: ${esc(describe(remote.months.find(r=>r.month===local.month)))}</p><p>Your device: ${esc(describe(local))}</p></div>`).join('')+`<p class="table-note">${pending.transactions.length} local transactions will be merged with duplicate detection. ${Object.keys(pending.mappings).length} local mappings will replace the corresponding sheet mappings.</p>`+Object.entries(pending.mappings).map(([k,v])=>`<p class="field-help">${esc(k)}: sheet ${esc(remote.mappings[k]||'automatic')} → your device ${esc(v)}</p>`).join('');
    if(Object.hasOwn(pending,'currentBank'))$('#conflict-preview').insertAdjacentHTML('beforeend',`<p class="subtle-note">Current bank balance: sheet ${PF.money(remote.currentBank?.amount)} → your device ${PF.money(pending.currentBank.amount)}.</p>`);
    $('#conflict-dialog').showModal();
  }
  $('#resolve-conflict').addEventListener('click',async()=>{
    if(!conflictState)return;
    state=conflictState;conflictState=null;
    if(Object.hasOwn(pending,'currentBank'))state.currentBank=pending.currentBank;
    pending.months.forEach(r=>{state.months=state.months.filter(x=>x.month!==r.month).concat(r);});
    const known=new Set(state.transactions.map(PF.transactionKey));pending.transactions.forEach(t=>{if(!known.has(PF.transactionKey(t))){state.transactions.push(t);known.add(PF.transactionKey(t));}});
    Object.assign(state.mappings,pending.mappings);await persist();$('#conflict-dialog').close();sync();
  });
  $('#theme-toggle').addEventListener('click',()=>{config.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';localStorage.setItem(CONFIG,JSON.stringify(config));theme();render();});
  function exportBackup(){const blob=new Blob([JSON.stringify({format:'perfin-backup-v1',state,pending},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`perfin-private-${PF.currentMonth()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Private backup exported. Keep it outside your public repository.');}
  async function restoreBackup(file){if(!file)return;try{
    if(file.size>30*1024*1024)throw Error('Backup is too large.');
    const data=JSON.parse(await file.text());
    if(data.format!=='perfin-backup-v1'||data.state?.version!==1||!Array.isArray(data.state.months)||!Array.isArray(data.state.transactions)||!Array.isArray(data.state.annual)||!data.state.mappings)throw Error('Not a valid PerFin backup.');
    data.state.transactions.forEach(PF.validateTransaction);
    if(data.state.months.some(r=>!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)||!['income','expense','investment'].every(k=>typeof r[k]==='number'&&Number.isFinite(r[k])&&r[k]>=0)))throw Error('Invalid monthly records.');
    if(!confirm('Replace the records on this device with this backup? Export your current data first if needed. Your Google Sheet will not be changed.'))return;
    state=data.state;pending=data.pending||{months:[],transactions:[],mappings:{}};await persist();render();toast('Backup restored locally. Existing sync revision is preserved.');maybePrompt(true);
  }catch(e){toast(`Restore failed: ${e.message}`);}}
  let prompted=null,lastCalendarMonth=PF.currentMonth(),lastCalendarDate=PF.currentDate();
  function maybePrompt(force=false){const due=PF.dueMonth(state.months);if(due&&(force||prompted!==due)&&!document.querySelector('dialog[open]')){prompted=due;openEntry(due);}}
  function checkCalendar(){const now=PF.currentMonth(),today=PF.currentDate(),monthChanged=now!==lastCalendarMonth;if(today!==lastCalendarDate){lastCalendarDate=today;lastCalendarMonth=now;render();if(monthChanged)maybePrompt(true);}}
  window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);checkCalendar();});
  document.addEventListener('click',e=>{if(!e.target.closest('.metric-info'))document.querySelectorAll('.metric-info').forEach(b=>b.setAttribute('aria-expanded','false'));});
  window.addEventListener('focus',checkCalendar);setInterval(checkCalendar,30000);
  $('#lock-button').addEventListener('click',()=>PFVault.lock());
  await PFVault.setSessionKey(config.remember?'':accessKey);
  if(!await persist())return;
  localStorage.removeItem(STORE);localStorage.removeItem('perfin.key');sessionStorage.removeItem('perfin.key');oldDraftKeys.forEach(k=>localStorage.removeItem(k));
  document.documentElement.classList.remove('app-locked');
  render();maybePrompt();
  if(location.protocol!=='file:'&&'serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();





