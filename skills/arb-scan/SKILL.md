# /arb-scan — Cross-Market Arbitrage Scanner

Scan all venues for arbitrage opportunities across precious metals.
Detects cross-exchange spreads, G/S ratio trades, physical-paper
premium, regional differentials, and triangular arbitrage.

## Usage
```
/arb-scan
/arb-scan XAU
/arb-scan --min-profit 500
```

## Instructions

### Step 1: Initialize Scanner
1. Create `ArbitrageScanner` from `src/services/metalsTrading/arbitrageScanner.ts`.
2. Initialize `PriceOracle` with feeds from all 6 venues:
   LBMA, COMEX, SGE, DMCC, OTC_SPOT, PHYSICAL.
3. Ingest latest quotes for all metals.

### Step 2: Run Full Scan
Call `scanner.scanAll(oracle)` which checks 6 arbitrage types:

| Type | What it detects | Minimum spread |
|---|---|---|
| CROSS_EXCHANGE | Same metal, different venue | 15 bps |
| RATIO_TRADE | Gold/Silver ratio deviation | 1.5 sigma |
| PHYSICAL_PAPER | Physical vs paper premium | 2% |
| REGIONAL | London vs Dubai vs Shanghai | 30 bps |
| TRIANGULAR | XAU/USD → XAU/AED → USD/AED | 15 bps |
| SPOT_FUTURES | Spot vs futures basis | 20 bps |

### Step 3: Rank & Filter
1. Sort by `netProfit` descending.
2. Filter out opportunities below minimum profit threshold.
3. For each opportunity, report:
   - Type, venues, spread (abs + %), estimated profit
   - Execution plan (step-by-step)
   - Risk factors
   - Confidence score
   - Time window before expiry

### Step 4: Format Output

```
━━━ ARBITRAGE SCANNER — [N] OPPORTUNITIES FOUND ━━━

  #1  CROSS EXCHANGE — $X,XXX net profit
      Buy: LBMA @ $X,XXX.XX
      Sell: DMCC @ $X,XXX.XX
      Spread: 0.XX% (XX bps)
      Confidence: XX%
      Window: Xs remaining
      Risk: execution speed, settlement timing

  #2  G/S RATIO TRADE — $X,XXX net profit
      Ratio: XX.X (mean: 75, deviation: X.X sigma)
      Action: Buy silver / Sell gold
      Horizon: 2-4 weeks
      Risk: mean reversion timing

  #3  TRIANGULAR — $XXX net profit
      XAU/USD → XAU/AED → USD/AED
      Implied rate: X.XXXX vs official 3.6725
      Window: 10s

━━━ SCANNER STATS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total detected (1h): XX
  Total estimated profit: $X,XXX
  Avg confidence: XX%
  By type: cross-exchange X, ratio X, regional X
```

### Step 5: Compliance Check
Flag any arbitrage involving venues in sanctioned jurisdictions.
Ensure cross-border cash movements under AED 60K comply with
Cabinet Res 134/2025 Art.16.

## Category
Trading

## Icon
Arbitrage Scanner
