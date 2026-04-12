# /metals-report — Performance Report Generator

Generate daily, weekly, or monthly trading performance reports.
Formatted for Asana dispatch, export to HTML/JSON/XLSX.

## Usage
```
/metals-report daily
/metals-report weekly
/metals-report monthly
/metals-report --format html
```

## Instructions

### Step 1: Determine Period
- **daily**: Last 24 hours of trading activity
- **weekly**: Last 7 calendar days
- **monthly**: Last 30 calendar days
- Default: daily

### Step 2: Gather Data
Use `PositionManager.getPerformanceStats()` and filter by period:
- Trade history with P&L
- Equity curve
- Win rate, profit factor, Sharpe, Sortino
- Drawdown timeline
- Exposure breakdown

### Step 3: Report Sections

**1. Executive Summary**
- Period return ($ and %)
- Starting vs ending capital
- Number of trades, win rate
- Best/worst day

**2. Market Conditions**
- Dominant regimes per metal during period
- Average volatility
- Notable events (circuit breakers, regime changes)

**3. Performance by Metal**
| Metal | Trades | Win Rate | P&L | Avg Hold |
|-------|--------|----------|-----|----------|
| XAU   | XX     | XX%      | $XX | Xh       |
| XAG   | XX     | XX%      | $XX | Xh       |
| XPT   | XX     | XX%      | $XX | Xh       |
| XPD   | XX     | XX%      | $XX | Xh       |

**4. Performance by Strategy**
| Strategy | Trades | Win Rate | P&L |
|----------|--------|----------|-----|
| Trend    | XX     | XX%      | $XX |
| Mean Rev | XX     | XX%      | $XX |
| Arb      | XX     | XX%      | $XX |
| Flow     | XX     | XX%      | $XX |

**5. Risk Metrics**
- Max drawdown during period
- VaR accuracy (predicted vs actual)
- Circuit breaker events
- Largest single loss

**6. Signal Quality**
- Signals generated vs hit rate
- Best performing signal source
- Worst performing signal source

**7. Compliance**
- AED 55K threshold events
- Sanctions screening results
- Regulatory filings generated

### Step 4: Export Formats
Use `tradingDailyReport.ts` generators:
- **Asana**: `formatAsanaTaskNotes()` → dispatch to TRADING project
- **HTML**: `formatHTMLReport()` → standalone file
- **JSON**: `formatJSONReport()` → machine-readable

### Step 5: Asana Dispatch
Create task in appropriate section:
- Daily → Daily Reports
- Weekly → Performance Tracking
- Monthly → Performance Tracking

Regulatory basis: FDL No.10/2025 Art.24 (5yr retention)

## Category
System & Tools

## Icon
Performance Report
