# PerFin

A static, mobile-friendly personal finance journal for GitHub Pages. No build-time financial data, paid hosting, runtime CDN, or separate database. The app stores a private device cache and uses your Google Sheet through a small authenticated Apps Script bridge.

## PIN and local privacy

The configured six-digit PIN is required once per browser tab or installed-app session. Reloading, navigating between views, and switching apps do not repeatedly prompt. The Lock button ends the unlocked session immediately. A fresh session requires the PIN again. There is no PIN creation UI. An ephemeral vault key is kept only in sessionStorage so the encrypted cache can be reopened during that session; the plaintext PIN is never retained. The plaintext PIN is stored only in `.private/pin.json`, which is excluded by `.gitignore` and never copied to `dist/`. `scripts/configure-pin.cjs` produces `app/pin-config.js`, containing only a salted PBKDF2 verifier. That derived verifier is safe to include in the static deployment in the sense that it does not contain the plaintext PIN, but a six-digit PIN remains susceptible to offline guessing; a static lock is not account authentication.

The device cache, local drafts and saved bridge key are AES-GCM encrypted with a key derived from the entered PIN using PBKDF2. Existing plaintext local caches migrate after the first successful unlock. The encrypted cache has its own random salt, and each write uses a fresh IV. Failed PIN attempts are throttled locally. The PIN and bridge key are separate: the online endpoint still requires the private high-entropy bridge key. A PIN reset is not offered; keep a private export to recover unsynced data if device storage is lost. Backups are explicitly exported plaintext financial files, never public assets.

The generated public verifier is retained in source so GitHub Pages builds need neither the secret file nor the plaintext PIN. When changing the local secret, run `npm run build` and deploy the updated derived verifier. Existing caches remain encrypted under the old PIN; export a backup before changing it.

## Run locally

Use Node.js **22 or newer**. No `npm install` is required: Chart.js and SheetJS are included locally with their licenses.

```sh
npm start
```

Open `http://127.0.0.1:4173`. Start with **Import PerFin.xlsx** to explore your existing records without connecting Google. The workbook is read entirely in the browser. The original file is never modified or included in a deployment.

The Node installation originally found on this Windows machine was version 14. If it has not been updated, the bundled Node runtime can run the scripts:

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/serve.cjs
```

## Connect Google Sheets

Google sign-in happens during authorization of your Apps Script. The static app uses a device pairing key afterward, so no separately configured OAuth client or Google Cloud project is needed. The sheet remains private.

1. Run `npm run build`. It prepares `dist/` and generates `apps-script/Core.gs` and `apps-script/Workbook.gs` from the shared browser code.
2. Open your existing [PerFin Google Sheet](https://docs.google.com/spreadsheets/d/1WFnpE_lp5tGC-AeR15TxKbE7isUqMnjl7ypV9f9oYl8/edit). Select **Extensions → Apps Script**. Use a script bound to this sheet, not a shared public script project.
3. Replace the default `Code.gs` with the contents of `apps-script/Code.gs`. Create script files named **Core** and **Workbook**, then paste the generated `Core.gs` and `Workbook.gs` contents into them. Apps Script adds the `.gs` suffix automatically.
4. In Apps Script **Project Settings**, enable **Show appsscript.json manifest file in editor**. Replace that manifest with `apps-script/appsscript.json`. Save.
5. Select **setupPerFin** in the function dropdown and click **Run**. Sign in with the Google account that owns the spreadsheet and grant the requested spreadsheet and trigger permissions. Google may show an unverified-app notice for your personal script; inspect the script and consent details yourself before deciding whether to authorize it. The code never needs access to Gmail or your transaction accounts.
6. In **Project Settings → Script properties**, copy **PF_ACCESS_KEY**. It is generated once and is not printed in logs. Do not paste it into this chat or a GitHub file.
7. Select **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Deploy. Copy the URL ending in `/exec`, not the test `/dev` URL.
8. In PerFin **Settings**, paste the deployment URL and access key. Click **Save connection & sync**. The response must say it synced successfully. The first sync reads your yearly tabs; it does not upload the local workbook itself.

“Anyone” makes the bridge endpoint reachable from GitHub Pages; it does **not** make financial records available without the key. All reads and writes require the high-entropy key in an HTTPS POST body. The key has access to this app's financial records, so treat it like a password. It is stored for the browser session unless you explicitly choose to remember it on the device. There is no key, personal workbook, transaction export or financial snapshot in the public static files.

The app uses a simple `text/plain` POST and follows Google's ContentService redirect. A real deployment must be tested in Safari and from the final GitHub Pages origin. Login pages, organization policies or deployment access restrictions can prevent a readable cross-origin response; this repository cannot verify those until your script is deployed. Failed requests retain local changes.

To rotate the key, run **rotateAccessKey** in Apps Script and pair each device again. To update bridge code later, save the new files, then **Deploy → Manage deployments → Edit → New version → Deploy**. Keep the existing `/exec` deployment URL.

## Daily refresh

`setupPerFin` installs one `dailyRefresh` trigger. It refreshes the source rows and saved comparisons around **6–7 AM India time**, including when your laptop is off. Google's scheduled triggers run within a window, not at an exact minute. Run `installDailyRefresh` to reinstall it without duplicating it.

The trigger reads the sheet and updates internal state. Your iPhone retrieves it when you tap **Sync sheet**. It does not run inside a closed iPhone app, obtain live brokerage valuations, submit missing monthly entries, push private data to GitHub, or redeploy the site. Those actions are unnecessary for a data-connected static app.

Google Apps Script quotas apply. This is intended for one person's normal monthly updates and transaction history, not a public multi-user service. You do not need billing for this setup.

## Gemini insights

Gemini produces five evidence-linked observations and suggestions from the last six **completed calendar months**. Running it in November uses May–October, even if some source data is absent; gaps are disclosed. The report lives on Trends and keeps its own six-month reporting window independent of chart filters. The app does not display invented sample Gemini output when no report is available.

### Enable and run immediately

1. Build with `npm run build`.
2. In your existing Apps Script project, update **Code.gs**, **Core.gs**, and **Workbook.gs**. Add **Insights.gs** (generated from `app/insights.js`) and **Gemini.gs** from `apps-script/`.
3. Update **appsscript.json** from this project. It now includes the external-request scope needed to call Gemini.
4. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/api-keys). Keep billing disabled for this project if you require unpaid quota only. Availability and quotas depend on Google; the code never automatically switches to a paid model or enables billing.
5. Gemini is **disabled by default**, as requested. To enable it in the future, add **GEMINI_ENABLED** = `true` and **GEMINI_API_KEY** in Apps Script **Project Settings → Script properties**. A key alone does not enable generation. Do not put the key in the web app, GitHub source, the PIN file, or this chat. Optionally set **GEMINI_MODEL**; the default is `gemini-3.1-flash-lite`, which currently has a free API tier. With Gemini disabled, the daily job still refreshes the sheet but never calls Gemini.
6. Save, then run **setupPerFin** and authorize the new external-request permission. It also installs/replaces the single daily trigger.
7. Update the existing web deployment: **Deploy → Manage deployments → Edit → New version → Deploy**. Keep its URL and access key.
8. Select **runGeminiInsights** and click **Run**. The five insights and their evidence appear immediately in the execution log when the request succeeds. The report is also saved in Temp Calc. Tap **Sync** in PerFin to retrieve it. Later you can use **Generate insights** on Trends after syncing any pending local changes.

### Automation and data handling

The same daily trigger runs around 6–7 AM India time, with the laptop off. It refreshes the sheet, checks a fingerprint of the six-month summary, and generates only if that input or the report window changed. Syncing new monthly entries or transactions also checks generation. There is at most one automatic API attempt per India day, and three total attempts per day including manual requests. An unchanged report is reused. Failures do not erase financial records or the last successful report. A generation already in progress is not duplicated. Keep the page open while requesting a report; if the browser times out, the script may still finish, and Sync retrieves the result afterward.

The payload contains aggregated monthly income/expense/contribution figures, spending groups, category totals and computed evidence. It omits transaction notes, wallet/account names, individual transaction IDs, bank balances and portfolio balances. Category labels are treated as untrusted data rather than instructions. Google processes the submitted summary; its unpaid-service data-use terms still apply. The app does not claim aggregation guarantees anonymity.

Arithmetic, median comparisons and optional reduction scenarios are computed in the script. Gemini must cite known fact IDs, return exactly five insights with distinct primary evidence, and avoid numeric prose; numeric evidence is attached from the script so model-written amounts cannot masquerade as calculated results. Observations still require judgment: uploads can be incomplete, and a pattern is not proof of a subscription or cause. No market picks or medical-care reductions are requested. The latest report and up to twelve monthly report versions are stored in Temp Calc.

No live Gemini request can be verified until a valid key is configured in your Google project. Local tests mock the API and cover missing keys, caching, request limits, failures, evidence validation and concurrent record preservation.

References: [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [data-use terms](https://ai.google.dev/gemini-api/terms), [structured output](https://ai.google.dev/gemini-api/docs/structured-output), [Apps Script URL fetch](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app).

## Data and monthly workflow

- **Read-only source:** numeric yearly worksheet names, such as `2021` through `2026`, using the uploaded PerFin layout. It reads income from B5:B16, investment contributions from D5:D16 and expenses from E5:E16. Source savings formulas are not trusted: savings are recalculated.
- **App-owned storage:** only **Temp Calc H:K**, marked `PERFIN_STATE_V1`. Existing contents in A:G are preserved. Setup refuses to claim H:K if they already contain unrelated data. Records are stored as kind / key / JSON / timestamp. It stores monthly submissions, completion status, annual source snapshots, transactions, category mappings and revision metadata.
- **Imported history:** nonzero cash-flow rows through October 2026 count as completed history and need not be retroactively supplied with bank balances. From November 2026 onward, source rows prefill the form but are not marked submitted until the app check-in is completed. All-zero template rows and missing figures do not represent a submission. Explicit app submissions can represent genuine zero-income/zero-expense months.
- **Monthly check-in:** enter the previous completed month's income, expenses, contributions, withdrawals, portfolio values (mutual funds, stocks, crypto, FD/RD) and bank balance. Enter zero for unused asset classes. Missing current-year months must be completed in order before a later month can be submitted. The reminder can be closed; the ordering rule remains enforced on the client and server. Current and future months cannot be completed.
- **Tracking start and backlog:** January–October 2026 are already closed history. New check-ins start with November 2026, due on December 1 in India time. The app does not create invented historical financial rows. It prompts for the oldest overdue month and immediately advances to the next after submission, through the last completed month. Missing November/December submissions remain due after January 1; yearly reporting resets its display without erasing the backlog. Month changes are checked while the app stays open as well as on reopening.
- **Save and sync:** Complete saves on the device and queues the entry. Sync writes it to Temp Calc. Drafts are local only and do not complete a month. App-owned entries take precedence over the corresponding yearly sheet rows; other rows continue refreshing from the source. Editing source cells for an app-owned month does not silently replace an app entry.
- **Online source:** the connected Google Sheet and Temp Calc are the persistent data store. The XLSX is a one-time local import/fallback, never an automatically read database. Once a bridge URL is configured, workbook imports are blocked until you disconnect, so an old file cannot overwrite the connected view. The first successful sync fetches the online source; local cache is for offline access and queued edits only.
- **Multiple devices:** writes use a lock and revision check. If another device has saved first, PerFin shows both sets of monthly figures. Review them before explicitly reapplying local changes. Transaction merges remove exact duplicates. Sync cannot overwrite a newer revision silently.
- **Backups:** Settings exports and restores private JSON backups, including local unsynced changes. Backups do not contain the connection key. Keep them outside the public repository. A restored backup retains its sync revision and follows normal conflict review.

## Calculations and limits

### Net worth saved on each sync

Every successful authenticated Sync records the **current India calendar month** in Temp Calc using the latest saved bank balance plus latest available recorded portfolio. Subsequent syncs in the same month update that one snapshot; earlier months are preserved. The stored record includes the actual sync date/time, bank amount, portfolio amount, net worth, and portfolio source month. Missing bank/portfolio values prevent a snapshot rather than creating a zero. These derived snapshots do not submit monthly forms or rewrite journal entries.

Trends combines saved sync snapshots with any older complete monthly balance records, using the sync snapshot when both exist for a month. Date filters use each snapshot's actual capture date, so YTD and Monthly can display the current month before its journal is closed. Multi-year and completed-month presets retain their stated date ranges. Each point is the month's latest successful sync, not a guaranteed month-end balance. The first record starts with the next successful Sync after updating and redeploying **Code.gs** and **Core.gs**; unavailable past balances are not fabricated. Daily background source refresh alone does not create a snapshot.

The Overview has a **Current bank balance** input. Typing previews current net worth immediately using the latest recorded portfolio; it does not alter month-end journal entries or historical charts. Use **Submit & sync** to commit the balance and save it to Temp Calc through the connected bridge. The last saved balance is loaded automatically on the next visit and after Sync. Unsubmitted typing is only a preview. If offline or disconnected, submission is retained in the encrypted cache for a later Sync. It is shown for the current year and All years. Zero is a valid submitted balance. Each metric also has an info control explaining its formula, source and limitations; hover/focus on desktop or tap on a phone.

For an existing deployed bridge, replace `Code.gs` and generated `Core.gs`, then **Deploy → Manage deployments → Edit → New version → Deploy** to enable saving the current balance online. The endpoint reports this capability. Until it is updated, other records can still sync and the current bank balance remains safely queued on the device; the UI explains that it has not yet been saved online.

- **Savings before investing:** income − expenses. **Savings rate:** (income − expenses) / income. Zero-income months have no savings-rate percentage.
- **Cash surplus:** income − expenses − investment contributions + investment withdrawals. Historical source rows do not record withdrawals; cash surplus for those rows is shown using recorded flows, with that limitation stated.
- **Net worth:** bank balance + total portfolio, from the same recorded month-end snapshot. Missing bank data means net worth is unavailable. The workbook's legacy net worth, PF and emergency fund formulas are not used as a substitute.
- **All-time portfolio gain:** portfolio value − cumulative net invested capital, anchored to the source's all-time invested figure and adjusted by contributions and withdrawals after that snapshot. The percentage is relative to positive net capital. This is a simple capital-basis comparison, not XIRR or an annualized return. Historical manual adjustments in the source capital figure are retained. When editing contributions or withdrawals in a month at or before a source capital anchor, update the source cumulative invested basis as appropriate; the app does not reconstruct unknown historical cost bases.
- **Year-to-date portfolio gain:** current value − previous December value − current-year contributions + current-year withdrawals. It is available only when all months through that valuation have recorded withdrawal amounts (including confirmed zeros). Its simple percentage uses opening value + contributions as the denominator. It is not a time-weighted, money-weighted or annualized performance measure.
- **Historical portfolio dates:** the workbook has one portfolio snapshot per yearly tab, not monthly valuation history. Its latest populated cash-flow month is used as an *inferred* snapshot date. This is disclosed in the app. Monthly net-worth and portfolio history accumulate from new month-end entries; missing historical balances are not invented.
- **Source discrepancies:** the supplied workbook contains inconsistent savings formulas in July and October 2026. The app flags those differences without changing the workbook.

## Transaction imports and category rules

CSV and tab-separated `.csv`/`.tsv` exports work. Required columns: `Date`, `Category`, `Amount`; optional: `Id`, `Currency`, `Note`, `Wallet`. Dates support `DD/MM/YYYY` and `YYYY-MM-DD`. Currency defaults to INR; other currencies are rejected rather than silently converted. Commas in quoted amounts, quoted notes and multiline notes are supported.

Every import has a preview. Invalid rows prevent the whole import until corrected. Duplicate identity uses wallet, ID, date, category, amount, currency and note. If you edit a transaction in the source app and re-export it, it may look like a distinct record; inspect the preview rather than assuming changed transactions can be reconciled automatically.

The mappings from the supplied images are included. Need and Want categories are spending. Investment purchases are contributions, not spending. `Investment Withdrawal` and positive entries in investment categories default to investment withdrawals. `Withdrawal` and incoming/outgoing transfers are transfers. Positive amounts in spending categories are refunds. `Investment on skills` is a Need expense. Unrecognized categories are visibly unmapped and excluded from spending until you classify them. Mappings can be overridden separately for incoming and outgoing amounts—for example if positive `Stocks` entries represent dividends rather than redemptions.

Monthly journal totals remain authoritative. Imports explain the recorded transactions and do not overwrite those totals. The transaction month filter compares imported spending with journal expenses. Uploads can cover partial months, so comparisons describe uploaded rows and do not assume complete account coverage. No budgets, emergency-fund tracking or allocation charts are included.

Transactions opens with **Year to date**, from January 1 through today's India date. The reporting-period filter also supports **Monthly** (choose a month), **Yearly** (choose an imported year), and **Custom date range** (inclusive start/end dates, applied together). Trends and Transactions share this reporting-period selection; Overview and Monthly journal keep their own yearly selector. All transaction metrics, category rankings, spending notes, trend points and table rows use the same range and search. Short ranges chart daily uploaded net spending; longer ranges chart monthly uploaded net spending. No missing upload dates are fabricated as zero. Asterisks mark month buckets clipped by the chosen date range. Month-to-month notes use only full months inside the range, with incomplete-upload caveats. Monthly journal reconciliation appears only in Monthly mode with no active search. These filters are client-side and need no Apps Script redeployment.

Both Transactions and Trends share the selected period and now also offer **Last month**, **Last 6 months**, **Last 2 years**, **Last 3 years** and **Last 5 years**. These presets use complete calendar months through the end of last month (for example, Last 6 months in November covers May–October). Trends uses only whole journal months fully inside the selected range; it does not prorate monthly totals for partial custom dates. Overview and Monthly journal retain their own yearly selector. The transaction table displays only the latest **100** matching rows; all matching records still count in metrics, category analysis and trend calculations.

## Deploy to GitHub Pages

1. Create a GitHub repository and push this source to its `main` branch. Do not add workbooks, transaction exports, backups, keys, or `.private/`. Review files before pushing.
2. In the repository **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. The included `.github/workflows/pages.yml` runs tests, builds the static app, and publishes **only `dist/`**. No npm dependencies need installation. Repository-subpath hosting is supported: assets and the manifest use relative paths.
4. Open the deployed URL and pair the device in Settings. The Pages site code can be public while the Google Sheet and authenticated data remain private.
5. On your iPhone, open the deployed URL in Safari → Share → **Add to Home Screen**. Launch it from the new icon, then pair it there if Safari uses a separate storage context. After the first successful load, the application shell and cached records are available offline. Sync still needs internet.

Repository: [arghac14/PerFin](https://github.com/arghac14/PerFin). The Pages workflow publishes changes pushed to `main`. Each device must be paired with your Apps Script deployment in the app's Settings; connection keys and financial records are never included in the published app.

## Validation

```sh
npm test
npm run build
```

Tests cover India-time cutoffs, month ordering, zero versus missing inputs, withdrawal-aware returns, refunds, CSV/TSV parsing, duplicate transactions, bad dates/currencies, workbook formula discrepancies, authentication, storage boundaries and sync revision conflicts. Apps Script service behavior is tested with local mocks; a live Google deployment and real iPhone Home Screen installation remain integration checks.

## Libraries and references

- Chart.js 4.5.1, MIT: `vendor/Chart.LICENSE.md`. [Installation](https://www.chartjs.org/docs/latest/getting-started/installation/)
- SheetJS CE 0.20.3, Apache 2.0: `vendor/SheetJS.LICENSE`. [Official standalone distribution](https://docs.sheetjs.com/docs/getting-started/installation/standalone/)
- Google: [Apps Script web apps](https://developers.google.com/apps-script/guides/web), [ContentService redirects](https://developers.google.com/apps-script/guides/content), [installable time triggers](https://developers.google.com/apps-script/guides/triggers/installable)
- GitHub: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)


