# ClearFCF App Audit and Product Roadmap

**Audited version:** 1.1.3

**Review date:** November 20, 2026
**Audience:** ClearFCF product owner and developers

ClearFCF already supports a complete path from finding companies with attractive normalized free cash flow to inspecting filing evidence and building a valuation. Its strongest product advantage is that screening decisions expose the underlying calculations and reasons. The next release should protect that trust: make large scans complete and recoverable, recognize real market sessions when checking quote freshness, and make saved work dependable. After those fixes, the opportunity is to turn one-off screens and models into a reusable research workspace, then extend the same evidence standard to markets outside the United States.

> **Implementation update, November 20, 2026:** The 1.2.0 source includes recoverable scans, U.S. session-aware quote freshness, visible save failures, named watchlists, workspace backup and import, side-by-side comparison, manual-rescreen alerts, dated WACC review, valuation export, a pull-request test workflow, and private Apple Silicon and Intel Mac builds with stable local storage. The findings below describe the original 1.1.3 audit. Live international screening remains subject to the pilot gate in this document. The Mac package is local only, and the hosted changes are available in a pull-request preview rather than production.

## Product purpose and current workflow

ClearFCF helps an investor find public companies whose current price may be low relative to normalized free cash flow, then investigate the evidence before forming a view. A typical workflow is to scan an index or the SEC directory, inspect Idea, Review, and Excluded results, open a company report, and continue into AI Deep Analysis or Financial Deep Analysis. The web and Mac apps share the screening and financial analysis codebase. AI research and complete report PDF export require the Mac app. [Product overview](../v1.1.1/README.md) · [Application navigation](../v1.1.1/public/index.html#L25-L40)

## Current capabilities

| Capability | Website | Mac app | Current behavior |
| --- | --- | --- | --- |
| Market discovery and screening | Yes | Yes | S&P 500, S&P 400, S&P 600, full SEC directory, and Yahoo discovery; three screening presets and adjustable criteria. Scans can stop after a batch and resume. [Universe API](../v1.1.1/api/universe.js) · [Scan workflow](../v1.1.1/public/app.js#L1162-L1267) |
| Watchlist screening and result review | Yes | Yes | Paste up to 50 tickers, sort and filter Idea, Review, and Excluded results, choose columns, and export CSV. [Watchlist form](../v1.1.1/public/index.html#L195-L213) · [Result table](../v1.1.1/public/app.js#L425-L575) |
| Company evidence and calculation audit | Yes | Yes | Annual SEC facts, Yahoo market data and selected fallbacks, normalized and economic FCF, valuation, debt, dividends, insider activity, source dates, and explanations for nonqualification. [Analysis engine](../v1.1.1/lib/analysis.js) · [Screening rules](../v1.1.1/public/screening.js) |
| AI Deep Analysis | No | Yes | Locally launches a Codex research job using ChatGPT sign-in; displays linked sources and keeps the ten most recent research reports in local storage. [Research flow](../v1.1.1/README.md#L85-L91) · [Local storage](../v1.1.1/public/app.js#L259-L266) |
| Financial Deep Analysis | Yes | Yes | Historical operating model, forecast methods and backtest, editable Bear/Base/Bull cases, WACC and terminal assumptions, DCF sensitivity, and up to 20 local snapshots per ticker. [Model workspace](../v1.1.1/public/financial-analysis/index.html#L43-L96) · [Snapshots](../v1.1.1/public/financial-analysis/app.js#L641-L687) |
| Complete company report PDF | No | Yes | Mac export prints the displayed report, including completed AI research, to a chosen PDF file. [PDF action](../v1.1.1/public/app.js#L1792-L1817) · [Electron export](../v1.1.1/electron-main.js#L12-L36) |

## Problems and improvement opportunities

The first three findings follow directly from the current implementation. The remaining items are product or delivery gaps. Priority reflects the effect on a user's ability to trust a screen or keep their work, rather than an estimate of implementation time.

| Priority | Finding | User impact | Recommended change |
| --- | --- | --- | --- |
| P1 | **Failed scan tickers are skipped.** The scan increments its cursor for the whole batch, records failed tickers, and resumes after them. A rate-limit pause does not put those tickers back in the queue. [Scan loop](../v1.1.1/public/app.js#L1182-L1224) | A completed universe scan can omit companies while appearing complete. | Track pending, succeeded, and failed tickers separately; retry transient failures with backoff; show unresolved failures and offer a targeted retry. |
| P1 | **Quote freshness treats weekdays as trading sessions.** The freshness check counts Monday through Friday and has no exchange holiday calendar. On Tuesday, September 8, 2026, it classifies a Friday, September 4 quote as stale even though Monday was Labor Day. [Freshness check](../v1.1.1/public/screening.js#L28-L58) | Otherwise qualifying companies can move to Review after a holiday. | Compare the quote with the latest expected US market session, accounting for holidays and early closes; retain the visible quote timestamp. |
| P1 | **Saved work has no reliable recovery path.** Scan persistence catches storage errors without telling the user; the scan record includes the universe and accumulated results. Model saves write directly to local storage and can throw on a quota or disabled-storage error. [Scan save](../v1.1.1/public/app.js#L1118-L1126) · [Model save](../v1.1.1/public/financial-analysis/app.js#L256-L269) | A long scan or edited model may appear saved when it is not, or an edit may be interrupted by a storage exception. | Show save success or failure, reduce duplicated stored data, provide export and import of saved work, and test storage failure. |
| P2 | **The Watchlist view is a one-time batch.** It accepts pasted tickers and renders results, but has no named saved lists, notes, or recheck history. [Watchlist flow](../v1.1.1/public/app.js#L1076-L1116) | Investors must reconstruct their follow-up list and cannot easily see what changed since a prior review. | Add named watchlists with per-company status, notes, last reviewed date, and one-click rescreening. |
| P2 | **DCF starting assumptions can age silently.** The model seeds a fixed 4.25% risk-free rate and 5% equity risk premium; both are editable and their starting-assumption labels are visible. [WACC defaults](../v1.1.1/public/financial-analysis/app.js#L119-L151) | A user can generate a valuation from assumptions that no longer reflect the intended market environment. | Date and surface each assumption, require review before saving a valuation, and let users set reusable personal defaults. |
| P2 | **Automated tests ran only in the original Mac release workflow.** The version 1.1.3 workflow triggered on version tags or manual dispatch, so pull requests and ordinary pushes had no repository CI test gate. | Regressions could reach the main branch before tests ran. | Run the existing Node suite on pull requests and main-branch pushes. |

The website's lack of AI research and complete PDF export is an intentional platform boundary, rather than a broken feature. The interface should continue to state that boundary clearly before a user starts either action. [Hosted research endpoint](../v1.1.1/api/research.js) · [Desktop PDF guard](../v1.1.1/public/app.js#L1792-L1796)

## Product requirements for the next release

### R1 Complete and recoverable scans

**User need:** I can trust that a finished scan considered every ticker, and I can recover the ones that failed without starting over.

- Keep a durable status for every ticker: pending, complete, retrying, or unresolved failure. Save progress after each batch.
- Retry transient 429, timeout, and upstream 5xx failures with bounded exponential backoff. Keep invalid or permanently unavailable tickers in the unresolved list with a reason.
- Define completion as every ticker either analyzed or explicitly unresolved. Show analyzed, unresolved, and total counts separately, and add **Retry failed**.
- Resuming after a reload or a stop must not skip or duplicate a ticker. Test failure, reload, stop, and retry with mocked API responses.

### R2 Accurate market data freshness

**User need:** A stock is not downgraded just because the exchange was closed.

- Use a US exchange session calendar for the expected last session. Compare quote date and time with that session, rather than counting weekdays.
- Keep the quote timestamp and source in the result and report. Distinguish missing price, delayed price, and stale price in the qualification explanation.
- Test weekends, Monday holidays, market closures, early closes, and the period before the next regular close.

### R3 Dependable saved research

**User need:** I know whether a scan, watchlist, research report, or model is saved, and I can carry it to another browser or Mac.

- Show an explicit saved, saving, or save failed state for scans and financial models. A failed write must not claim that work was preserved.
- Let users export and import a versioned local research file containing saved scans, named watchlists, notes, research reports, and DCF cases. Validate imported data and avoid replacing existing work without a clear choice.
- Keep storage local by default. Measure the largest supported scan and research file; if browser storage is insufficient, move large records to IndexedDB or another durable local store.
- Test quota exhaustion, disabled storage, corrupted saved data, and import of a file from an earlier schema version.

### R4 A reusable investor workflow

**User need:** I can move an idea from screen to investigation, track why it interests me, and revisit it after new information appears.

- Save named watchlists. Each entry has ticker, status, a short thesis note, key risk, last review date, and a link to its latest report and DCF case.
- Rescreen a list and show changes in price, normalized FCF multiple, qualification status, and source dates since its last saved run.
- Provide a side-by-side comparison for two to five companies using the same lookback and criteria. Mark metrics with missing or partial-confidence source data.
- Keep actions available from the existing result table and company report so the workflow does not require copying tickers between views.

## Roadmap

The phases are ordered by dependency. They are planning buckets, not promised release dates.

| Phase | Outcome | Scope | Release check |
| --- | --- | --- | --- |
| 1. Trust and recovery | A finished screen is complete and saved work is dependable. | R1, R2, scan and model save states, tests for failures and holidays, PR and main-branch CI. | Every requested ticker is either analyzed or visibly unresolved; holiday quotes retain the correct status; storage failures are visible; automated suite passes. |
| 2. Research workspace | Follow-up work survives sessions and can be moved between devices. | R3 export and import, named watchlists, notes, rescreening, versioned saved data. | A user can save, close, reopen, export, and import a watchlist and model without losing notes or assumptions. |
| 3. Faster comparison | Investors can compare candidates and spot changes. | R4 comparison view, run-to-run changes, source-confidence badges, DCF report export. | A comparison uses consistent criteria and identifies missing evidence; exported valuation includes assumptions and source dates. |
| 4. Monitoring, if useful | Important changes prompt a review. | Optional price or filing change alerts, earnings review reminders, and shared workspaces after the local workflow proves useful. | Users can set a specific trigger, see why it fired, and turn it off. |
| 5. International pilot | A second market meets the same evidence standard as the U.S. screen. | Choose one exchange, build its listing and filing adapters, support local currency and market sessions, and validate the resulting metrics. | The pilot meets the coverage and reconciliation gates below; incomplete companies remain in Review. |

## Ambitious future features

### Screen companies across national exchanges

The long-term vision is a single ClearFCF workspace where an investor can screen a U.S. company alongside companies listed in Canada, the United Kingdom, continental Europe, or Japan, then open each result's original filing and compare its normalized cash generation on a consistent basis. A market selector could support both single-exchange screens and a global operating-company screen, with results shown in the listing's currency or a user-selected comparison currency. This is a proposed direction, not a claim that today's model already produces comparable international results.

The present pipeline starts with SEC company facts and U.S. index lists. Its qualification rules require a USD quote, and its quote freshness check uses New York dates. [SEC data path](../v1.1.1/lib/analysis.js#L650-L680) · [Index universes](../v1.1.1/lib/indices.js#L6-L24) · [Currency gate](../v1.1.1/public/screening.js#L129-L140) Each new exchange therefore needs more than a ticker list:

1. **Issuer and security identity:** Store an exchange identifier, local ticker, regulator or company ID, and share class. Resolve dual listings and depositary receipts so the same business is not counted twice.
2. **Financial evidence:** Retrieve annual statements from the relevant regulator or a licensed provider; map local accounting concepts to revenue, operating cash flow, capital expenditure, stock compensation, debt, cash, and shares. Keep the original concept and filing link beside every mapped value.
3. **Currency and trading sessions:** Keep the statement currency and quote currency separate. Convert values using a documented FX policy appropriate to each metric, and use the listing exchange's holiday calendar and time zone to judge price freshness.
4. **Comparable decisions:** Revalidate the normalization and exclusion rules under each reporting standard. Companies lacking critical evidence stay in Review with a specific reason; the app should not fill gaps with unmarked estimates.

Possible pilot markets are **Canada's TSX and TSX Venture exchanges** and the **London Stock Exchange main market**. Canada's [SEDAR+ service](https://systems.securities-administrators.ca/onlinehelp/faqs/general-faqs-about-filings/) makes continuous disclosures, including financial statements, available through its data distribution service; use of its public data is subject to [separate terms](https://www.securities-administrators.ca/wp-content/uploads/2023/02/SEDAR_Terms_of_Use.pdf). The United Kingdom's [FCA National Storage Mechanism](https://www.fca.org.uk/markets/primary-markets/regulatory-disclosures/national-storage-mechanism) provides access to listed-issuer disclosures and structured annual reports. Neither source alone establishes that ClearFCF can get complete, reusable screening data at the required scale, so source access, rights, identifiers, and metric coverage should decide the first pilot. Later candidates include EU regulated markets such as Euronext Paris, where [ESMA's ESEF framework](https://www.esma.europa.eu/issuer-disclosure/electronic-reporting) defines structured annual reporting, and Japan's Tokyo Stock Exchange, for which [JPX publishes listing data](https://www.jpx.co.jp/english/markets/data-catalog/index.html) and the [FSA documents EDINET](https://disclosure2dl.edinet-fsa.go.jp/guide/static/disclosure/WEEK0060.html). These are source leads to investigate, not committed launch markets.

**Pilot gate:** Before an exchange appears in the Idea Finder, sample at least 30 nonfinancial companies across sectors and sizes. Confirm that at least 90% have five usable annual periods for revenue, operating cash flow, capital expenditure, and share count; manually reconcile a subset of extracted figures to original filings; confirm quote, FX, and calendar behavior; and verify the source's permitted use at planned scale. The 90% threshold is a proposed product standard and can be revised after the pilot. If coverage falls short, offer a clearly labeled discovery or report view without automatic Idea qualification.

### Build on global coverage

- **Global comparison:** Compare companies within a sector across exchanges using both native-currency results and a clearly dated common-currency view. Show accounting framework and evidence confidence beside each metric.
- **Market-specific research:** Let AI Deep Analysis cite original local filings and identify when a translation or secondary summary was used. Keep human-readable source links in the report.
- **Cross-market watchlists and monitoring:** Follow one company across its primary listing and depositary receipts, with filing, price, and currency changes tied to the correct exchange session.
- **Configurable valuation policies:** Let users save assumptions such as FX convention, discount-rate inputs, and reporting-framework adjustments, then include those choices in exported comparisons and DCF reports.

## Measures of success

Track these from the first release that adds the underlying events. Avoid treating a lower Idea count as failure: stricter evidence checks may correctly reduce it.

| Measure | Why it matters | Initial target |
| --- | --- | --- |
| Scan accounting | Prevents silent omissions. | 100% of requested tickers end as analyzed or visibly unresolved. |
| Retry recovery | Shows whether transient upstream failures are recoverable. | Report the share of transient failures resolved by retry; set a target after a baseline. |
| Save reliability | Protects investor work. | 100% of failed saves show an error; no false saved state in tested failure cases. |
| Research continuity | Tests whether the workspace solves a real workflow. | Track the share of saved watchlists reopened or rescreened within 30 days. |
| Evidence review | Checks whether users can validate conclusions. | Track report source-link opens and the share of compared companies with complete source dates. |

## Review basis

This assessment covers version 1.1.3 in the repository and the behavior established by its source and tests. The Node test suite passed **71 of 71 tests** on November 20, 2026. The holiday freshness result was also reproduced directly against the exported screening function. Live SEC and Yahoo availability, a packaged Mac build, and user behavior were outside this code review; the roadmap's effort and adoption assumptions should be updated after those checks and user feedback.
