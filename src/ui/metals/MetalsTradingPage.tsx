// ─── ULTRA MEGA Precious Metals Trading Dashboard ───────────────────────────
// Professional-grade trading interface aligned with world-class standards.
// Panels: Price Ticker, Signals, Alerts, Portfolio, Order Entry, Performance.

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  MetalsTradingBrain,
  createTradingBrain,
} from '../../services/metalsTrading/metalsTradingBrain';
import type {
  Metal,
  TradeSide,
  OrderType,
  TradingAlert,
  FusedDecision,
  Portfolio,
  RiskMetrics,
  MarketRegime,
  SpotSnapshot,
  ArbitrageOpportunity,
} from '../../services/metalsTrading/types';

// ─── Styles ─────────────────────────────────────────────────────────────────

const S = {
  page: { display: 'flex', flexDirection: 'column' as const, gap: 16, width: '100%' },

  topBar: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    padding: '12px 16px',
    background: '#010409',
    borderRadius: 8,
    border: '1px solid #21262d',
    flexWrap: 'wrap' as const,
  },

  metalTab: (active: boolean) =>
    ({
      padding: '8px 18px',
      borderRadius: 6,
      fontSize: 13,
      fontWeight: 700,
      cursor: 'pointer',
      transition: 'all 0.15s',
      border: 'none',
      background: active ? '#d4a843' : '#161b22',
      color: active ? '#0d1117' : '#8b949e',
      letterSpacing: 0.5,
    }) as React.CSSProperties,

  liveBtn: (running: boolean) =>
    ({
      marginLeft: 'auto',
      padding: '8px 20px',
      borderRadius: 6,
      fontSize: 12,
      fontWeight: 700,
      cursor: 'pointer',
      border: 'none',
      letterSpacing: 1,
      background: running ? '#D94F4F' : '#238636',
      color: '#fff',
    }) as React.CSSProperties,

  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
    gap: 14,
  },

  panel: {
    background: '#0d1117',
    border: '1px solid #21262d',
    borderRadius: 8,
    padding: 16,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  } as React.CSSProperties,

  panelTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1.5,
    color: '#d4a843',
    textTransform: 'uppercase' as const,
    borderBottom: '1px solid #21262d',
    paddingBottom: 8,
  } as React.CSSProperties,

  priceMain: {
    fontSize: 32,
    fontWeight: 700,
    color: '#e6edf3',
    lineHeight: 1,
  },

  priceSub: (positive: boolean) => ({
    fontSize: 13,
    fontWeight: 600,
    color: positive ? '#3fb950' : '#f85149',
  }),

  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 },

  label: { color: '#8b949e', fontSize: 11 },
  value: { color: '#e6edf3', fontSize: 12, fontWeight: 600 },

  badge: (color: string) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 700,
    background: color + '22',
    color,
    letterSpacing: 0.5,
  }),

  alertItem: (severity: string) =>
    ({
      padding: '8px 10px',
      borderRadius: 6,
      fontSize: 11,
      lineHeight: 1.5,
      borderLeft: `3px solid ${
        severity === 'CRITICAL'
          ? '#f85149'
          : severity === 'HIGH'
            ? '#E8A030'
            : severity === 'MEDIUM'
              ? '#d4a843'
              : '#3fb950'
      }`,
      background: '#161b22',
    }) as React.CSSProperties,

  signalBar: (direction: string, strength: number) => ({
    height: 6,
    borderRadius: 3,
    background:
      direction === 'BUY'
        ? `linear-gradient(90deg, #238636 0%, #3fb950 ${strength * 100}%, #21262d ${strength * 100}%)`
        : `linear-gradient(90deg, #D94F4F 0%, #f85149 ${strength * 100}%, #21262d ${strength * 100}%)`,
    width: '100%',
  }),

  posRow: (pnl: number) => ({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 8px',
    borderRadius: 4,
    fontSize: 11,
    background: '#161b22',
    borderLeft: `3px solid ${pnl >= 0 ? '#3fb950' : '#f85149'}`,
  }),

  input: {
    background: '#010409',
    border: '1px solid #30363d',
    borderRadius: 4,
    color: '#e6edf3',
    padding: '6px 8px',
    fontSize: 12,
    width: '100%',
    outline: 'none',
  } as React.CSSProperties,

  select: {
    background: '#010409',
    border: '1px solid #30363d',
    borderRadius: 4,
    color: '#e6edf3',
    padding: '6px 8px',
    fontSize: 12,
    outline: 'none',
  } as React.CSSProperties,

  btn: (variant: 'buy' | 'sell' | 'neutral') =>
    ({
      padding: '10px 0',
      borderRadius: 6,
      fontSize: 13,
      fontWeight: 700,
      cursor: 'pointer',
      border: 'none',
      width: '100%',
      letterSpacing: 0.5,
      background: variant === 'buy' ? '#238636' : variant === 'sell' ? '#D94F4F' : '#30363d',
      color: '#fff',
      transition: 'opacity 0.15s',
    }) as React.CSSProperties,

  stat: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '8px 4px',
    flex: 1,
    gap: 2,
  } as React.CSSProperties,

  statValue: { fontSize: 16, fontWeight: 700, color: '#e6edf3' },
  statLabel: {
    fontSize: 9,
    color: '#8b949e',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
  },

  equityBar: (pct: number, positive: boolean) => ({
    height: 4,
    borderRadius: 2,
    background: positive
      ? `linear-gradient(90deg, #238636 0%, #3fb950 ${Math.min(pct, 100)}%, #21262d ${Math.min(pct, 100)}%)`
      : `linear-gradient(90deg, #D94F4F 0%, #f85149 ${Math.min(Math.abs(pct), 100)}%, #21262d ${Math.min(Math.abs(pct), 100)}%)`,
    width: '100%',
  }),

  arbCard: {
    padding: '8px 10px',
    borderRadius: 6,
    fontSize: 11,
    background: '#161b22',
    borderLeft: '3px solid #d4a843',
  } as React.CSSProperties,

  regimeBadge: (regime: MarketRegime) => {
    const colors: Record<MarketRegime, string> = {
      TRENDING_UP: '#3fb950',
      TRENDING_DOWN: '#f85149',
      RANGING: '#8b949e',
      HIGH_VOLATILITY: '#E8A030',
      BREAKOUT: '#d4a843',
      MEAN_REVERSION: '#a371f7',
    };
    return {
      display: 'inline-block',
      padding: '3px 10px',
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 700,
      background: (colors[regime] ?? '#8b949e') + '22',
      color: colors[regime] ?? '#8b949e',
      letterSpacing: 0.5,
    };
  },

  simTag: {
    padding: '3px 8px',
    borderRadius: 4,
    fontSize: 9,
    fontWeight: 700,
    background: '#E8A03022',
    color: '#E8A030',
    letterSpacing: 1,
  },
};

// ─── Formatting Helpers ─────────────────────────────────────────────────────

function fmtUSD(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function fmtNum(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

const METAL_NAMES: Record<Metal, string> = {
  XAU: 'GOLD',
  XAG: 'SILVER',
  XPT: 'PLATINUM',
  XPD: 'PALLADIUM',
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function MetalsTradingPage() {
  const brainRef = useRef<MetalsTradingBrain | null>(null);
  const [activeMetal, setActiveMetal] = useState<Metal>('XAU');
  const [running, setRunning] = useState(false);
  const [tickCount, setTickCount] = useState(0);

  // State snapshots (refreshed on each tick)
  const [snapshot, setSnapshot] = useState<SpotSnapshot | null>(null);
  const [decision, setDecision] = useState<FusedDecision | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [riskMetrics, setRiskMetrics] = useState<RiskMetrics | null>(null);
  const [alerts, setAlerts] = useState<TradingAlert[]>([]);
  const [arbOpps, setArbOpps] = useState<ArbitrageOpportunity[]>([]);
  const [regime, setRegime] = useState<MarketRegime>('RANGING');
  const [commentary, setCommentary] = useState('');
  const [gsRatio, setGsRatio] = useState<{ ratio: number; signal: string } | null>(null);

  // Order entry
  const [orderSide, setOrderSide] = useState<TradeSide>('BUY');
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [orderQty, setOrderQty] = useState('10');
  const [orderPrice, setOrderPrice] = useState('');

  // Initialize brain
  useEffect(() => {
    if (!brainRef.current) {
      brainRef.current = createTradingBrain();
    }
  }, []);

  // Tick handler
  const doTick = useCallback(() => {
    const brain = brainRef.current;
    if (!brain) return;

    const responses = brain.tick();
    const resp = responses.find((r) => r.decision.metal === activeMetal);

    setSnapshot(brain.oracle.getSnapshot(activeMetal));
    setDecision(resp?.decision ?? brain.getDecision(activeMetal) ?? null);
    setPortfolio(brain.positions.getPortfolio());
    setRiskMetrics(brain.positions.computeRiskMetrics([]));
    setAlerts(brain.alerts.getActive().slice(-12));
    setArbOpps(brain.arbitrage.getHistory().slice(-5));
    setRegime(brain.getRegime(activeMetal));
    setCommentary(resp?.marketCommentary ?? '');
    setGsRatio(brain.oracle.getGoldSilverRatio());
    setTickCount((c) => c + 1);
  }, [activeMetal]);

  // Auto-tick when running
  useEffect(() => {
    if (!running) return;
    const id = setInterval(doTick, 2000);
    return () => clearInterval(id);
  }, [running, doTick]);

  // Toggle simulation
  const toggleRunning = () => {
    if (running) {
      brainRef.current?.stopSimulation();
      setRunning(false);
    } else {
      doTick(); // immediate first tick
      setRunning(true);
    }
  };

  // Submit order
  const submitOrder = () => {
    const brain = brainRef.current;
    if (!brain) return;
    const qty = parseInt(orderQty, 10);
    if (isNaN(qty) || qty <= 0) return;

    brain.engine.submitOrder({
      metal: activeMetal,
      side: orderSide,
      type: orderType,
      quantity: qty,
      price: orderPrice ? parseFloat(orderPrice) : undefined,
      venue: 'DMCC',
    });

    // Refresh state
    setPortfolio(brain.positions.getPortfolio());
    setRiskMetrics(brain.positions.computeRiskMetrics([]));
  };

  // ─── Render ─────────────────────────────────────────────────────────

  const metals: Metal[] = ['XAU', 'XAG', 'XPT', 'XPD'];

  return (
    <div style={S.page}>
      {/* ── Top Bar: Metal Tabs + Controls ── */}
      <div style={S.topBar}>
        {metals.map((m) => (
          <button key={m} style={S.metalTab(activeMetal === m)} onClick={() => setActiveMetal(m)}>
            {METAL_NAMES[m]}
          </button>
        ))}
        <span style={S.simTag}>SIMULATION</span>
        {gsRatio && (
          <span style={{ fontSize: 10, color: '#8b949e', marginLeft: 8 }}>
            G/S: {gsRatio.ratio.toFixed(1)}
          </span>
        )}
        <span style={{ fontSize: 10, color: '#484f58', marginLeft: 4 }}>Tick #{tickCount}</span>
        <button style={S.liveBtn(running)} onClick={toggleRunning}>
          {running ? 'STOP' : 'START LIVE'}
        </button>
      </div>

      {/* ── Main Grid ── */}
      <div style={S.grid}>
        {/* ── Price Panel ── */}
        <div style={S.panel}>
          <div style={S.panelTitle}>SPOT PRICE</div>
          {snapshot ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <span style={S.priceMain}>{fmtUSD(snapshot.spotUSD)}</span>
                <span style={S.priceSub(snapshot.changePct24h >= 0)}>
                  {fmtPct(snapshot.changePct24h)}
                </span>
              </div>
              <div style={S.regimeBadge(regime)}>{regime.replace(/_/g, ' ')}</div>
              <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
                <div>
                  <span style={S.label}>24h High </span>
                  <span style={S.value}>{fmtUSD(snapshot.high24h)}</span>
                </div>
                <div>
                  <span style={S.label}>24h Low </span>
                  <span style={S.value}>{fmtUSD(snapshot.low24h)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div>
                  <span style={S.label}>Volume </span>
                  <span style={S.value}>{fmtNum(snapshot.volume24h, 0)} oz</span>
                </div>
                <div>
                  <span style={S.label}>Change </span>
                  <span style={S.value}>{fmtUSD(snapshot.change24h)}</span>
                </div>
              </div>
            </>
          ) : (
            <div style={{ color: '#484f58', fontSize: 12 }}>Press START LIVE to begin</div>
          )}
        </div>

        {/* ── Signal Decision Panel ── */}
        <div style={S.panel}>
          <div style={S.panelTitle}>AI SIGNAL FUSION</div>
          {decision && decision.signals.length > 0 ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={S.badge(decision.direction === 'BUY' ? '#3fb950' : '#f85149')}>
                  {decision.direction}
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3' }}>
                  {(decision.conviction * 100).toFixed(0)}% conviction
                </span>
              </div>
              <div style={S.signalBar(decision.direction, decision.conviction)} />
              <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
                <div>
                  <span style={S.label}>Entry </span>
                  <span style={S.value}>{fmtUSD(decision.entryPrice)}</span>
                </div>
                <div>
                  <span style={S.label}>Target </span>
                  <span style={{ ...S.value, color: '#3fb950' }}>
                    {fmtUSD(decision.targetPrice)}
                  </span>
                </div>
                <div>
                  <span style={S.label}>Stop </span>
                  <span style={{ ...S.value, color: '#f85149' }}>{fmtUSD(decision.stopLoss)}</span>
                </div>
              </div>
              <div style={{ fontSize: 10, color: '#8b949e' }}>
                R:R {decision.riskReward.toFixed(2)} | Alignment{' '}
                {(decision.signalAlignment * 100).toFixed(0)}% | {decision.signals.length} signals
              </div>
              {decision.signals.map((sig, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 10,
                    color: '#8b949e',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={S.badge(sig.direction === 'BUY' ? '#3fb950' : '#f85149')}>
                    {sig.source}
                  </span>
                  <span>{(sig.confidence * 100).toFixed(0)}%</span>
                </div>
              ))}
            </>
          ) : (
            <div style={{ color: '#484f58', fontSize: 12 }}>No signals — standing aside</div>
          )}
        </div>

        {/* ── Order Entry ── */}
        <div style={S.panel}>
          <div style={S.panelTitle}>ORDER ENTRY</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={S.btn(orderSide === 'BUY' ? 'buy' : 'neutral')}
              onClick={() => setOrderSide('BUY')}
            >
              BUY
            </button>
            <button
              style={S.btn(orderSide === 'SELL' ? 'sell' : 'neutral')}
              onClick={() => setOrderSide('SELL')}
            >
              SELL
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['MARKET', 'LIMIT', 'STOP', 'TWAP', 'VWAP', 'ICEBERG'] as OrderType[]).map((t) => (
              <button
                key={t}
                style={{
                  ...S.select,
                  cursor: 'pointer',
                  fontWeight: orderType === t ? 700 : 400,
                  color: orderType === t ? '#d4a843' : '#8b949e',
                  background: orderType === t ? '#21262d' : '#010409',
                }}
                onClick={() => setOrderType(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={S.label}>Quantity (oz)</div>
              <input
                style={S.input}
                type="number"
                value={orderQty}
                onChange={(e) => setOrderQty(e.target.value)}
                min="1"
              />
            </div>
            {(orderType === 'LIMIT' || orderType === 'STOP') && (
              <div style={{ flex: 1 }}>
                <div style={S.label}>Price (USD)</div>
                <input
                  style={S.input}
                  type="number"
                  value={orderPrice}
                  onChange={(e) => setOrderPrice(e.target.value)}
                  step="0.01"
                />
              </div>
            )}
          </div>
          <button style={S.btn(orderSide === 'BUY' ? 'buy' : 'sell')} onClick={submitOrder}>
            {orderSide} {orderQty} oz {METAL_NAMES[activeMetal]} @ {orderType}
          </button>
          {decision && decision.conviction > 0.4 && (
            <div style={{ fontSize: 10, color: '#d4a843', textAlign: 'center' }}>
              AI suggests: {decision.direction} with {(decision.conviction * 100).toFixed(0)}%
              conviction
            </div>
          )}
        </div>

        {/* ── Portfolio ── */}
        <div style={S.panel}>
          <div style={S.panelTitle}>PORTFOLIO</div>
          {portfolio ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-around' }}>
                <div style={S.stat}>
                  <span style={S.statValue}>{fmtUSD(portfolio.cashBalance, 0)}</span>
                  <span style={S.statLabel}>Cash</span>
                </div>
                <div style={S.stat}>
                  <span style={S.statValue}>{fmtUSD(portfolio.totalMarketValue, 0)}</span>
                  <span style={S.statLabel}>Exposure</span>
                </div>
                <div style={S.stat}>
                  <span
                    style={{
                      ...S.statValue,
                      color: portfolio.totalPnL >= 0 ? '#3fb950' : '#f85149',
                    }}
                  >
                    {fmtUSD(portfolio.totalPnL, 0)}
                  </span>
                  <span style={S.statLabel}>P&L</span>
                </div>
              </div>
              <div
                style={S.equityBar(Math.abs(portfolio.totalPnLPct) * 5, portfolio.totalPnL >= 0)}
              />
              {portfolio.positions.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {portfolio.positions.map((pos, i) => (
                    <div key={i} style={S.posRow(pos.unrealizedPnL)}>
                      <span>
                        <span style={S.badge(pos.side === 'BUY' ? '#3fb950' : '#f85149')}>
                          {pos.side}
                        </span>{' '}
                        {pos.quantity} oz {pos.metal}
                      </span>
                      <span
                        style={{
                          color: pos.unrealizedPnL >= 0 ? '#3fb950' : '#f85149',
                          fontWeight: 600,
                        }}
                      >
                        {fmtUSD(pos.unrealizedPnL)} ({fmtPct(pos.unrealizedPnLPct)})
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: '#484f58', fontSize: 11, textAlign: 'center' }}>
                  No open positions
                </div>
              )}
            </>
          ) : (
            <div style={{ color: '#484f58', fontSize: 12 }}>No portfolio data</div>
          )}
        </div>

        {/* ── Risk Metrics ── */}
        <div style={S.panel}>
          <div style={S.panelTitle}>RISK MATRIX</div>
          {riskMetrics ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-around' }}>
                <div style={S.stat}>
                  <span style={S.statValue}>{fmtUSD(riskMetrics.valueAtRisk1d, 0)}</span>
                  <span style={S.statLabel}>VaR (1d)</span>
                </div>
                <div style={S.stat}>
                  <span style={S.statValue}>{fmtPct(riskMetrics.currentDrawdownPct)}</span>
                  <span style={S.statLabel}>Drawdown</span>
                </div>
                <div style={S.stat}>
                  <span style={S.statValue}>{(riskMetrics.winRate * 100).toFixed(0)}%</span>
                  <span style={S.statLabel}>Win Rate</span>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-around' }}>
                <div style={S.stat}>
                  <span style={S.statValue}>{riskMetrics.sharpeRatio.toFixed(2)}</span>
                  <span style={S.statLabel}>Sharpe</span>
                </div>
                <div style={S.stat}>
                  <span style={S.statValue}>
                    {riskMetrics.profitFactor === Infinity
                      ? '---'
                      : riskMetrics.profitFactor.toFixed(2)}
                  </span>
                  <span style={S.statLabel}>Profit Factor</span>
                </div>
                <div style={S.stat}>
                  <span style={S.statValue}>{(riskMetrics.kellyFraction * 100).toFixed(1)}%</span>
                  <span style={S.statLabel}>Kelly F</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
                <div>
                  <span style={S.label}>Daily P&L </span>
                  <span
                    style={{ ...S.value, color: riskMetrics.dailyPnL >= 0 ? '#3fb950' : '#f85149' }}
                  >
                    {fmtUSD(riskMetrics.dailyPnL)}
                  </span>
                </div>
                <div>
                  <span style={S.label}>Weekly </span>
                  <span
                    style={{
                      ...S.value,
                      color: riskMetrics.weeklyPnL >= 0 ? '#3fb950' : '#f85149',
                    }}
                  >
                    {fmtUSD(riskMetrics.weeklyPnL)}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div style={{ color: '#484f58', fontSize: 12 }}>No risk data</div>
          )}
        </div>

        {/* ── Alerts ── */}
        <div style={S.panel}>
          <div style={S.panelTitle}>WEAPONIZED ALERTS ({alerts.length})</div>
          {alerts.length > 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 260,
                overflowY: 'auto',
              }}
            >
              {alerts
                .slice()
                .reverse()
                .map((alert) => (
                  <div key={alert.id} style={S.alertItem(alert.severity)}>
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}
                    >
                      <span style={{ fontWeight: 700, color: '#e6edf3' }}>{alert.title}</span>
                      <span
                        style={S.badge(
                          alert.severity === 'CRITICAL'
                            ? '#f85149'
                            : alert.severity === 'HIGH'
                              ? '#E8A030'
                              : '#d4a843'
                        )}
                      >
                        {alert.severity}
                      </span>
                    </div>
                    <div style={{ color: '#8b949e' }}>{alert.message}</div>
                    {alert.suggestedAction && (
                      <div style={{ color: '#d4a843', marginTop: 4, fontWeight: 600 }}>
                        {alert.suggestedAction}
                      </div>
                    )}
                    <div style={{ color: '#484f58', fontSize: 9, marginTop: 2 }}>
                      {timeAgo(alert.createdAt)}
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div style={{ color: '#484f58', fontSize: 11, textAlign: 'center' }}>
              No active alerts
            </div>
          )}
        </div>

        {/* ── Arbitrage Opportunities ── */}
        <div style={S.panel}>
          <div style={S.panelTitle}>ARBITRAGE SCANNER</div>
          {arbOpps.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {arbOpps.map((arb) => (
                <div key={arb.id} style={S.arbCard}>
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}
                  >
                    <span style={{ fontWeight: 700, color: '#e6edf3' }}>
                      {arb.type.replace(/_/g, ' ')}
                    </span>
                    <span style={{ color: '#3fb950', fontWeight: 700 }}>
                      {fmtUSD(arb.netProfit, 0)}
                    </span>
                  </div>
                  <div style={{ color: '#8b949e' }}>
                    {arb.venueA} → {arb.venueB} | Spread: {arb.spreadPct.toFixed(2)}%
                  </div>
                  <div style={{ color: '#484f58', fontSize: 9 }}>
                    Conf: {(arb.confidence * 100).toFixed(0)}% | Costs:{' '}
                    {fmtUSD(arb.estimatedCosts, 0)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: '#484f58', fontSize: 11, textAlign: 'center' }}>
              Scanning for opportunities...
            </div>
          )}
        </div>

        {/* ── Performance Stats ── */}
        <div style={S.panel}>
          <div style={S.panelTitle}>PERFORMANCE</div>
          {(() => {
            const stats = brainRef.current?.positions.getPerformanceStats();
            if (!stats || stats.totalTrades === 0) {
              return (
                <div style={{ color: '#484f58', fontSize: 11, textAlign: 'center' }}>
                  Execute trades to see performance
                </div>
              );
            }
            return (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-around' }}>
                  <div style={S.stat}>
                    <span style={S.statValue}>{stats.totalTrades}</span>
                    <span style={S.statLabel}>Trades</span>
                  </div>
                  <div style={S.stat}>
                    <span style={S.statValue}>{(stats.winRate * 100).toFixed(0)}%</span>
                    <span style={S.statLabel}>Win Rate</span>
                  </div>
                  <div style={S.stat}>
                    <span
                      style={{
                        ...S.statValue,
                        color: stats.totalReturn >= 0 ? '#3fb950' : '#f85149',
                      }}
                    >
                      {fmtUSD(stats.totalReturn, 0)}
                    </span>
                    <span style={S.statLabel}>Total Return</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
                  <div>
                    <span style={S.label}>Best </span>
                    <span style={{ color: '#3fb950', fontWeight: 600 }}>
                      {fmtUSD(stats.bestTrade?.pnl ?? 0)}
                    </span>
                  </div>
                  <div>
                    <span style={S.label}>Worst </span>
                    <span style={{ color: '#f85149', fontWeight: 600 }}>
                      {fmtUSD(stats.worstTrade?.pnl ?? 0)}
                    </span>
                  </div>
                  <div>
                    <span style={S.label}>Avg </span>
                    <span style={S.value}>{fmtUSD(stats.avgReturn)}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
                  <div>
                    <span style={S.label}>Streak W </span>
                    <span style={S.value}>{stats.streaks.currentWin}</span>
                  </div>
                  <div>
                    <span style={S.label}>Streak L </span>
                    <span style={S.value}>{stats.streaks.currentLoss}</span>
                  </div>
                  <div>
                    <span style={S.label}>P.Factor </span>
                    <span style={S.value}>
                      {stats.profitFactor === Infinity ? '---' : stats.profitFactor.toFixed(2)}
                    </span>
                  </div>
                </div>
              </>
            );
          })()}
        </div>

        {/* ── Market Commentary ── */}
        <div style={S.panel}>
          <div style={S.panelTitle}>MARKET COMMENTARY</div>
          <div style={{ fontSize: 12, color: '#e6edf3', lineHeight: 1.6 }}>
            {commentary || 'Start the simulation to receive AI market commentary.'}
          </div>
          {gsRatio && (
            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>
              Gold/Silver Ratio: {gsRatio.ratio.toFixed(1)} — {gsRatio.signal}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
