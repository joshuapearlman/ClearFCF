# Clear FCF Screener

A from-scratch, Vercel-ready normalized free-cash-flow idea screener. Multiple market universes (S&P 500, S&P 400 MidCap, Small-Cap, Full SEC Directory, Yahoo Discovery) generate candidates; official SEC Company Facts provide six to ten years of annual financial evidence.

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
