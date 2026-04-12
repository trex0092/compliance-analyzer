# /price-alert — Weaponized Price Alert Setup

Configure intelligent price alerts that go beyond simple thresholds.
Volatility-adjusted, pattern-aware, with auto-suggested trade actions.

## Usage
```
/price-alert XAU above 2400
/price-alert XAG below 28.50
/price-alert XAU breakout
/price-alert ratio 85
/price-alert XPT volume-spike
```

## Instructions

### Step 1: Parse Alert Type
Determine which of the 18 alert categories to configure:

| Alert Type | Trigger | Example |
|---|---|---|
| PRICE_TARGET | Price hits level | XAU above $2,400 |
| PRICE_BREAKOUT | Breaks support/resistance | XAU breakout |
| SPREAD_WIDENING | Bid-ask widens | XAU spread > 8 bps |
| VOLUME_ANOMALY | Volume spike | XAG volume > 3x avg |
| FLOW_TOXICITY | VPIN > 70% | XAU toxic flow |
| SMART_MONEY_MOVE | Institutional divergence | XPT smart money |
| GOLD_SILVER_RATIO | G/S ratio extreme | Ratio > 85 |
| REGIME_CHANGE | Market regime shifts | XAU trending → ranging |
| STOP_HUNT | Stop-loss hunting detected | XAU stop hunt |
| CORRELATION_BREAK | Metal correlation breaks | XAU-XAG decorrelation |
| ARBITRAGE_WINDOW | Arb opportunity appears | LBMA-DMCC spread |
| CIRCUIT_BREAKER | Risk limit triggered | Daily loss limit |
| RISK_LIMIT_BREACH | Risk metric exceeded | VaR breach |
| MARGIN_CALL | Margin approaching call | Drawdown > 15% |
| PATTERN_COMPLETE | TA pattern completes | Double bottom |
| LIQUIDITY_DRY | Depth drops sharply | Top-of-book < 50 oz |
| POSITION_EXPIRY | Position nearing expiry | GTD order expiring |
| SANCTIONS_COUNTERPARTY | Counterparty flagged | Sanctions match |

### Step 2: Configure Parameters
For the selected alert type:
- Metal(s) to monitor
- Threshold value
- Severity: CRITICAL / HIGH / MEDIUM / LOW
- Auto-execute: true/false
- Suggested action (e.g., BUY/SELL order)
- Expiry: when the alert auto-cancels

### Step 3: Validate Against Risk Limits
- Ensure auto-execute alerts won't breach position limits
- Warn if alert would trigger in current market conditions

### Step 4: Register Alert
Add to `AlertWeapon` instance from `alertWeapon.ts`:
- The alert engine evaluates all rules every tick
- Cooldown: 30s between same alert type (prevents spam)
- History maintained for review

### Step 5: Confirm

```
━━━ ALERT CONFIGURED ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Type:     PRICE_TARGET
  Metal:    XAU
  Trigger:  Price above $2,400.00
  Severity: HIGH
  Action:   Notify (manual execution)
  Expiry:   7 days

  Current price: $2,340.50
  Distance: $59.50 (+2.54%)

  Status: ACTIVE — monitoring every tick
```

## Category
Trading

## Icon
Price Alert
