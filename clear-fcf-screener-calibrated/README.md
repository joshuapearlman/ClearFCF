# Clear FCF Screener

A from-scratch, Vercel-ready normalized free-cash-flow idea screener. Yahoo Finance changing lists generate possible ideas; official SEC Company Facts provide six to ten years of annual financial evidence.

## What it includes
- Automatic progressive idea finder using six changing Yahoo screener lists
- Manual comma-, space-, or line-separated screening for up to 50 tickers
- Detailed single-company reports
- **Equal-Weighted Normalized FCF**: 50/50 blend of simple average annual margin and aggregate volume-weighted margin × latest annual revenue
- **Economic FCF (post-SBC)**: Explicitly tracks Stock-Based Compensation as an ongoing economic compensation expense
- **Routine Intangibles in CapEx**: Includes software development and intangible asset acquisition alongside tangible PP&E
- **Unlevered EV Multiple**: Corrects the EV/FCF mismatch by comparing Enterprise Value to Unlevered Normalized FCF (adding back after-tax net interest)
- **Solvency & Near-Term Debt Test**: Flags companies where short-term debt due within 12 months exceeds available cash + annual cash generation
- **Under-Investment Diagnostic**: Compares cumulative CapEx against cumulative Depreciation & Amortization
- Stop/resume through browser storage
- CSV export
- No database and no npm dependencies
