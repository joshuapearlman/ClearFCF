# Clear FCF Screener

**Next application version: 1.2.0**

A from-scratch, Vercel-ready normalized free-cash-flow idea screener. Multiple market universes (S&P 500, S&P 400 MidCap, S&P 600 SmallCap, Full SEC Directory, Yahoo Discovery) generate candidates; official SEC Company Facts provide six to ten years of annual financial evidence.

The website and Mac app share this same codebase. Changes pushed to GitHub continue to deploy to the website through Vercel, while a new Mac build can be created from the same version whenever needed.

> Vercel uses `v1.1.1` as the production Root Directory. The authoritative release version is the `version` field in `package.json`.

SEC requests default to ClearFCF's monitored contact address and are throttled to five requests per second per server process. For hosted deployments, set `SEC_CONTACT_EMAIL` to a monitored address, or set the complete `SEC_USER_AGENT` value (for example, `ClearFCF/1.0 owner@example.com`).

## Running the Mac app

From the Vercel root folder (`v1.1.1`):

```sh
pnpm install
pnpm app
```

## Financial Deep Analysis

Financial Deep Analysis is integrated into ClearFCF. Start the normal application:

```sh
pnpm start
```

Open a company report, select **Deep Analysis**, then choose **Financial Deep Analysis**. The workspace opens at `/financial-analysis` on the same ClearFCF server and carries the selected ticker automatically. The `pnpm dcf` command remains available as an optional standalone development server on port 3001.

It includes SEC-sourced historical changes and margins; collapsible analysis sections with remembered display preferences; latest-year, 3-year average, 5-year average, median, fade-to-target, and manual forecast methods for D&A, CapEx, and operating-NWC components; explicit revenue-growth and EBIT-margin methods; walk-forward backtesting; editable Bear/Base/Bull forecasts; an EBIT-based FCFF DCF; calculated or manual WACC; perpetuity-growth and exit-multiple terminal values; sensitivity analysis; earnings-quality and capital-allocation diagnostics; consistency checks; and locally saved forecast snapshots.

WACC starting rates now show editable as-of dates. Mark the active case's assumptions reviewed before saving a forecast snapshot or exporting a valuation. **Use rates as my defaults** applies the reviewed risk-free rate and equity risk premium to new models. **Export model JSON** includes all cases, source dates, and the equity bridge. **Save valuation PDF** opens the browser print dialog with a compact valuation report.

## Saved research workspace

The **Watchlist** view supports named lists of up to 200 tickers, per-company review status, thesis and risk notes, and last-reviewed dates. **Rescreen list** saves the latest result and shows changes in price, normalized FCF multiple, decision, and financial period against the prior screen. You can set a per-company rescreen alert for a price or multiple threshold, a screening-status change, or a new financial period; it fires only when you manually rescreen. Result rows and company reports can add a ticker to the current list. Select two to five result rows and choose **Compare** to review them under the same active criteria and lookback, with evidence confidence and source dates beside the valuation metrics.

Scans and watchlists use local IndexedDB where available, with local-storage fallback. Scan progress shows analyzed, pending, and unresolved tickers; transient failures retry with backoff, and **Retry failed** rechecks unresolved symbols. Save failures are shown explicitly. **Export workspace** downloads a versioned JSON backup of the scan, watchlists, AI research, DCF models, and personal WACC defaults. **Import workspace** can add the backup to existing work or replace it after a confirmation. Keep the backup file somewhere you control; ClearFCF has no account-based sync.

International exchange screening remains a gated future pilot. The current SEC-based qualification pipeline covers U.S. equities. The [product roadmap](../docs/clearfcf-app-audit-and-roadmap.md#ambitious-future-features) defines the evidence, source-rights, currency, and exchange-calendar checks required before another market can appear in the Idea Finder.

## Private Mac build

The Mac app is built for local use. It is not uploaded to GitHub Releases or distributed by the build command. Use Node 22 to create Apple Silicon and Intel DMGs. Add the following temporary block to `pnpm-workspace.yaml` so pnpm installs both native Codex executables:

```yaml
supportedArchitectures:
  os:
    - darwin
  cpu:
    - arm64
    - x64
```

Then run:

```sh
pnpm install --frozen-lockfile
pnpm build:mac
```

The two DMGs are written to `dist`. Remove the temporary `supportedArchitectures` block after building so ordinary web installs keep their smaller dependency set. No Apple Developer account is required for a build used only on your own Mac. The package is unsigned, so macOS may require you to approve it when opening it from a downloaded or copied DMG.

The packaged app uses one stable local address, so its saved scans, watchlists, and models remain available after a restart or a manual app update. It does not check GitHub for updates. To update it, build a new DMG and replace the app; export a workspace backup first if you want a separate copy of your research.

## What it includes
- **Selectable Screening Universes**: live, validated S&P 500 (Large Cap), S&P 400 (Mid Cap), and S&P 600 (Small Cap) constituent tables; Full SEC Operating Universe (~4,000+); or Yahoo Discovery lists
- **Complete, Recoverable Market Scans**: Scan the selected universe, stop after a completed batch, resume later, and retry unresolved tickers without silently skipping them
- **Saved Research Workspace**: Named watchlists, company notes, review status, prior-run changes, local backups, and two-to-five-company comparison
- **Adjustable Result Filters and Columns**: Tune display-only thresholds and save the exact result columns you want to see without changing qualification status
- **Equal-Weighted Normalized FCF**: 50/50 blend of simple average annual margin and aggregate volume-weighted margin × latest annual revenue
- **Economic FCF (post-SBC)**: Explicitly tracks Stock-Based Compensation as an ongoing economic compensation expense
- **Routine Intangibles in CapEx**: Includes software development and intangible asset acquisition alongside tangible PP&E
- **Unlevered EV Multiple**: Compares Enterprise Value to Unlevered Normalized FCF (adding back after-tax net interest)
- **Solvency & Near-Term Debt Test**: Flags companies where short-term debt due within 12 months exceeds available cash + annual cash generation
- **Under-Investment Diagnostic**: Compares cumulative CapEx against cumulative Depreciation & Amortization
- **Dividend Safety**: Current and five-year average yield, normalized-FCF payout coverage, dividend growth, and cut detection
- **Shareholder Yield**: Combines dividend cash, gross repurchases, and the economic cost of stock compensation
- **Insider Purchase Evidence**: Open-market purchase signals in screening summaries plus recent SEC Form 4 evidence in full reports
- **Historical Valuation Context**: Five-year reported P/FCF observations, percentile context, and 52-week drawdown
- **Configurable ChatGPT-Connected AI Deep Analysis (Mac/Desktop)**: Choose GPT-5.6 Sol, Terra, Luna, or GPT-5.5 plus low through max reasoning effort, then use your ChatGPT sign-in to investigate why a stock may be cheap, current developments, long-term financial history, accounting risks, peers, catalysts, and valuation scenarios with linked sources; no API key required
- **Complete PDF Reports (Mac/Desktop)**: Save the entire company analysis, including completed AI Deep Analysis, directly to a paginated PDF instead of using the system print dialog
- **Complete Result Funnel**: Separate Idea, Review, Excluded, and All tabs retain near-misses and missing-data cases
- **Visible Non-Qualification Reasons**: Every Review or Excluded result shows each failed, missing, or exclusion rule directly in the table, full report, PDF, and CSV export
- **Historical Share Fallbacks**: Prefers annual diluted weighted-average shares, then uses clearly tagged SEC period-end common shares when issuers omit the standard diluted-share concept
- **Decision Explanations & Freshness**: Plain-language result summaries with market, filing-period, and insider-activity dates
- Detailed single-company reports and calculation audits
- Evidence-confidence gating with explicit pass, fail, exclusion, and unknown reasons
- Per-year XBRL provenance (hover an annual period in a company report)
- Working 3-year, 5-year, and full-history screening lookbacks
- Automatic Yahoo fundamentals fallback when SEC blocks a hosted request (clearly labeled as partial-confidence evidence)
- CSV export and local storage persistence

## AI Deep Analysis

Open a company in **Analyze Stock**, select **Deep Analysis**, then choose **AI Deep Analysis**. ClearFCF checks the bundled Codex CLI, opens the official ChatGPT browser sign-in when needed, and runs an ephemeral read-only research job using the displayed model and effort settings. The structured result is validated before display and saved locally for the ten most recently researched tickers.

Select **Save PDF** to choose a destination and export the complete currently displayed analysis. The PDF uses a dedicated A4 layout and includes completed AI Deep Analysis and its linked source list.

AI Deep Analysis is intentionally desktop/local-only because it launches a local executable and reuses locally cached Codex authentication. Hosted Vercel screening continues to work, but its research endpoint returns a desktop-only message. Research output is an aid, not investment advice; verify consequential claims in the linked original sources.
