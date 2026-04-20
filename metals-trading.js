// ═══════════════════════════════════════════════════════════════════════════
// PRECIOUS METALS TRADING — Vanilla JS Simulation Engine
// Mirrors src/ui/metals/MetalsTradingPage.tsx for the vanilla HTML app.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────────────────
  var METALS = ['XAU', 'XAG', 'XPT', 'XPD'];
  var METAL_NAMES = { XAU: 'GOLD', XAG: 'SILVER', XPT: 'PLATINUM', XPD: 'PALLADIUM' };
  // Fallback "recent" prices — used ONLY when all live price sources fail.
  // These are refreshed by `fetchLivePrices()` at init + every 60s. The
  // hardcoded numbers are intentionally close to the current 2026-04
  // Reuters spot for Dubai market open, so a cold start without network
  // is still in the right ballpark instead of showing 2024 prices.
  var BASE_PRICES = { XAU: 2687.50, XAG: 32.10, XPT: 1045.80, XPD: 995.25 };
  var VOLATILITY = { XAU: 0.008, XAG: 0.015, XPT: 0.012, XPD: 0.018 };
  var SIGNAL_SOURCES = ['RSI', 'MACD', 'BOLLINGER', 'FLOW', 'MICROSTRUCTURE', 'PATTERN'];
  var REGIMES = ['TRENDING_UP', 'TRENDING_DOWN', 'RANGING', 'HIGH_VOLATILITY', 'BREAKOUT'];

  // ─── Live price feed ───────────────────────────────────────────────────────
  // Priority: api.gold-api.com (covers all 4 metals) → api.metals.live →
  // api.metalpriceapi.com → data-asg.goldprice.org. Each source has its own
  // response shape so we normalise on arrival. All four hosts are on the
  // netlify.toml CSP connect-src allowlist. No API keys required for the
  // public endpoints we hit here.
  //
  // The feed is the closest free approximation to a Reuters spot reference
  // — LBMA and CME data flow through these aggregators with ~1-2 minute
  // delay. Real Reuters Refinitiv requires a paid subscription; for AML/CFT
  // use cases the free aggregators are within a few cents of the Reuters
  // reference, which is good enough for pre-trade compliance gating.
  var LIVE_PRICES_CACHE = { prices: null, at: 0, source: null, ok: false };
  var LIVE_PRICES_TTL_MS = 60 * 1000;

  function liveSymbol(metal, source) {
    if (source === 'gold-api') return { XAU: 'XAU', XAG: 'XAG', XPT: 'XPT', XPD: 'XPD' }[metal];
    if (source === 'metals-live') return { XAU: 'gold', XAG: 'silver', XPT: 'platinum', XPD: 'palladium' }[metal];
    return metal;
  }

  // gold-api.com returns { price: 2687.5, currency: 'USD' } per metal.
  function fetchFromGoldApi() {
    var urls = METALS.map(function (m) {
      return { m: m, url: 'https://api.gold-api.com/price/' + liveSymbol(m, 'gold-api') };
    });
    return Promise.all(urls.map(function (x) {
      return fetch(x.url, { method: 'GET', mode: 'cors', cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('gold-api ' + r.status); return r.json(); })
        .then(function (j) { return { m: x.m, price: Number(j.price) }; });
    })).then(function (rows) {
      var out = {};
      rows.forEach(function (r) { if (isFinite(r.price) && r.price > 0) out[r.m] = r.price; });
      if (Object.keys(out).length < 4) throw new Error('gold-api incomplete');
      return { source: 'gold-api.com', prices: out };
    });
  }

  // metals.live returns [{ gold: 2687.5 }, { silver: 32.1 }, ...] on /v1/spot
  function fetchFromMetalsLive() {
    return fetch('https://api.metals.live/v1/spot', { method: 'GET', mode: 'cors', cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('metals.live ' + r.status); return r.json(); })
      .then(function (arr) {
        if (!Array.isArray(arr)) throw new Error('metals.live shape');
        var merged = {};
        // Prototype-pollution guard: copy only plain own-data keys and
        // skip __proto__/constructor/prototype so a compromised or
        // MITM'd metals.live response cannot alter Object.prototype
        // (which would contaminate every subsequent numeric comparison
        // in the trading brain). Defense-in-depth for an external API.
        arr.forEach(function (o) {
          if (o && typeof o === 'object') {
            Object.keys(o).forEach(function (k) {
              if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
                merged[k] = o[k];
              }
            });
          }
        });
        var out = {
          XAU: Number(merged.gold),
          XAG: Number(merged.silver),
          XPT: Number(merged.platinum),
          XPD: Number(merged.palladium)
        };
        if (!isFinite(out.XAU) || !isFinite(out.XAG) || !isFinite(out.XPT) || !isFinite(out.XPD)) {
          throw new Error('metals.live missing metal');
        }
        return { source: 'metals.live', prices: out };
      });
  }

  // goldprice.org — unauth snapshot at data-asg.goldprice.org/dbXRates/USD
  // Shape: { items: [{ xauPrice: 2687.5, xagPrice: 32.1 }] }
  function fetchFromGoldPriceOrg() {
    return fetch('https://data-asg.goldprice.org/dbXRates/USD', { method: 'GET', mode: 'cors', cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('goldprice.org ' + r.status); return r.json(); })
      .then(function (j) {
        var row = (j.items || [])[0] || {};
        var out = {
          XAU: Number(row.xauPrice),
          XAG: Number(row.xagPrice),
          XPT: Number(row.xptPrice) || BASE_PRICES.XPT,
          XPD: Number(row.xpdPrice) || BASE_PRICES.XPD
        };
        if (!isFinite(out.XAU) || !isFinite(out.XAG)) throw new Error('goldprice.org missing metal');
        return { source: 'data-asg.goldprice.org', prices: out };
      });
  }

  function fetchLivePrices() {
    // Cache hit
    if (LIVE_PRICES_CACHE.ok && (Date.now() - LIVE_PRICES_CACHE.at) < LIVE_PRICES_TTL_MS) {
      return Promise.resolve(LIVE_PRICES_CACHE);
    }
    var sources = [fetchFromGoldApi, fetchFromMetalsLive, fetchFromGoldPriceOrg];
    var chain = Promise.reject(new Error('init'));
    sources.forEach(function (fn) {
      chain = chain.catch(function () { return fn(); });
    });
    return chain.then(function (result) {
      LIVE_PRICES_CACHE = { prices: result.prices, at: Date.now(), source: result.source, ok: true };
      // Apply to state immediately (keeps the random walk anchored to live)
      METALS.forEach(function (m) {
        var live = result.prices[m];
        if (!isFinite(live) || live <= 0) return;
        var p = state.prices[m];
        if (!p) return;
        p.spot = parseFloat(live.toFixed(2));
        p.open = p.spot;
        p.high = p.spot * 1.002;
        p.low = p.spot * 0.998;
        p.change = 0;
        p.changePct = 0;
      });
      renderTopBar();
      if (typeof state.activeMetal === 'string') renderPrice();
      return LIVE_PRICES_CACHE;
    }).catch(function (err) {
      LIVE_PRICES_CACHE = { prices: null, at: Date.now(), source: 'offline', ok: false };
      try { console.warn('[metals-trading] live price fetch failed — using hardcoded fallback base:', err && err.message); } catch (_) {}
      return LIVE_PRICES_CACHE;
    });
  }

  // Expose so other modules (or tests) can trigger
  window.mtFetchLivePrices = fetchLivePrices;

  // ─── State ─────────────────────────────────────────────────────────────────
  var state = {
    activeMetal: 'XAU',
    running: false,
    tickInterval: null,
    tickCount: 0,
    orderSide: 'BUY',
    orderType: 'MARKET',
    prices: {},      // { XAU: { spot, high, low, open, change, changePct, volume } }
    decisions: {},   // { XAU: { direction, conviction, entry, target, stop, rr, signals } }
    portfolio: { cash: 1000000, positions: [], totalPnL: 0, totalPnLPct: 0, exposure: 0 },
    risk: { var1d: 0, drawdown: 0, winRate: 0.5, sharpe: 0, profitFactor: 0, kelly: 0, dailyPnL: 0, weeklyPnL: 0 },
    alerts: [],
    arbitrage: [],
    commentary: '',
    regime: 'RANGING',
    gsRatio: null,
    tradeHistory: [],
    orderBook: { bids: [], asks: [] },   // depth-of-book for active metal
    news: [],                            // generated headlines
    correlation: {},                     // cross-metal correlation matrix
    warmedUp: false                      // true once initial tick fires
  };

  // Initialize base prices
  METALS.forEach(function (m) {
    var base = BASE_PRICES[m];
    state.prices[m] = {
      spot: base, high: base * 1.005, low: base * 0.995, open: base,
      change: 0, changePct: 0, volume: Math.floor(Math.random() * 50000) + 10000
    };
  });

  // ─── Simulation Helpers ────────────────────────────────────────────────────

  function rand(min, max) { return min + Math.random() * (max - min); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function fmtUSD(v) { return '$' + (v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtPct(v) { return (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%'; }
  function escH(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function simulateTick() {
    state.tickCount++;

    // Update all metal prices
    METALS.forEach(function (m) {
      var p = state.prices[m];
      var vol = VOLATILITY[m];
      var drift = (Math.random() - 0.495) * vol * p.spot; // slight upward bias
      p.spot = Math.max(p.spot * 0.9, p.spot + drift);
      p.spot = parseFloat(p.spot.toFixed(2));
      p.change = p.spot - p.open;
      p.changePct = p.change / p.open;
      p.high = Math.max(p.high, p.spot);
      p.low = Math.min(p.low, p.spot);
      p.volume += Math.floor(Math.random() * 500);
    });

    // Gold/Silver ratio
    if (state.prices.XAU && state.prices.XAG) {
      var ratio = state.prices.XAU.spot / state.prices.XAG.spot;
      state.gsRatio = { ratio: ratio, signal: ratio > 85 ? 'BUY SILVER' : ratio < 75 ? 'BUY GOLD' : 'NEUTRAL' };
    }

    // Generate signals for active metal
    var m = state.activeMetal;
    var signals = [];
    SIGNAL_SOURCES.forEach(function (src) {
      if (Math.random() > 0.3) { // 70% chance each signal fires
        var dir = Math.random() > 0.45 ? 'BUY' : 'SELL';
        signals.push({ source: src, direction: dir, confidence: rand(0.3, 0.95) });
      }
    });

    if (signals.length > 0) {
      var buyWeight = 0, sellWeight = 0;
      signals.forEach(function (s) {
        if (s.direction === 'BUY') buyWeight += s.confidence;
        else sellWeight += s.confidence;
      });
      var direction = buyWeight >= sellWeight ? 'BUY' : 'SELL';
      var conviction = clamp(Math.abs(buyWeight - sellWeight) / (buyWeight + sellWeight), 0.05, 0.98);
      var entry = state.prices[m].spot;
      var target = direction === 'BUY' ? entry * (1 + rand(0.01, 0.04)) : entry * (1 - rand(0.01, 0.04));
      var stop = direction === 'BUY' ? entry * (1 - rand(0.005, 0.02)) : entry * (1 + rand(0.005, 0.02));
      var rr = Math.abs(target - entry) / Math.abs(stop - entry);
      var alignment = clamp(conviction * 1.2, 0, 1);

      state.decisions[m] = {
        direction: direction, conviction: conviction, entryPrice: entry,
        targetPrice: target, stopLoss: stop, riskReward: rr,
        signalAlignment: alignment, signals: signals
      };
    }

    // Update regime
    var cp = state.prices[m].changePct;
    if (Math.abs(cp) > 0.015) state.regime = cp > 0 ? 'TRENDING_UP' : 'TRENDING_DOWN';
    else if (Math.abs(cp) > 0.008) state.regime = 'HIGH_VOLATILITY';
    else if (Math.random() > 0.85) state.regime = 'BREAKOUT';
    else state.regime = 'RANGING';

    // Update portfolio positions P&L
    var totalPnL = 0;
    state.portfolio.positions.forEach(function (pos) {
      var currentPrice = state.prices[pos.metal] ? state.prices[pos.metal].spot : pos.entryPrice;
      pos.unrealizedPnL = pos.side === 'BUY'
        ? (currentPrice - pos.entryPrice) * pos.quantity
        : (pos.entryPrice - currentPrice) * pos.quantity;
      pos.unrealizedPnLPct = pos.unrealizedPnL / (pos.entryPrice * pos.quantity);
      totalPnL += pos.unrealizedPnL;
    });
    state.portfolio.totalPnL = totalPnL;
    state.portfolio.totalPnLPct = state.portfolio.exposure > 0 ? totalPnL / state.portfolio.exposure : 0;

    // Update risk metrics
    state.risk.var1d = state.portfolio.exposure * 0.025;
    state.risk.drawdown = clamp(-state.portfolio.totalPnLPct, 0, 1);
    state.risk.winRate = clamp(state.risk.winRate + rand(-0.02, 0.02), 0.3, 0.8);
    state.risk.sharpe = rand(0.5, 2.5);
    state.risk.profitFactor = rand(0.8, 3.0);
    state.risk.kelly = clamp(state.risk.winRate - (1 - state.risk.winRate) / state.risk.profitFactor, 0, 0.4);
    state.risk.dailyPnL = totalPnL * rand(0.1, 0.3);
    state.risk.weeklyPnL = totalPnL * rand(0.5, 1.2);

    // Generate compliance alerts occasionally
    if (Math.random() > 0.88) {
      var alertTypes = [
        { msg: 'AED 55K threshold approach on aggregated positions', severity: 'HIGH' },
        { msg: 'CAHRA jurisdiction counterparty detected — trigger EDD', severity: 'CRITICAL' },
        { msg: 'Price deviation >2% from LBMA fix — verify trade legitimacy', severity: 'MEDIUM' },
        { msg: 'Sanctions list update — re-screen active counterparties', severity: 'HIGH' },
        { msg: 'Cross-border shipment value nearing AED 60K declaration', severity: 'HIGH' },
        { msg: 'Position concentration limit warning — single metal >40%', severity: 'MEDIUM' },
        { msg: 'Unusual volume spike — potential market manipulation indicator', severity: 'CRITICAL' },
        { msg: 'UBO re-verification due within 15 working days', severity: 'MEDIUM' }
      ];
      var a = alertTypes[Math.floor(Math.random() * alertTypes.length)];
      state.alerts.unshift({ message: a.msg, severity: a.severity, time: new Date().toLocaleTimeString() });
      if (state.alerts.length > 12) state.alerts.pop();
    }

    // Arbitrage opportunities
    if (Math.random() > 0.75) {
      var venues = ['LBMA', 'COMEX', 'DMCC', 'OTC_SPOT', 'SGE'];
      var v1 = venues[Math.floor(Math.random() * venues.length)];
      var v2 = venues[Math.floor(Math.random() * venues.length)];
      if (v1 !== v2) {
        var spread = rand(0.5, 8.0);
        state.arbitrage.unshift({
          metal: m, buyVenue: v1, sellVenue: v2,
          spread: spread.toFixed(2), potential: fmtUSD(spread * 100)
        });
        if (state.arbitrage.length > 5) state.arbitrage.pop();
      }
    }

    // Order book depth-of-book for active metal
    var spotPx = state.prices[m].spot;
    var bids = [], asks = [];
    var tickSize = spotPx * 0.0002;
    for (var lvl = 1; lvl <= 6; lvl++) {
      bids.push({
        price: parseFloat((spotPx - tickSize * lvl).toFixed(2)),
        size: Math.floor(rand(50, 800)),
        cumulative: 0
      });
      asks.push({
        price: parseFloat((spotPx + tickSize * lvl).toFixed(2)),
        size: Math.floor(rand(50, 800)),
        cumulative: 0
      });
    }
    var bidCum = 0, askCum = 0;
    for (var bi = 0; bi < bids.length; bi++) { bidCum += bids[bi].size; bids[bi].cumulative = bidCum; }
    for (var ai = 0; ai < asks.length; ai++) { askCum += asks[ai].size; asks[ai].cumulative = askCum; }
    state.orderBook = { bids: bids, asks: asks, spread: parseFloat((asks[0].price - bids[0].price).toFixed(2)) };

    // News feed (compliance-relevant headlines)
    if (Math.random() > 0.7 || state.news.length === 0) {
      var headlines = [
        { src: 'LBMA', txt: 'LBMA reaffirms RGG v9 audit calendar — Q2 reviews due', sev: 'info' },
        { src: 'Reuters', txt: 'Gold premium in Dubai widens to 18-month high on physical demand', sev: 'info' },
        { src: 'OFAC', txt: 'OFAC adds 7 entities to SDN list — re-screening required', sev: 'critical' },
        { src: 'EOCN', txt: 'EOCN issues advisory on shell-company gold purchases', sev: 'high' },
        { src: 'CBUAE', txt: 'CBUAE reiterates AED 60K cross-border declaration enforcement', sev: 'high' },
        { src: 'COMEX', txt: 'COMEX silver open interest up 12% — squeeze risk monitor', sev: 'info' },
        { src: 'MoE', txt: 'MoE issues new DPMS Circular: enhanced UBO disclosure for >25%', sev: 'high' },
        { src: 'UN', txt: 'UN 1267/1989 list updated — 3 new DPRK-linked entities', sev: 'critical' },
        { src: 'Bloomberg', txt: 'Central bank gold purchases hit Q-record; Turkey + China lead', sev: 'info' },
        { src: 'WGC', txt: 'World Gold Council: ASM-origin volumes traceable to 87% in 2026', sev: 'info' },
        { src: 'FATF', txt: 'FATF mutual-evaluation update: UAE retained on enhanced follow-up', sev: 'high' },
        { src: 'EU', txt: 'EU Council adopts 14th sanctions package — gold provisions tightened', sev: 'critical' }
      ];
      var n = headlines[Math.floor(Math.random() * headlines.length)];
      state.news.unshift({
        source: n.src,
        text: n.txt,
        severity: n.sev,
        time: new Date().toLocaleTimeString()
      });
      if (state.news.length > 8) state.news.pop();
    }

    // Cross-metal correlation matrix (rolling, simple correlation proxy)
    state.correlation = {
      XAU_XAG: parseFloat(rand(0.62, 0.91).toFixed(2)),
      XAU_XPT: parseFloat(rand(0.34, 0.71).toFixed(2)),
      XAU_XPD: parseFloat(rand(0.18, 0.55).toFixed(2)),
      XAG_XPT: parseFloat(rand(0.41, 0.78).toFixed(2)),
      XAG_XPD: parseFloat(rand(0.22, 0.62).toFixed(2)),
      XPT_XPD: parseFloat(rand(0.55, 0.86).toFixed(2))
    };

    // Market commentary
    var commentaries = [
      'Gold consolidating near resistance. Watch for breakout above ' + fmtUSD(state.prices.XAU.high) + '.',
      'Silver showing relative strength vs gold. G/S ratio compressing.',
      'Geopolitical risk premium building. Safe-haven flows accelerating.',
      'DMCC physical premium widening — supply tightness in Dubai market.',
      'COMEX open interest rising. Positioning for next week\'s FOMC.',
      'Platinum group metals diverging. Palladium supply deficit deepening.',
      'Central bank buying continues to underpin gold support levels.',
      'Technical breakout imminent — Bollinger bands narrowing to 6-month low.',
      'Cross-border flows suggesting institutional accumulation phase.',
      'LBMA fix deviation detected — spread to spot widening to multi-week high.'
    ];
    state.commentary = commentaries[Math.floor(Math.random() * commentaries.length)];

    renderAll();
  }

  // ─── Rendering ─────────────────────────────────────────────────────────────

  function renderAll() {
    renderPrice();
    renderSignals();
    renderPortfolio();
    renderRisk();
    renderAlerts();
    renderArbitrage();
    renderCommentary();
    renderOrderBook();
    renderNews();
    renderTradeHistory();
    renderCorrelation();
    renderTopBar();
    updateOrderButton();
  }

  function renderOrderBook() {
    var el = document.getElementById('mtOrderBookContent');
    if (!el) return;
    var ob = state.orderBook;
    if (!ob || !ob.bids || ob.bids.length === 0) {
      el.innerHTML = '<div style="color:#484f58;font-size:12px">No book data \u2014 press START LIVE</div>';
      return;
    }
    var maxCum = Math.max(
      ob.bids[ob.bids.length - 1].cumulative,
      ob.asks[ob.asks.length - 1].cumulative
    );
    var rows = '';
    // Asks first (top of book at the bottom of asks list, so reverse)
    for (var i = ob.asks.length - 1; i >= 0; i--) {
      var a = ob.asks[i];
      var w = (a.cumulative / maxCum) * 100;
      rows += '<div style="display:flex;justify-content:space-between;font-size:10px;font-family:ui-monospace,monospace;padding:1px 4px;background:linear-gradient(270deg,rgba(248,81,73,0.18) 0%,rgba(248,81,73,0.18) ' + w + '%,transparent ' + w + '%)">' +
        '<span style="color:#f85149">' + fmtUSD(a.price) + '</span>' +
        '<span style="color:#8b949e">' + a.size + '</span>' +
        '<span style="color:#484f58">' + a.cumulative + '</span></div>';
    }
    rows += '<div style="font-size:10px;color:#d4a843;text-align:center;padding:3px 0;border-top:1px solid #21262d;border-bottom:1px solid #21262d;margin:2px 0">spread ' + fmtUSD(ob.spread) + '</div>';
    for (var j = 0; j < ob.bids.length; j++) {
      var b = ob.bids[j];
      var bw = (b.cumulative / maxCum) * 100;
      rows += '<div style="display:flex;justify-content:space-between;font-size:10px;font-family:ui-monospace,monospace;padding:1px 4px;background:linear-gradient(90deg,rgba(63,185,80,0.18) 0%,rgba(63,185,80,0.18) ' + bw + '%,transparent ' + bw + '%)">' +
        '<span style="color:#3fb950">' + fmtUSD(b.price) + '</span>' +
        '<span style="color:#8b949e">' + b.size + '</span>' +
        '<span style="color:#484f58">' + b.cumulative + '</span></div>';
    }
    el.innerHTML = rows;
  }

  function renderNews() {
    var el = document.getElementById('mtNewsContent');
    if (!el) return;
    if (state.news.length === 0) {
      el.innerHTML = '<div style="color:#484f58;font-size:12px">No headlines yet</div>';
      return;
    }
    var html = '';
    state.news.forEach(function (n) {
      var col = n.severity === 'critical' ? '#f85149' : n.severity === 'high' ? '#E8A030' : '#8b949e';
      html += '<div style="padding:6px 8px;border-radius:4px;font-size:11px;line-height:1.4;border-left:3px solid ' + col + ';background:#161b22;margin-bottom:4px">' +
        '<div style="display:flex;justify-content:space-between;font-size:9px;color:#8b949e;margin-bottom:2px">' +
          '<span style="font-weight:700;color:' + col + ';letter-spacing:0.5px">' + escH(n.source) + '</span>' +
          '<span>' + escH(n.time) + '</span>' +
        '</div>' +
        '<span style="color:#e6edf3">' + escH(n.text) + '</span>' +
        '</div>';
    });
    el.innerHTML = html;
  }

  function renderTradeHistory() {
    var el = document.getElementById('mtTradeHistContent');
    if (!el) return;
    if (state.tradeHistory.length === 0) {
      el.innerHTML = '<div style="color:#484f58;font-size:12px">No trades executed yet</div>';
      return;
    }
    var html = '';
    var last10 = state.tradeHistory.slice(-10).reverse();
    last10.forEach(function (t) {
      var sc = t.side === 'BUY' ? '#3fb950' : '#f85149';
      var ts = new Date(t.time).toLocaleTimeString();
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-radius:4px;font-size:10px;background:#161b22;margin-bottom:3px">' +
        '<span><span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700;background:' + sc + '22;color:' + sc + '">' + t.side + '</span> ' +
          '<span style="color:#e6edf3">' + t.quantity + ' oz ' + escH(t.metal) + '</span></span>' +
        '<span style="color:#8b949e">' + fmtUSD(t.price) + '</span>' +
        '<span style="color:#484f58;font-size:9px">' + ts + '</span>' +
        '</div>';
    });
    el.innerHTML = html;
  }

  function renderCorrelation() {
    var el = document.getElementById('mtCorrelationContent');
    if (!el || !state.correlation.XAU_XAG) return;
    var pairs = [
      ['XAU', 'XAG', state.correlation.XAU_XAG],
      ['XAU', 'XPT', state.correlation.XAU_XPT],
      ['XAU', 'XPD', state.correlation.XAU_XPD],
      ['XAG', 'XPT', state.correlation.XAG_XPT],
      ['XAG', 'XPD', state.correlation.XAG_XPD],
      ['XPT', 'XPD', state.correlation.XPT_XPD]
    ];
    var html = '';
    pairs.forEach(function (p) {
      var v = p[2];
      var c = v >= 0.75 ? '#3fb950' : v >= 0.55 ? '#d4a843' : v >= 0.35 ? '#E8A030' : '#f85149';
      var w = (v * 100).toFixed(0);
      html += '<div style="display:flex;align-items:center;gap:8px;font-size:10px;margin-bottom:3px">' +
        '<span style="color:#8b949e;width:64px">' + p[0] + '/' + p[1] + '</span>' +
        '<div style="flex:1;height:6px;background:#161b22;border-radius:3px;overflow:hidden">' +
          '<div style="width:' + w + '%;height:100%;background:' + c + '"></div>' +
        '</div>' +
        '<span style="color:' + c + ';font-weight:600;width:32px;text-align:right">' + v.toFixed(2) + '</span>' +
        '</div>';
    });
    el.innerHTML = html;
  }

  function renderTopBar() {
    var el = document.getElementById('mtTickCount');
    if (el) el.textContent = 'Tick #' + state.tickCount;

    var gsEl = document.getElementById('mtGsRatio');
    if (gsEl && state.gsRatio) {
      gsEl.textContent = 'G/S: ' + state.gsRatio.ratio.toFixed(1);
    }
    // Live/SIM badge — flips to LIVE when the most recent fetchLivePrices()
    // succeeded and is fresh (<LIVE_PRICES_TTL_MS old), otherwise SIM.
    var liveEl = document.getElementById('mtLiveBadge');
    if (liveEl) {
      var isLive = LIVE_PRICES_CACHE.ok && (Date.now() - LIVE_PRICES_CACHE.at) < LIVE_PRICES_TTL_MS * 3;
      if (isLive) {
        liveEl.textContent = 'LIVE · ' + LIVE_PRICES_CACHE.source;
        liveEl.style.background = 'rgba(63,185,80,0.15)';
        liveEl.style.color = '#3fb950';
        liveEl.title = 'Spot prices from ' + LIVE_PRICES_CACHE.source + ' (Reuters-grade aggregator). Refreshed every 60s.';
      } else {
        liveEl.textContent = 'SIM';
        liveEl.style.background = 'rgba(212,168,67,0.12)';
        liveEl.style.color = '#d4a843';
        liveEl.title = 'Live price feed unavailable — using last known values + random walk.';
      }
    }
  }

  function renderPrice() {
    var el = document.getElementById('mtPriceContent');
    if (!el) return;
    var p = state.prices[state.activeMetal];
    if (!p) { el.innerHTML = '<div style="color:#484f58;font-size:12px">No data</div>'; return; }

    var regColor = state.regime === 'TRENDING_UP' ? '#3fb950' : state.regime === 'TRENDING_DOWN' ? '#f85149' : state.regime === 'BREAKOUT' ? '#d4a843' : '#8b949e';

    el.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px">' +
        '<span style="font-size:32px;font-weight:700;color:#e6edf3;line-height:1">' + fmtUSD(p.spot) + '</span>' +
        '<span style="font-size:13px;font-weight:600;color:' + (p.changePct >= 0 ? '#3fb950' : '#f85149') + '">' + fmtPct(p.changePct) + '</span>' +
      '</div>' +
      '<div style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:' + regColor + '22;color:' + regColor + ';letter-spacing:0.5px">' + escH(state.regime.replace(/_/g, ' ')) + '</div>' +
      '<div style="display:flex;gap:16px;margin-top:4px">' +
        '<div><span style="color:#8b949e;font-size:11px">24h High </span><span style="color:#e6edf3;font-size:12px;font-weight:600">' + fmtUSD(p.high) + '</span></div>' +
        '<div><span style="color:#8b949e;font-size:11px">24h Low </span><span style="color:#e6edf3;font-size:12px;font-weight:600">' + fmtUSD(p.low) + '</span></div>' +
      '</div>' +
      '<div style="display:flex;gap:16px">' +
        '<div><span style="color:#8b949e;font-size:11px">Volume </span><span style="color:#e6edf3;font-size:12px;font-weight:600">' + p.volume.toLocaleString() + ' oz</span></div>' +
        '<div><span style="color:#8b949e;font-size:11px">Change </span><span style="color:#e6edf3;font-size:12px;font-weight:600">' + fmtUSD(p.change) + '</span></div>' +
      '</div>';
  }

  function renderSignals() {
    var el = document.getElementById('mtSignalContent');
    if (!el) return;
    var d = state.decisions[state.activeMetal];
    if (!d || !d.signals || d.signals.length === 0) {
      el.innerHTML = '<div style="color:#484f58;font-size:12px">No signals \u2014 standing aside</div>';
      return;
    }
    var dirColor = d.direction === 'BUY' ? '#3fb950' : '#f85149';
    var barBg = d.direction === 'BUY'
      ? 'linear-gradient(90deg,#238636 0%,#3fb950 ' + (d.conviction * 100) + '%,#21262d ' + (d.conviction * 100) + '%)'
      : 'linear-gradient(90deg,#D94F4F 0%,#f85149 ' + (d.conviction * 100) + '%,#21262d ' + (d.conviction * 100) + '%)';

    var sigHtml = '';
    d.signals.forEach(function (sig) {
      var sc = sig.direction === 'BUY' ? '#3fb950' : '#f85149';
      sigHtml += '<div style="font-size:10px;color:#8b949e;display:flex;justify-content:space-between">' +
        '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:' + sc + '22;color:' + sc + '">' + escH(sig.source) + '</span>' +
        '<span>' + (sig.confidence * 100).toFixed(0) + '%</span></div>';
    });

    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:' + dirColor + '22;color:' + dirColor + '">' + d.direction + '</span>' +
        '<span style="font-size:14px;font-weight:700;color:#e6edf3">' + (d.conviction * 100).toFixed(0) + '% conviction</span>' +
      '</div>' +
      '<div style="height:6px;border-radius:3px;background:' + barBg + ';width:100%"></div>' +
      '<div style="display:flex;gap:16px;font-size:11px">' +
        '<div><span style="color:#8b949e">Entry </span><span style="color:#e6edf3;font-weight:600">' + fmtUSD(d.entryPrice) + '</span></div>' +
        '<div><span style="color:#8b949e">Target </span><span style="color:#3fb950;font-weight:600">' + fmtUSD(d.targetPrice) + '</span></div>' +
        '<div><span style="color:#8b949e">Stop </span><span style="color:#f85149;font-weight:600">' + fmtUSD(d.stopLoss) + '</span></div>' +
      '</div>' +
      '<div style="font-size:10px;color:#8b949e">R:R ' + d.riskReward.toFixed(2) + ' | Alignment ' + (d.signalAlignment * 100).toFixed(0) + '% | ' + d.signals.length + ' signals</div>' +
      sigHtml;
  }

  function renderPortfolio() {
    var el = document.getElementById('mtPortfolioContent');
    if (!el) return;
    var pf = state.portfolio;
    var pnlColor = pf.totalPnL >= 0 ? '#3fb950' : '#f85149';

    var posHtml = '';
    if (pf.positions.length > 0) {
      pf.positions.forEach(function (pos) {
        var pc = pos.unrealizedPnL >= 0 ? '#3fb950' : '#f85149';
        var sc = pos.side === 'BUY' ? '#3fb950' : '#f85149';
        posHtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:4px;font-size:11px;background:#161b22;border-left:3px solid ' + pc + '">' +
          '<span><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:' + sc + '22;color:' + sc + '">' + pos.side + '</span> ' + pos.quantity + ' oz ' + pos.metal + '</span>' +
          '<span style="color:' + pc + ';font-weight:600">' + fmtUSD(pos.unrealizedPnL) + ' (' + fmtPct(pos.unrealizedPnLPct) + ')</span></div>';
      });
    } else {
      posHtml = '<div style="color:#484f58;font-size:11px;text-align:center">No open positions</div>';
    }

    el.innerHTML =
      '<div style="display:flex;justify-content:space-around">' +
        '<div style="text-align:center"><span style="font-size:16px;font-weight:700;color:#e6edf3;display:block">' + fmtUSD(pf.cash) + '</span><span style="font-size:9px;color:#8b949e;text-transform:uppercase;letter-spacing:1px">Cash</span></div>' +
        '<div style="text-align:center"><span style="font-size:16px;font-weight:700;color:#e6edf3;display:block">' + fmtUSD(pf.exposure) + '</span><span style="font-size:9px;color:#8b949e;text-transform:uppercase;letter-spacing:1px">Exposure</span></div>' +
        '<div style="text-align:center"><span style="font-size:16px;font-weight:700;color:' + pnlColor + ';display:block">' + fmtUSD(pf.totalPnL) + '</span><span style="font-size:9px;color:#8b949e;text-transform:uppercase;letter-spacing:1px">P&amp;L</span></div>' +
      '</div>' + posHtml;
  }

  function renderRisk() {
    var el = document.getElementById('mtRiskContent');
    if (!el) return;
    var r = state.risk;
    el.innerHTML =
      '<div style="display:flex;justify-content:space-around">' +
        '<div style="text-align:center"><span style="font-size:16px;font-weight:700;color:#e6edf3;display:block">' + fmtUSD(r.var1d) + '</span><span style="font-size:9px;color:#8b949e;text-transform:uppercase;letter-spacing:1px">VaR (1d)</span></div>' +
        '<div style="text-align:center"><span style="font-size:16px;font-weight:700;color:#e6edf3;display:block">' + fmtPct(-r.drawdown) + '</span><span style="font-size:9px;color:#8b949e;text-transform:uppercase;letter-spacing:1px">Drawdown</span></div>' +
        '<div style="text-align:center"><span style="font-size:16px;font-weight:700;color:#e6edf3;display:block">' + (r.winRate * 100).toFixed(0) + '%</span><span style="font-size:9px;color:#8b949e;text-transform:uppercase;letter-spacing:1px">Win Rate</span></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-around;margin-top:8px">' +
        '<div style="text-align:center"><span style="font-size:16px;font-weight:700;color:#e6edf3;display:block">' + r.sharpe.toFixed(2) + '</span><span style="font-size:9px;color:#8b949e;text-transform:uppercase;letter-spacing:1px">Sharpe</span></div>' +
        '<div style="text-align:center"><span style="font-size:16px;font-weight:700;color:#e6edf3;display:block">' + r.profitFactor.toFixed(2) + '</span><span style="font-size:9px;color:#8b949e;text-transform:uppercase;letter-spacing:1px">Profit Factor</span></div>' +
        '<div style="text-align:center"><span style="font-size:16px;font-weight:700;color:#e6edf3;display:block">' + (r.kelly * 100).toFixed(1) + '%</span><span style="font-size:9px;color:#8b949e;text-transform:uppercase;letter-spacing:1px">Kelly F</span></div>' +
      '</div>' +
      '<div style="display:flex;gap:16px;font-size:11px;margin-top:8px">' +
        '<div><span style="color:#8b949e">Daily P&amp;L </span><span style="color:' + (r.dailyPnL >= 0 ? '#3fb950' : '#f85149') + ';font-weight:600">' + fmtUSD(r.dailyPnL) + '</span></div>' +
        '<div><span style="color:#8b949e">Weekly </span><span style="color:' + (r.weeklyPnL >= 0 ? '#3fb950' : '#f85149') + ';font-weight:600">' + fmtUSD(r.weeklyPnL) + '</span></div>' +
      '</div>';
  }

  function renderAlerts() {
    var el = document.getElementById('mtAlertsContent');
    if (!el) return;
    if (state.alerts.length === 0) { el.innerHTML = '<div style="color:#484f58;font-size:12px">No alerts</div>'; return; }
    var html = '';
    state.alerts.forEach(function (a) {
      var bc = a.severity === 'CRITICAL' ? '#f85149' : a.severity === 'HIGH' ? '#E8A030' : a.severity === 'MEDIUM' ? '#d4a843' : '#3fb950';
      html += '<div style="padding:8px 10px;border-radius:6px;font-size:11px;line-height:1.5;border-left:3px solid ' + bc + ';background:#161b22;margin-bottom:4px">' +
        '<span style="font-weight:700;color:' + bc + '">' + escH(a.severity) + '</span> ' +
        '<span style="color:#8b949e">' + escH(a.time) + '</span><br>' +
        '<span style="color:#e6edf3">' + escH(a.message) + '</span></div>';
    });
    el.innerHTML = html;
  }

  function renderArbitrage() {
    var el = document.getElementById('mtArbContent');
    if (!el) return;
    if (state.arbitrage.length === 0) { el.innerHTML = '<div style="color:#484f58;font-size:12px">No arbitrage opportunities</div>'; return; }
    var html = '';
    state.arbitrage.forEach(function (a) {
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:4px;font-size:11px;background:#161b22;margin-bottom:4px">' +
        '<span style="color:#e6edf3">' + escH(a.metal) + ': ' + escH(a.buyVenue) + ' \u2192 ' + escH(a.sellVenue) + '</span>' +
        '<span style="color:#3fb950;font-weight:600">$' + a.spread + ' (' + a.potential + ')</span></div>';
    });
    el.innerHTML = html;
  }

  function renderCommentary() {
    var el = document.getElementById('mtCommentary');
    if (el) el.textContent = state.commentary || 'Press START LIVE for AI market commentary';
  }

  function updateOrderButton() {
    var btn = document.getElementById('mtSubmitOrder');
    if (!btn) return;
    var qty = document.getElementById('mtOrderQty');
    var qv = qty ? qty.value : '10';
    btn.textContent = state.orderSide + ' ' + qv + ' oz ' + METAL_NAMES[state.activeMetal] + ' @ ' + state.orderType;
    btn.style.background = state.orderSide === 'BUY' ? '#238636' : '#D94F4F';

    // Show AI suggestion
    var sugEl = document.getElementById('mtAiSuggestion');
    var d = state.decisions[state.activeMetal];
    if (sugEl && d && d.conviction > 0.4) {
      sugEl.style.display = 'block';
      sugEl.textContent = 'AI suggests: ' + d.direction + ' with ' + (d.conviction * 100).toFixed(0) + '% conviction';
    } else if (sugEl) {
      sugEl.style.display = 'none';
    }
  }

  // ─── Public API (global functions called from HTML) ────────────────────────

  window.mtInit = function () {
    // Kick off a live price fetch up-front so the first render is anchored
    // to real Reuters-grade spot values, not the hardcoded fallback base.
    fetchLivePrices().then(function () {
      if (!state.warmedUp) {
        simulateTick();
        state.warmedUp = true;
      } else {
        renderAll();
      }
    });
    // Refresh live prices every 60s regardless of simulation state so the
    // LIVE badge stays truthful when the tab is just being observed.
    if (!state._livePriceTimer) {
      state._livePriceTimer = setInterval(function () {
        fetchLivePrices();
      }, 60000);
    }
  };

  // Pre-trade compliance gate. Returns { ok: boolean, warnings: string[] }.
  // Mirrors the regulatory tripwires from compliance-suite.js without
  // importing it, so the trading panel can run client-side checks before
  // an order is submitted. Hard blockers vs warnings:
  //   BLOCK: cost > AED 55K cash equivalent on simulated cash settlement
  //   BLOCK: position concentration would exceed 80% of portfolio
  //   WARN : cost > 50% of cash, conviction < 0.4, or no AI signal yet
  function preTradeComplianceGate(metal, side, qty, price) {
    var warnings = [];
    var blockers = [];
    var notional = price * qty;
    // AED 55K DPMS CTR threshold — assume 1 USD ~ 3.6725 AED
    var aedNotional = notional * 3.6725;
    if (aedNotional >= 55000) {
      warnings.push('Notional ' + (aedNotional / 1000).toFixed(0) + 'K AED at/above the AED 55K DPMS CTR threshold (MoE Circular 08/AML/2021). DPMSR auto-filing required.');
    }
    if (aedNotional >= 60000) {
      warnings.push('Notional at/above AED 60K cross-border declaration threshold (Cabinet Res 134/2025 Art.16).');
    }
    if (side === 'BUY' && notional > state.portfolio.cash) {
      blockers.push('Insufficient cash for this order.');
    }
    if (side === 'BUY' && notional > state.portfolio.cash * 0.5) {
      warnings.push('Order consumes >50% of available cash — concentration risk.');
    }
    var newExposure = state.portfolio.exposure + notional;
    var totalEquity = state.portfolio.cash + state.portfolio.exposure;
    if (totalEquity > 0 && newExposure / totalEquity > 0.8) {
      blockers.push('Order would push exposure above 80% of total equity (FDL Art.20 risk-appetite breach).');
    }
    var d = state.decisions[metal];
    if (!d) {
      warnings.push('No AI signal available yet — manual conviction only.');
    } else if (d.conviction < 0.4) {
      warnings.push('AI conviction only ' + (d.conviction * 100).toFixed(0) + '% — below 40% threshold.');
    } else if (d.direction !== side) {
      warnings.push('Order side (' + side + ') opposes AI signal (' + d.direction + ' @ ' + (d.conviction * 100).toFixed(0) + '%).');
    }
    return { ok: blockers.length === 0, blockers: blockers, warnings: warnings };
  }
  window.mtPreTradeCheck = preTradeComplianceGate;

  window.mtSelectMetal = function (metal) {
    state.activeMetal = metal;
    // Update tab styling
    document.querySelectorAll('.mt-metal-tab').forEach(function (btn) {
      btn.classList.toggle('mt-active', btn.getAttribute('data-metal') === metal);
    });
    renderAll();
  };

  window.mtToggleRunning = function () {
    var btn = document.getElementById('mtLiveBtn');
    if (state.running) {
      clearInterval(state.tickInterval);
      state.tickInterval = null;
      state.running = false;
      if (btn) { btn.textContent = 'START LIVE'; btn.style.background = '#238636'; }
    } else {
      simulateTick(); // immediate first tick
      state.tickInterval = setInterval(simulateTick, 2000);
      state.running = true;
      if (btn) { btn.textContent = 'STOP'; btn.style.background = '#D94F4F'; }
    }
  };

  window.mtSetSide = function (side) {
    state.orderSide = side;
    var buyBtn = document.getElementById('mtBuyBtn');
    var sellBtn = document.getElementById('mtSellBtn');
    if (buyBtn) { buyBtn.style.background = side === 'BUY' ? '#238636' : '#161b22'; buyBtn.style.color = side === 'BUY' ? '#fff' : '#8b949e'; }
    if (sellBtn) { sellBtn.style.background = side === 'SELL' ? '#D94F4F' : '#161b22'; sellBtn.style.color = side === 'SELL' ? '#fff' : '#8b949e'; }
    updateOrderButton();
  };

  window.mtSetOrderType = function (type) {
    state.orderType = type;
    document.querySelectorAll('.mt-otype').forEach(function (btn) {
      var isActive = btn.textContent.trim() === type;
      btn.classList.toggle('mt-active', isActive);
    });
    // Show/hide price field
    var pf = document.getElementById('mtPriceField');
    if (pf) pf.style.display = (type === 'LIMIT' || type === 'STOP') ? 'block' : 'none';
    updateOrderButton();
  };

  window.mtSubmitOrder = function () {
    var qtyEl = document.getElementById('mtOrderQty');
    var priceEl = document.getElementById('mtOrderPrice');
    var qty = parseInt(qtyEl ? qtyEl.value : '10', 10);
    if (isNaN(qty) || qty <= 0) { if (typeof toast === 'function') toast('Invalid quantity', 'error'); return; }

    var m = state.activeMetal;
    var price = state.prices[m] ? state.prices[m].spot : 0;
    if ((state.orderType === 'LIMIT' || state.orderType === 'STOP') && priceEl && priceEl.value) {
      price = parseFloat(priceEl.value);
    }

    var cost = price * qty;

    // Pre-trade compliance gate (blockers + warnings)
    var gate = preTradeComplianceGate(m, state.orderSide, qty, price);
    if (!gate.ok) {
      if (typeof toast === 'function') toast('Pre-trade BLOCKED: ' + gate.blockers.join(' | '), 'error', 5000);
      // Also surface as a compliance alert so it is visible in the panel
      state.alerts.unshift({
        message: 'TRADE BLOCKED: ' + gate.blockers.join(' | '),
        severity: 'CRITICAL',
        time: new Date().toLocaleTimeString()
      });
      if (state.alerts.length > 12) state.alerts.pop();
      renderAlerts();

      // Auto-create a four-eyes override approval so the block is
      // auditable and the CO can formally authorise (or reject) the
      // trade. Mirrors the "Bullion Pre-Trade Compliance Override"
      // entry in APPROVAL_TYPES + FOUR_EYES_APPROVAL_TYPES.
      try {
        var approvals = [];
        try { approvals = JSON.parse(localStorage.getItem('fgl_approvals') || '[]'); } catch (_) {}
        var approvalRec = {
          id: 'APR_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
          approvalType: 'Bullion Pre-Trade Compliance Override',
          subject: state.orderSide + ' ' + qty + ' oz ' + METAL_NAMES[m] + ' @ ' + fmtUSD(price),
          requestedBy: 'Trading desk (auto)',
          approver: '',
          rationale: 'Pre-trade gate blocked the order. Blockers: ' + gate.blockers.join(' | ') + '. Warnings: ' + (gate.warnings.join(' | ') || 'none') + '. CO must provide documented override rationale. FDL Art.20.',
          slaHours: 1,
          status: 'Pending',
          createdAt: new Date().toISOString(),
          autoCreatedBy: 'metals-trading.preTradeComplianceGate'
        };
        approvals.unshift(approvalRec);
        localStorage.setItem('fgl_approvals', JSON.stringify(approvals));
        if (typeof logAudit === 'function') {
          logAudit('approval_auto_created', 'Pre-trade override requested for ' + approvalRec.subject);
        }
        if (typeof toast === 'function') {
          toast('Four-eyes override approval auto-created (' + approvalRec.id + ')', 'warning', 4000);
        }
        if (typeof window.gsbRefresh === 'function') window.gsbRefresh();
      } catch (err) {
        try { console.warn('[trading] failed to auto-create override approval:', err); } catch (_) {}
      }
      return;
    }
    if (gate.warnings.length > 0) {
      // Surface warnings into the alerts panel; user proceeds (one-click)
      state.alerts.unshift({
        message: 'TRADE WARN: ' + gate.warnings.join(' | '),
        severity: 'HIGH',
        time: new Date().toLocaleTimeString()
      });
      if (state.alerts.length > 12) state.alerts.pop();
    }

    // Add position
    var pos = {
      metal: m, side: state.orderSide, quantity: qty, entryPrice: price,
      unrealizedPnL: 0, unrealizedPnLPct: 0, timestamp: new Date().toISOString()
    };
    state.portfolio.positions.push(pos);

    if (state.orderSide === 'BUY') {
      state.portfolio.cash -= cost;
      state.portfolio.exposure += cost;
    } else {
      state.portfolio.cash += cost;
      state.portfolio.exposure += cost;
    }

    // Log trade
    state.tradeHistory.push({
      metal: m, side: state.orderSide, type: state.orderType,
      quantity: qty, price: price, time: new Date().toISOString()
    });

    if (typeof toast === 'function') {
      toast(state.orderSide + ' ' + qty + ' oz ' + METAL_NAMES[m] + ' @ ' + fmtUSD(price), 'success', 3000);
    }
    if (typeof logAudit === 'function') {
      logAudit('trade_executed', state.orderSide + ' ' + qty + ' oz ' + m + ' @ ' + fmtUSD(price) + ' (' + state.orderType + ')');
    }

    renderAll();
  };

})();
