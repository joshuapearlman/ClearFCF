# Clear FCF Screener

A from-scratch, Vercel-ready normalized free-cash-flow idea screener. Multiple market universes (S&P 500, S&P 400 MidCap, Small-Cap, Full SEC Directory, Yahoo Discovery) generate candidates; official SEC Company Facts provide six to ten years of annual financial evidence.

The website and Mac app share this same codebase. Changes pushed to GitHub continue to deploy to the website through Vercel, while a new Mac build can be created from the same version whenever needed.

## Running the Mac app

From the `v1.0.0` folder:

```sh
pnpm install
pnpm app
```

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
- **"Skip Previously Reviewed" Toggle & Reset**: Remembers dismissed ideas in browser storage so every scan yields fresh candidates, with an instant one-click history reset
- **Quick Action Buttons**: "✕ Pass" button on each row to dismiss ideas from future runs
- **Equal-Weighted Normalized FCF**: 50/50 blend of simple average annual margin and aggregate volume-weighted margin × latest annual revenue
- **Economic FCF (post-SBC)**: Explicitly tracks Stock-Based Compensation as an ongoing economic compensation expense
- **Routine Intangibles in CapEx**: Includes software development and intangible asset acquisition alongside tangible PP&E
- **Unlevered EV Multiple**: Compares Enterprise Value to Unlevered Normalized FCF (adding back after-tax net interest)
- **Solvency & Near-Term Debt Test**: Flags companies where short-term debt due within 12 months exceeds available cash + annual cash generation
- **Under-Investment Diagnostic**: Compares cumulative CapEx against cumulative Depreciation & Amortization
- Detailed single-company reports and calculation audits
- CSV export and local storage persistence
