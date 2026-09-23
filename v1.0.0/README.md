# Clear FCF Screener

A from-scratch, Vercel-ready normalized free-cash-flow idea screener. Multiple market universes (S&P 500, S&P 400 MidCap, Small-Cap, Full SEC Directory, Yahoo Discovery) generate candidates; official SEC Company Facts provide six to ten years of annual financial evidence.

The website and Mac app share this same codebase. Changes pushed to GitHub continue to deploy to the website through Vercel, while a new Mac build can be created from the same version whenever needed.

SEC requests default to ClearFCF's monitored contact address and are throttled to five requests per second per server process. For hosted deployments, set `SEC_CONTACT_EMAIL` to a monitored address, or set the complete `SEC_USER_AGENT` value (for example, `ClearFCF/1.0 owner@example.com`).

## Running the Mac app

From the `v1.0.0` folder:

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

It includes SEC-sourced historical changes and margins, explicit revenue-growth and EBIT-margin forecast methods, walk-forward backtesting, editable Bear/Base/Bull forecasts, an EBIT-based FCFF DCF, calculated or manual WACC, perpetuity-growth and exit-multiple terminal values, sensitivity analysis, earnings-quality and capital-allocation diagnostics, consistency checks, and locally saved forecast snapshots.

To create a distributable Apple-silicon Mac build:

```sh
pnpm build:mac
```

The packaged app is written to the `dist` folder. Public distribution without macOS security warnings requires Apple Developer signing and notarization.

## Automatic Mac app synchronization

Packaged Mac builds check GitHub Releases for updates after launch and download newer versions automatically. When an update finishes downloading, ClearFCF prompts to restart and install it.

To publish a synchronized Mac release:

```sh
pnpm test
npm version patch --no-git-tag-version
git commit -am "Release v1.0.1"
git tag v1.0.1
git push origin main --tags
```

The `.github/workflows/mac-release.yml` workflow runs on `v*` tags, builds the Mac app, publishes it to the GitHub release, and uploads the updater metadata consumed by the app. Set `CLEARFCF_DISABLE_UPDATES=1` before launching the app to skip update checks during local packaged-build testing.

## What it includes
- **Selectable Screening Universes**: S&P 500 (Large Cap), S&P 400 (Mid Cap), Small-Cap Value (~500+), Full SEC Operating Universe (~4,000+), or Yahoo Discovery lists
- **Stop-and-Resume Market Scans**: Scan the selected universe continuously, stop after any completed batch, and resume later without losing results
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
