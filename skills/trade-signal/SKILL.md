# /trade-signal — AI Signal Fusion Trade Recommendation

Get an AI-powered trade recommendation with multi-signal fusion,
conviction scoring, and risk-adjusted position sizing.

## Usage
```
/trade-signal XAU
/trade-signal XAG BUY
/trade-signal XPT 4h
```

## Instructions

When this skill is invoked, follow these steps:

### Step 1: Initialize Brain
1. Create `MetalsTradingBrain` from `src/services/metalsTrading/metalsTradingBrain.ts`.
2. Run `brain.tick()` to populate all subsystems with fresh data.
3. Identify the target metal (default: XAU if not specified).

### Step 2: Generate Signals
Run all signal generators from `signalFusion.ts`:

1. **Technical Signal** — `generateTechnicalSignal()`
   - MA alignment, RSI, MACD, Bollinger, Stochastic, Ichimoku
   - Output: direction, confidence, reasoning

2. **Flow Signal** — `generateFlowSignal()`
   - Smart money direction, trade flow imbalance, VPIN
   - Output: direction, confidence, reasoning

3. **Microstructure Signal** — `generateMicrostructureSignal()`
   - Order book imbalance, large trade activity, VPIN
   - Output: direction, confidence, reasoning

4. **Pattern Signal** — `generatePatternSignal()`
   - Double bottom, breakout, engulfing candles
   - Output: direction, confidence, pattern name

### Step 3: Fuse Signals
Call `fuseSignals()` with regime-adjusted weights:

- **Trending regime**: boost technical & pattern weights
- **Ranging regime**: boost microstructure & flow weights
- **Volatile regime**: boost flow, reduce pattern weight
- **Breakout regime**: boost technical & flow

Report the `FusedDecision`:
- Direction (BUY/SELL)
- Conviction (0-100%)
- Signal alignment (% of signals agreeing)
- Entry, target, stop loss
- Risk/Reward ratio
- Expected value

### Step 4: Position Sizing
Calculate optimal size using three methods from `riskMatrix.ts`:

1. **Kelly Criterion** — `kellyPositionSize()` (quarter-Kelly)
2. **Fixed Fractional** — `fixedFractionalSize()` (1% risk)
3. **Volatility Adjusted** — `volatilityAdjustedSize()` (ATR-based)

Recommend the most conservative of the three.

### Step 5: Pre-Trade Risk Check
Run `preTradeRiskCheck()` — verify:
- Circuit breakers not triggered
- Position within size limits
- Portfolio exposure within limits
- Margin available
- Concentration check

### Step 6: Format Output

```
━━━ TRADE SIGNAL: [METAL] [BUY/SELL] ━━━━━━━━━━━━━━━

  Conviction:    XX% [ULTRA STRONG / STRONG / MODERATE / WEAK]
  Alignment:     X/Y signals agree (XX%)
  Regime:        [TRENDING UP / RANGING / etc.]
  Risk/Reward:   X.X
  Expected Value: $X.XX

  Entry:   $X,XXX.XX
  Target:  $X,XXX.XX (+X.XX%)
  Stop:    $X,XXX.XX (-X.XX%)

━━━ SIGNAL BREAKDOWN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [TECHNICAL]      BUY  68% — Above SMA200, MACD bullish
  [FLOW]           BUY  55% — Smart money buying
  [MICROSTRUCTURE] SELL 40% — Book slightly ask-heavy
  [PATTERN]        BUY  60% — Bullish engulfing

━━━ POSITION SIZING ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Kelly:           XX oz ($XX,XXX)
  Fixed Frac (1%): XX oz ($XX,XXX)
  Vol Adjusted:    XX oz ($XX,XXX)
  RECOMMENDED:     XX oz ($XX,XXX)

━━━ RISK CHECK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [APPROVED / REJECTED]
  Warnings: [if any]
```

### Step 7: Compliance Gate
If the trade involves a sanctioned counterparty or exceeds AED 55K
threshold, flag per MoE Circular 08/AML/2021.

## Category
Trading

## Icon
Trade Signal
