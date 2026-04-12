# /market-briefing — Morning Precious Metals Briefing

Start your day with a curated scan of the precious metals market.
Top opportunities, risk conditions, and key levels ranked by urgency.

## Usage
```
/market-briefing
/market-briefing XAU
/market-briefing XAG XPT
```

## Instructions

When this skill is invoked, follow these steps:

### Step 1: Gather Market Data
1. Initialize `MetalsTradingBrain` from `src/services/metalsTrading/metalsTradingBrain.ts`.
2. Run `brain.tick()` to get fresh prices for all active metals (XAU, XAG, XPT, XPD).
3. Get snapshots via `brain.oracle.getSnapshot(metal)` for each metal.
4. Get LBMA fix via `brain.oracle.getLatestFix('XAU')`.
5. Get Gold/Silver ratio via `brain.oracle.getGoldSilverRatio()`.

### Step 2: Technical Landscape
1. Compute indicators via `computeAllIndicators()` from `technicalAnalysis.ts`.
2. For each metal, report:
   - **Regime**: Trending Up / Down / Ranging / High Volatility / Breakout / Mean Reversion
   - **Key levels**: Support & Resistance (top 3 each)
   - **RSI**: Overbought (>70) / Oversold (<30) / Neutral
   - **MACD**: Bullish or bearish crossover
   - **Bollinger position**: Upper band / lower band / mid
3. Detect patterns via `detectPatterns()` — report any active formations.

### Step 3: Flow & Microstructure
1. Run flow analysis — is smart money buying or selling?
2. Check VPIN — is flow toxic? (>0.7 = warning)
3. Report order book imbalance — bid heavy or ask heavy?

### Step 4: Risk Conditions
1. Circuit breaker status (all OK / triggered)
2. Current drawdown vs max allowed
3. VaR (1-day, 5-day) if positions are open

### Step 5: Format Output

Present as a **structured briefing** in this format:

```
PRECIOUS METALS — MORNING BRIEFING
Date: dd/mm/yyyy | Time: HH:MM Dubai

━━━ GOLD (XAU) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Spot: $X,XXX.XX  (+X.XX%)
  Regime: TRENDING UP
  LBMA Fix: AM $X,XXX.XX | PM $X,XXX.XX
  RSI(14): XX.X — neutral
  MACD: bullish crossover
  Key Levels: R $X,XXX / $X,XXX | S $X,XXX / $X,XXX
  Smart Money: BUYING
  Pattern: Bullish engulfing (60% confidence)

━━━ SILVER (XAG) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [same format]

━━━ G/S RATIO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Current: XX.X (mean: 75)
  Signal: NEUTRAL / SILVER UNDERVALUED / GOLD UNDERVALUED

━━━ RISK CONDITIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Circuit Breakers: All OK
  Drawdown: X.X% / 10% max
  VaR(1d): $X,XXX

━━━ TODAY'S WATCHLIST ━━━━━━━━━━━━━━━━━━━━━━━━━
  1. [Priority signal or alert]
  2. [Key level to watch]
  3. [Upcoming event/catalyst]
```

### Step 6: Asana Dispatch (optional)
If Asana is configured, dispatch briefing to the TRADING project
Daily Reports section via `tradingReportDispatcher.ts`.

## Category
Research & Strategy

## Icon
Morning Briefing
