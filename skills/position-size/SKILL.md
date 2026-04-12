# /position-size — Optimal Position Size Calculator

Calculate the optimal position size using Kelly Criterion,
Fixed Fractional, and Volatility-Adjusted methods.

## Usage
```
/position-size XAU BUY
/position-size XAG SELL stop 28.50
/position-size XPT --risk 2%
```

## Instructions

### Step 1: Gather Inputs
1. Metal and direction (BUY/SELL)
2. Current price from `PriceOracle`
3. Portfolio value from `PositionManager`
4. ATR(14) from `technicalAnalysis.ts`
5. Trade history for Kelly calculation
6. Stop loss distance (user-specified or ATR-based)

### Step 2: Calculate Three Methods

**1. Kelly Criterion** (`kellyPositionSize()`)
```
Kelly f* = (p × b - q) / b
  p = win rate
  b = avg win / avg loss ratio
  q = 1 - p
  
Apply quarter-Kelly (f* × 0.25) for safety
```
- Requires: minimum 20 trades of history
- Output: quantity in troy oz, dollar value

**2. Fixed Fractional** (`fixedFractionalSize()`)
```
Position = (Capital × Risk%) / Stop Distance
  Risk%: 0.5% (conservative) / 1% (standard) / 2% (aggressive)
  Stop Distance: price distance to stop loss
```
- Always works regardless of history
- Output: quantity at each risk level

**3. Volatility-Adjusted** (`volatilityAdjustedSize()`)
```
Position = (Capital × Target Vol%) / ATR(14)
  Target Vol: 1% daily (conservative) / 2% (standard)
```
- Adapts to current market volatility
- Higher ATR = smaller position

### Step 3: Pre-Trade Risk Check
Run `preTradeRiskCheck()`:
- Circuit breaker status
- Position size limits (max 1,000 oz)
- Portfolio exposure limits ($5M)
- Concentration check (max 60% per metal)
- Margin availability
- Size multiplier if circuit breakers active

### Step 4: Recommendation
Take the **minimum** of all three methods for safety.
Apply circuit breaker size multiplier if active.
Adjust for any risk check warnings.

### Step 5: Format Output

```
━━━ POSITION SIZE: XAU BUY ━━━━━━━━━━━━━━━━━━━━━━

  Current Price:  $2,340.50
  ATR(14):        $18.75
  Portfolio:      $100,000
  Stop Loss:      $2,321.75 (ATR × 1.0)

  KELLY CRITERION (quarter-Kelly)
    Full Kelly:  12.4%
    Quarter:     3.1%
    Size:        13 oz ($30,427)
    Risk:        $243 (0.24%)

  FIXED FRACTIONAL
    0.5% risk:   3 oz ($7,022)
    1.0% risk:   5 oz ($11,703)
    2.0% risk:   11 oz ($25,746)

  VOLATILITY-ADJUSTED (1% target)
    Size:        5 oz ($11,703)
    Daily vol:   $93.75 per oz

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  RECOMMENDED:   5 oz ($11,703)
  Method:        Volatility-adjusted (most conservative)
  Risk:          $93.75 (0.09% of portfolio)

  RISK CHECK:    APPROVED
  Warnings:      None
```

## Category
Trading

## Icon
Position Calculator
