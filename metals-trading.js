// ═══════════════════════════════════════════════════════════════════════════
// PRECIOUS METALS TRADING — Vanilla JS Simulation Engine
// Mirrors src/ui/metals/MetalsTradingPage.tsx for the vanilla HTML app.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────────────────
  var METALS = ['XAU', 'XAG', 'XPT', 'XPD'];
  var METAL_NAMES = { XAU: 'GOLD', XAG: 'SILVER', XPT: 'PLATINUM', XPD: 'PALLADIUM' };
  var BASE_PRICES = { XAU: 2345.60, XAG: 29.15, XPT: 985.40, XPD: 1025.70 };
  var VOLATILITY = { XAU: 0.008, XAG: 0.015, XPT: 0.012, XPD: 0.018 };
  var SIGNAL_SOURCES = ['RSI', 'MACD', 'BOLLINGER', 'FLOW', 'MICROSTRUCTURE', 'PATTERN'];
  var REGIMES = ['TRENDING_UP', 'TRENDING_DOWN', 'RANGING', 'HIGH_VOLATILITY', 'BREAKOUT'];

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
    tradeHistory: []
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
    renderTopBar();
    updateOrderButton();
  }

  function renderTopBar() {
    var el = document.getElementById('mtTickCount');
    if (el) el.textContent = 'Tick #' + state.tickCount;

    var gsEl = document.getElementById('mtGsRatio');
    if (gsEl && state.gsRatio) {
      gsEl.textContent = 'G/S: ' + state.gsRatio.ratio.toFixed(1);
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
    // Reset prices for fresh open if needed
    renderAll();
  };

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

    // Check if enough cash for BUY
    if (state.orderSide === 'BUY' && cost > state.portfolio.cash) {
      if (typeof toast === 'function') toast('Insufficient cash for this order', 'error');
      return;
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
