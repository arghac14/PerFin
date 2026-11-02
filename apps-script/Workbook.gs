/* Workbook reader used by the browser and the local inspection script. */
const PFWorkbook = (() => {
  function read(workbook, xlsx, now = PF.currentMonth()) {
    const state = PF.emptyState();
    const warnings = [];
    const number = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
    workbook.SheetNames.filter(n => /^20\d{2}$/.test(n)).sort().forEach(name => {
      const grid = xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null, raw: true });
      const cell = (r, c) => grid[r - 1]?.[c - 1];
      let lastMonth = null;
      for (let i = 1; i <= 12; i++) {
        const month = `${name}-${String(i).padStart(2, '0')}`;
        if (month >= now) continue;
        const income = number(cell(i + 4, 2)), investment = number(cell(i + 4, 4)), expense = number(cell(i + 4, 5));
        if (income == null && investment == null && expense == null) continue;
        if (!(income || investment || expense)) continue; // Template zeros are not completion flags.
        if ([income, investment, expense].some(v => v == null)) { warnings.push(`${month}: incomplete monthly figures; skipped.`); continue; }
        // Existing history is accepted; new months require an explicit app submission.
        const row = { month, income, investment, expense, withdrawal: null, portfolio: null, bank: null, complete: month < PF.TRACKING_START, source: 'sheet' };
        state.months.push(row); lastMonth = month;
        const saved = number(cell(i + 4, 3));
        if (saved != null && Math.abs(saved - PF.cashSurplus(row)) > 1) warnings.push(`${month}: sheet savings differ by ${PF.money(saved - PF.cashSurplus(row))}; savings recalculated from income, expense and investment.`);
      }
      const legacy = Number(name) === 2021;
      const portfolio = number(cell(33, legacy ? 3 : 5));
      const investedAllTime = number(cell(33, legacy ? 2 : 3));
      if (lastMonth && portfolio != null) state.annual.push({ year: Number(name), asOf: lastMonth, portfolio, investedAllTime, source: 'sheet', dateInferred: true });
    });
    state.warnings = warnings;
    state.importedAt = new Date().toISOString();
    return state;
  }
  return { read };
})();
if (typeof module !== 'undefined') module.exports = PFWorkbook;
