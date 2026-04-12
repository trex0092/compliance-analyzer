# /trade-journal — End-of-Day Trading Journal

Automated review of everything done today with performance analytics,
lessons learned, and next-day preparation.

## Usage
```
/trade-journal
/trade-journal 2026-04-12
```

## Instructions

### Step 1: Gather Session Data
1. Get today's trades from `PositionManager.getTradeHistory()`.
2. Get today's alerts from `AlertWeapon.getHistory()`.
3. Get today's orders from `TradingEngine.getOrderHistory()`.
4. Get current portfolio state.

### Step 2: Trade-by-Trade Review
For each trade completed today:
- Entry/exit price, P&L, holding period
- Signal source that triggered the trade
- Max favorable excursion (how far in your favor)
- Max adverse excursion (how far against you)
- Was the stop loss respected?
- Was the target reached?
- Grade: A (perfect execution) / B (good) / C (needs work) / D (mistake)

### Step 3: Performance Summary
Calculate today's stats:
- Total trades, wins, losses
- Win rate, profit factor
- Total P&L, best trade, worst trade
- Avg holding period
- Slippage cost, fee cost
- Equity curve point

### Step 4: Signal Accuracy Review
How accurate were today's signals?
- Signals generated vs acted on
- Signals that would have been profitable if taken
- Missed opportunities
- False signals (loss trades)

### Step 5: Risk Review
- Was daily loss limit approached?
- Any circuit breaker triggers?
- Largest single-trade loss vs limit
- Concentration at peak

### Step 6: Lessons & Patterns
AI-generated observations:
- What worked (repeat tomorrow)
- What failed (avoid tomorrow)
- Market conditions that changed mid-day
- Regime shifts detected

### Step 7: Next-Day Prep
- Key levels to watch tomorrow
- Pending orders still open
- Overnight risk exposure
- Economic calendar events

### Step 8: Format Output

```
━━━ TRADING JOURNAL — dd/mm/yyyy ━━━━━━━━━━━━━━━

  TODAY'S SCORECARD
    Trades: X  |  Wins: X  |  Losses: X
    Win Rate: XX%  |  P&L: +$X,XXX
    Best: +$XXX (XAU BUY)
    Worst: -$XXX (XAG SELL)

  TRADE LOG
    #1 XAU BUY  +$XXX  [A] Perfect entry on MACD crossover
    #2 XAG SELL -$XXX  [C] Premature exit, target was 2% away
    #3 XPT BUY  +$XXX  [B] Good read on support bounce

  SIGNAL ACCURACY
    Generated: X  |  Acted on: X  |  Hit target: X
    Missed winners: X  |  False signals: X

  RISK COMPLIANCE
    Max daily risk used: XX% of $25,000 limit
    Circuit breakers: All OK
    Largest loss: $XXX (XX% of per-trade limit)

  LESSONS
    + Gold trend following worked well in TRENDING UP regime
    - Silver mean reversion signal was premature
    ! Watch for regime change — ADX declining

  TOMORROW PREP
    Key levels: XAU R $2,355 / S $2,320
    Open orders: 2 pending limits
    Overnight exposure: $XX,XXX (XX% of portfolio)
```

### Step 9: Asana Dispatch
Create task in TRADING project → Daily Reports section with
today's date and P&L in the task title.

## Category
System & Tools

## Icon
End-of-Day Summary
