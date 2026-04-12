# /risk-check — Portfolio Risk Dashboard

Full risk assessment of your trading portfolio.
Circuit breakers, VaR, drawdown, concentration, margin, and position-level P&L.

## Usage
```
/risk-check
/risk-check XAU
/risk-check --detailed
```

## Instructions

### Step 1: Load Portfolio
1. Get portfolio from `PositionManager.getPortfolio()`.
2. Get all positions via `getAllPositions()`.
3. Mark-to-market with latest quotes from `PriceOracle`.

### Step 2: Compute Risk Metrics
Run `computeRiskMetrics()` from `positionManager.ts`:

- **VaR (1d, 95%)** — max expected loss in 1 day at 95% confidence
- **VaR (5d, 95%)** — 5-day horizon
- **Conditional VaR** — expected shortfall beyond VaR
- **Sharpe Ratio** — risk-adjusted return (annualized)
- **Sortino Ratio** — downside-adjusted return
- **Max Drawdown** — peak-to-trough decline
- **Win Rate** — % of profitable trades
- **Profit Factor** — gross profit / gross loss
- **Kelly Fraction** — optimal bet size
- **Volatility 30d** — annualized 30-day volatility

### Step 3: Circuit Breaker Status
Check `CircuitBreakerEngine` from `riskMatrix.ts`:

| Breaker | Threshold | Action if triggered |
|---|---|---|
| DAILY_LOSS | $25,000 | HALT_TRADING |
| DRAWDOWN | 10% | REDUCE_SIZE |
| VOLATILITY_SPIKE | 3x normal | REDUCE_SIZE |
| RAPID_LOSS | 3 consecutive | HALT_TRADING |
| CORRELATION_BREAK | 0.3 shift | ALERT_ONLY |

### Step 4: Concentration Analysis
- Exposure by metal (XAU, XAG, XPT, XPD)
- Exposure by venue (LBMA, COMEX, DMCC, etc.)
- HHI concentration index
- Flag any metal > 60% concentration limit

### Step 5: Position-Level Detail (if --detailed)
For each open position:
- Metal, venue, side, quantity
- Entry price, current price
- Unrealized P&L ($ and %)
- Stop loss, take profit levels
- Days held

### Step 6: Format Output

```
━━━ RISK DASHBOARD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  PORTFOLIO VALUE
    Market Value:    $XXX,XXX
    Cash Balance:    $XXX,XXX
    Margin Used:     $XX,XXX
    Buying Power:    $XXX,XXX

  P&L
    Daily:   $X,XXX  |  Weekly: $X,XXX  |  Monthly: $X,XXX
    Total:   $X,XXX (+X.XX%)

  VALUE AT RISK
    VaR (1d, 95%):  $X,XXX
    VaR (5d, 95%):  $X,XXX
    CVaR:            $X,XXX

  RATIOS
    Sharpe:    X.XX  |  Sortino: X.XX
    Win Rate:  XX%   |  Profit Factor: X.XX
    Kelly:     X.X%  |  Volatility: XX.X%

  DRAWDOWN
    Current:   $X,XXX (X.X%)
    Maximum:   $X,XXX (X.X%)

  CIRCUIT BREAKERS
    [OK] Daily Loss:  $X / $25,000
    [OK] Drawdown:    X.X% / 10%
    [OK] Vol Spike:   X.Xx / 3.0x
    [OK] Rapid Loss:  X / 3
    [OK] Correlation:  X.X / 0.3

  CONCENTRATION
    XAU: XX% | XAG: XX% | XPT: XX% | XPD: XX%
    HHI: 0.XX [LOW / MODERATE / HIGH]
```

## Category
Risk Management

## Icon
Risk Dashboard
