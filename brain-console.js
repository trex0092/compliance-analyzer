/**
 * Brain Console — Hawkeye Sterling V2 integration.
 *
 * Vanilla-JS panel that lives inside the legacy SPA as a tab.
 * Connects to the Netlify cron functions (autopilot, retry queue,
 * skill handler, AI governance) so the MLRO has a single-glance
 * view of the brain stack from the same app where they manage
 * compliance day-to-day.
 *
 * Loaded from index.html as <script src="brain-console.js">.
 * The legacy switchTab('brain') handler in app-core.js calls
 * BrainConsole.init() the first time the tab is opened.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO/MLRO visibility)
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review)
 *   - NIST AI RMF 1.0 MANAGE-2 (AI decision provenance)
 */
(function () {
  'use strict';

  const NETLIFY_BASE = window.location.origin;

  // The 4 autopilot crons we built this session, plus the
  // pre-existing retry queue cron.
  const CRON_ENDPOINTS = [
    {
      id: 'autopilot',
      name: 'Super-Brain Autopilot',
      path: '/.netlify/functions/asana-super-brain-autopilot-cron',
      description: 'Walks open compliance cases and dispatches the brain. Runs every 15 minutes.',
      icon: '🚀',
      regulatory: 'FDL No.10/2025 Art.19-21; Cabinet Res 134/2025 Art.19',
    },
    {
      id: 'skills',
      name: 'Asana Comment Skill Handler',
      path: '/.netlify/functions/asana-comment-skill-handler',
      description:
        'Watches Asana comments for slash commands like /screen or /audit. Runs every minute.',
      icon: '⚡',
      regulatory: 'FDL No.10/2025 Art.20-21',
    },
    {
      id: 'governance',
      name: 'AI Governance Self-Audit',
      path: '/.netlify/functions/ai-governance-self-audit-cron',
      description:
        'Daily self-audit against EU AI Act, NIST AI RMF, ISO/IEC 42001, UAE AI Charter. Runs at 02:00 UTC.',
      icon: '🛡️',
      regulatory: 'EU Reg 2024/1689 Art.27; NIST AI RMF 1.0; ISO/IEC 42001:2023',
    },
    {
      id: 'retry',
      name: 'Asana Retry Queue Drain',
      path: '/.netlify/functions/asana-retry-queue-cron',
      description: 'Drains the failed-task retry queue. Runs every minute.',
      icon: '🔄',
      regulatory: 'FDL No.10/2025 Art.24',
    },
    {
      id: 'toaststream',
      name: 'Asana Toast Stream',
      path: '/api/asana-toast-stream',
      description: 'Polling endpoint for SPA toast events. Drains pending events on call.',
      icon: '📨',
      regulatory: 'Cabinet Res 134/2025 Art.19',
      requiresAuth: true,
    },
  ];

  const TIER_FEATURES = [
    {
      tier: 'A',
      title: 'Real Execution',
      items: [
        'Skill executor with pluggable runners + 30s timeout',
        'Enhanced brain dispatcher (real megaBrain pipeline)',
        'Real goAML XML generator with full validation',
      ],
    },
    {
      tier: 'B',
      title: 'Cognition',
      items: [
        'Dispatch pattern miner (signature clustering)',
        'Priority scorer (risk × urgency × criticality)',
        'Reasoning chain replay with sealed tamper detection',
        'Shapley brain overlay (per-feature contribution)',
      ],
    },
    {
      tier: 'C',
      title: 'Operational Muscle',
      items: [
        'Four-eyes completion detector',
        'Smart retry classifier (HTTP/network/timeout)',
        'Skill dead-letter queue (5-strike)',
        'Per-tenant token-bucket rate budgeter',
      ],
    },
    {
      tier: 'D',
      title: 'Regulatory Firepower',
      items: [
        'EOCN delta watcher (pure diff)',
        'MoE circular ingestor (14-area classifier)',
        'FIU acknowledgement auto-ingest',
        'Auto-freeze plan executor (24h EOCN + 5bd CNMR)',
      ],
    },
    {
      tier: 'E',
      title: 'Horizon',
      items: [
        'Federated learning data prep (anonymization)',
        'Voice command adapter (transcript → slash command)',
        'Board report pipeline (quarterly aggregator)',
        'AI governance self-audit watchdog',
      ],
    },
  ];

  // ────────────────────────────────────────────────────────────────
  // Styling helpers (match the legacy SPA palette)
  // ────────────────────────────────────────────────────────────────

  const STYLE = {
    panel:
      'background:#161b22;border:1px solid #21262d;border-radius:8px;padding:16px;margin-bottom:12px;',
    cardOk:
      'background:#0f2a1b;border:1px solid #3DA87644;border-left:3px solid #3DA876;border-radius:6px;padding:12px;margin-bottom:8px;',
    cardErr:
      'background:#2a1012;border:1px solid #D94F4F44;border-left:3px solid #D94F4F;border-radius:6px;padding:12px;margin-bottom:8px;',
    cardWarn:
      'background:#1f2933;border:1px solid #E8A03044;border-left:3px solid #E8A030;border-radius:6px;padding:12px;margin-bottom:8px;',
    cardNeutral:
      'background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:12px;margin-bottom:8px;',
    btnPrimary:
      'padding:8px 20px;background:#d4a843;color:#000;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:0.5px;',
    btnSecondary:
      'padding:6px 14px;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:6px;font-size:11px;cursor:pointer;',
    code: 'background:#010409;color:#3DA876;padding:8px 12px;border-radius:4px;font-family:monospace;font-size:11px;white-space:pre-wrap;word-break:break-all;',
    label:
      'font-size:11px;color:#8b949e;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;',
    input:
      'padding:6px 10px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;font-size:11px;',
  };

  // ────────────────────────────────────────────────────────────────
  // State
  // ────────────────────────────────────────────────────────────────

  let initialized = false;
  let cronStates = {}; // id → { status, lastResponse, lastCheckedAt }

  // The Brain token is set + persisted via the Settings tab
  // (Settings → Hawkeye Brain Token field). app-core.js hydrateKeys()
  // runs at boot and injects it into window.HAWKEYE_BRAIN_TOKEN before
  // the Brain Console is ever opened, so this file only READS from
  // window — no separate storage, no separate input. Single source
  // of truth = Settings tab.

  // ────────────────────────────────────────────────────────────────
  // Cron probe — calls a Netlify function, captures the response
  // ────────────────────────────────────────────────────────────────

  async function probeCron(cron) {
    const start = Date.now();
    cronStates[cron.id] = { status: 'pending', lastCheckedAt: new Date().toISOString() };
    renderCronList();

    try {
      const headers = {};
      if (cron.requiresAuth) {
        // Read token from window (injected by env var or settings)
        const token = window.HAWKEYE_BRAIN_TOKEN;
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        } else {
          cronStates[cron.id] = {
            status: 'unauthed',
            error:
              'HAWKEYE_BRAIN_TOKEN not in window — open the Settings tab → "Hawkeye Brain Token" field → paste + Update Keys',
            lastCheckedAt: new Date().toISOString(),
            durationMs: Date.now() - start,
          };
          renderCronList();
          return;
        }
      }

      const response = await fetch(NETLIFY_BASE + cron.path, { headers });
      const text = await response.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text.slice(0, 500) };
      }

      cronStates[cron.id] = {
        status: response.ok ? 'ok' : 'error',
        httpStatus: response.status,
        lastResponse: parsed,
        lastCheckedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      cronStates[cron.id] = {
        status: 'error',
        error: err.message || String(err),
        lastCheckedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
      };
    }
    renderCronList();
  }

  async function probeAllCrons() {
    for (const cron of CRON_ENDPOINTS) {
      await probeCron(cron);
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Renderers
  // ────────────────────────────────────────────────────────────────

  function statusBadge(state) {
    if (!state) return '<span style="color:#484f58;font-size:10px;">UNTESTED</span>';
    if (state.status === 'pending')
      return '<span style="color:#E8A030;font-size:10px;font-weight:700;">PROBING…</span>';
    if (state.status === 'ok')
      return '<span style="color:#3DA876;font-size:10px;font-weight:700;">✓ ALIVE</span>';
    if (state.status === 'unauthed')
      return '<span style="color:#E8A030;font-size:10px;font-weight:700;">⚠ NEEDS AUTH</span>';
    return '<span style="color:#D94F4F;font-size:10px;font-weight:700;">✗ ERROR</span>';
  }

  function renderCronList() {
    const container = document.getElementById('brain-cron-list');
    if (!container) return;

    container.innerHTML = CRON_ENDPOINTS.map((cron) => {
      const state = cronStates[cron.id];
      const cardStyle = !state
        ? STYLE.cardNeutral
        : state.status === 'ok'
          ? STYLE.cardOk
          : state.status === 'pending'
            ? STYLE.cardWarn
            : STYLE.cardErr;

      const lastResp =
        state && state.lastResponse
          ? `<div style="${STYLE.code}margin-top:8px;">${escapeHtml(JSON.stringify(state.lastResponse, null, 2))}</div>`
          : state && state.error
            ? `<div style="${STYLE.code}margin-top:8px;color:#D94F4F;">${escapeHtml(state.error)}</div>`
            : '';

      const meta = state
        ? `<div style="font-size:9px;color:#484f58;margin-top:4px;">HTTP ${state.httpStatus || '—'} · ${state.durationMs || 0}ms · ${state.lastCheckedAt ? state.lastCheckedAt.slice(11, 19) : '—'}</div>`
        : '';

      return `
        <div style="${cardStyle}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="color:#e6edf3;font-size:13px;">${cron.icon} ${escapeHtml(cron.name)}</strong>
            ${statusBadge(state)}
          </div>
          <div style="font-size:11px;color:#8b949e;line-height:1.5;margin-bottom:4px;">${escapeHtml(cron.description)}</div>
          <div style="font-size:9px;color:#484f58;font-style:italic;">${escapeHtml(cron.regulatory)}</div>
          <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
            <button data-brain-action="probe" data-cron-id="${cron.id}" style="${STYLE.btnSecondary}">▶ Probe</button>
            <a href="${NETLIFY_BASE + cron.path}" target="_blank" rel="noopener" style="${STYLE.btnSecondary}text-decoration:none;display:inline-block;">↗ Open URL</a>
          </div>
          ${meta}
          ${lastResp}
        </div>
      `;
    }).join('');

    // Wire up the probe buttons (event delegation through a single listener)
    container.querySelectorAll('button[data-brain-action="probe"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-cron-id');
        const cron = CRON_ENDPOINTS.find((c) => c.id === id);
        if (cron) probeCron(cron);
      });
    });
  }

  function renderTierSummary() {
    return `
      <div style="${STYLE.panel}">
        <div style="${STYLE.label}">19 BRAIN PRIMITIVES SHIPPED THIS SESSION</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:10px;">
          ${TIER_FEATURES.map(
            (tier) => `
            <div style="background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:10px;">
              <div style="font-size:11px;color:#d4a843;font-weight:700;margin-bottom:6px;">TIER ${tier.tier} — ${tier.title}</div>
              <ul style="margin:0;padding-left:16px;font-size:10px;color:#8b949e;line-height:1.6;">
                ${tier.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
              </ul>
            </div>
          `
          ).join('')}
        </div>
      </div>
    `;
  }

  function renderHeader() {
    return `
      <div style="${STYLE.panel}border-left:4px solid #d4a843;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:18px;font-weight:700;color:#d4a843;letter-spacing:0.5px;">🧠 BRAIN CONSOLE</div>
            <div style="font-size:11px;color:#8b949e;margin-top:4px;">
              Single-glance view of the super-brain stack running on Netlify.
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button id="brain-probe-all" style="${STYLE.btnPrimary}">▶ PROBE ALL CRONS</button>
            <button id="brain-refresh" style="${STYLE.btnSecondary}">↻ Refresh status</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderHelp() {
    return `
      <div style="${STYLE.panel}">
        <div style="${STYLE.label}">HOW TO USE</div>
        <div style="font-size:12px;color:#e6edf3;line-height:1.7;margin-top:8px;">
          <strong style="color:#d4a843;">▶ Probe All Crons</strong> — pings every Netlify function and shows the JSON response inline. Use this after a redeploy to verify the brain stack is healthy.
          <br><br>
          <strong style="color:#d4a843;">Slash commands in Asana</strong> — type <code style="${STYLE.code}display:inline-block;padding:2px 6px;">/audit</code>, <code style="${STYLE.code}display:inline-block;padding:2px 6px;">/screen ACME</code>, or <code style="${STYLE.code}display:inline-block;padding:2px 6px;">/incident case-1</code> as a comment on any Asana task. Within 60 seconds the skill handler cron picks it up and posts a reply.
          <br><br>
          <strong style="color:#d4a843;">15-minute autopilot</strong> — every 15 minutes the autopilot cron walks open compliance cases and dispatches the brain. No human click needed.
          <br><br>
          <strong style="color:#d4a843;">Daily AI governance</strong> — every day at 02:00 UTC the AI Governance watchdog scores the system against four regulatory frameworks. If the score drops below 80, it opens a critical Asana task automatically.
        </div>
      </div>
    `;
  }

  // ────────────────────────────────────────────────────────────────
  // LIVE BRAIN ANALYSIS — calls /api/brain/analyze end-to-end.
  //
  // This is the FIRST UI surface that actually executes the Weaponized
  // Brain (MegaBrain + 30+ subsystems + advisor + zk-attestation +
  // four-eyes) in a deployed environment. Everything above this block
  // is cron health + static content.
  // ────────────────────────────────────────────────────────────────

  const ANALYSIS_FEATURE_DEFS = [
    {
      key: 'priorAlerts90d',
      label: 'Prior alerts (90d)',
      kind: 'number',
      default: 0,
      min: 0,
      max: 50,
      help: 'Count of prior CDD alerts in the last 90 days.',
    },
    {
      key: 'txValue30dAED',
      label: 'Tx value 30d (AED)',
      kind: 'number',
      default: 50000,
      min: 0,
      max: 1e9,
      help: 'Aggregate transaction value over the last 30 days.',
    },
    {
      key: 'nearThresholdCount30d',
      label: 'Near-threshold tx count (30d)',
      kind: 'number',
      default: 0,
      min: 0,
      max: 99,
      help: 'Transactions at or just below AED 55K (structuring signal).',
    },
    {
      key: 'crossBorderRatio30d',
      label: 'Cross-border ratio (30d)',
      kind: 'number',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      help: 'Ratio of cross-border transactions in [0, 1].',
    },
    {
      key: 'isPep',
      label: 'Any UBO is PEP?',
      kind: 'boolean',
      default: false,
      help: 'Politically Exposed Person — forces EDD (Cabinet Res 134/2025 Art.14).',
    },
    {
      key: 'highRiskJurisdiction',
      label: 'High-risk jurisdiction?',
      kind: 'boolean',
      default: false,
      help: 'Counterparty in FATF / PF high-risk jurisdiction.',
    },
    {
      key: 'hasAdverseMedia',
      label: 'Adverse media?',
      kind: 'boolean',
      default: false,
      help: 'Unresolved adverse media hit for this entity.',
    },
    {
      key: 'daysSinceOnboarding',
      label: 'Days since onboarding',
      kind: 'number',
      default: 365,
      min: 0,
      max: 10000,
      help: 'Newer relationships are riskier.',
    },
    {
      key: 'sanctionsMatchScore',
      label: 'Sanctions match score',
      kind: 'number',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      help: 'Name-match score against sanctions lists in [0, 1].',
    },
    {
      key: 'cashRatio30d',
      label: 'Cash ratio (30d)',
      kind: 'number',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      help: 'Cash transaction ratio in [0, 1].',
    },
  ];

  let lastAnalysisResult = null;

  function renderAnalysisPanel() {
    const featureInputs = ANALYSIS_FEATURE_DEFS.map((f) => {
      if (f.kind === 'boolean') {
        return `
          <label style="display:flex;align-items:center;gap:8px;background:#0d1117;border:1px solid #21262d;border-radius:4px;padding:8px 10px;font-size:11px;color:#e6edf3;cursor:pointer;">
            <input type="checkbox" data-feature="${f.key}" ${f.default ? 'checked' : ''} style="accent-color:#d4a843;" />
            <span>${escapeHtml(f.label)}</span>
          </label>
        `;
      }
      const step = f.step ?? 1;
      return `
        <label style="display:flex;flex-direction:column;gap:4px;background:#0d1117;border:1px solid #21262d;border-radius:4px;padding:8px 10px;">
          <span style="font-size:10px;color:#8b949e;letter-spacing:0.4px;text-transform:uppercase;">${escapeHtml(f.label)}</span>
          <input type="number" data-feature="${f.key}" value="${f.default}" min="${f.min}" max="${f.max}" step="${step}" title="${escapeHtml(f.help)}" style="background:#010409;color:#e6edf3;border:1px solid #30363d;border-radius:3px;padding:5px 8px;font-family:monospace;font-size:12px;width:100%;box-sizing:border-box;" />
        </label>
      `;
    }).join('');

    return `
      <div style="${STYLE.panel}border-left:4px solid #3DA876;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:14px;">
          <div>
            <div style="font-size:16px;font-weight:700;color:#3DA876;letter-spacing:0.5px;">🧠 LIVE BRAIN ANALYSIS</div>
            <div style="font-size:11px;color:#8b949e;margin-top:4px;line-height:1.5;">
              Runs the full Weaponized Brain (MegaBrain + 30+ subsystems + advisor + zk-attestation + four-eyes) against the entity profile below.<br>
              Calls <code style="color:#d4a843;">POST /api/brain/analyze</code>. Requires the Hawkeye Brain Token (Settings tab).
            </div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span style="font-size:10px;color:#8b949e;letter-spacing:0.4px;text-transform:uppercase;">Entity ID</span>
            <input type="text" id="brain-analyze-entity-id" value="entity-demo-001" maxlength="128" style="background:#010409;color:#e6edf3;border:1px solid #30363d;border-radius:3px;padding:6px 10px;font-size:12px;font-family:monospace;" />
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;">
            <span style="font-size:10px;color:#8b949e;letter-spacing:0.4px;text-transform:uppercase;">Entity Name</span>
            <input type="text" id="brain-analyze-entity-name" value="Demo Entity LLC" maxlength="256" style="background:#010409;color:#e6edf3;border:1px solid #30363d;border-radius:3px;padding:6px 10px;font-size:12px;" />
          </label>
        </div>
        <label style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px;">
          <span style="font-size:10px;color:#8b949e;letter-spacing:0.4px;text-transform:uppercase;">Topic</span>
          <input type="text" id="brain-analyze-topic" value="Live brain console analysis" maxlength="200" style="background:#010409;color:#e6edf3;border:1px solid #30363d;border-radius:3px;padding:6px 10px;font-size:12px;" />
        </label>

        <div style="${STYLE.label}">ENTITY RISK FEATURES (StrFeatures vector)</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:10px;margin-bottom:12px;">
          ${featureInputs}
        </div>

        <label style="display:flex;align-items:center;gap:8px;background:#2a1012;border:1px solid #D94F4F44;border-left:3px solid #D94F4F;border-radius:4px;padding:8px 10px;font-size:11px;color:#e6edf3;cursor:pointer;margin-bottom:12px;">
          <input type="checkbox" id="brain-analyze-sanctions-confirmed" style="accent-color:#D94F4F;" />
          <span><strong style="color:#D94F4F;">isSanctionsConfirmed</strong> — forces <code>freeze</code> verdict (Cabinet Res 74/2020 Art.4)</span>
        </label>

        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button id="brain-analyze-run" style="${STYLE.btnPrimary}">▶ RUN FULL BRAIN ANALYSIS</button>
          <button id="brain-analyze-clear" style="${STYLE.btnSecondary}">Clear result</button>
          <span id="brain-analyze-status" style="font-size:11px;color:#8b949e;"></span>
        </div>
      </div>

      <div id="brain-analyze-result" style="display:none;"></div>
    `;
  }

  function readAnalysisForm() {
    const features = {};
    for (const def of ANALYSIS_FEATURE_DEFS) {
      const el = document.querySelector(`[data-feature="${def.key}"]`);
      if (!el) continue;
      if (def.kind === 'boolean') {
        features[def.key] = el.checked;
      } else {
        const n = Number(el.value);
        features[def.key] = Number.isFinite(n) ? n : def.default;
      }
    }
    const payload = {
      tenantId: 'brain-console',
      topic: (document.getElementById('brain-analyze-topic') || {}).value || 'Live analysis',
      entity: {
        id: (document.getElementById('brain-analyze-entity-id') || {}).value || 'entity-demo-001',
        name:
          (document.getElementById('brain-analyze-entity-name') || {}).value || 'Demo Entity LLC',
        features,
      },
    };
    const confirmedEl = document.getElementById('brain-analyze-sanctions-confirmed');
    if (confirmedEl && confirmedEl.checked) {
      payload.entity.isSanctionsConfirmed = true;
    }
    return payload;
  }

  async function runAnalysis() {
    const statusEl = document.getElementById('brain-analyze-status');
    const resultEl = document.getElementById('brain-analyze-result');
    const runBtn = document.getElementById('brain-analyze-run');
    const token = window.HAWKEYE_BRAIN_TOKEN;

    if (!token) {
      statusEl.textContent = '⚠ Set HAWKEYE_BRAIN_TOKEN in Settings tab first.';
      statusEl.style.color = '#E8A030';
      return;
    }

    runBtn.disabled = true;
    runBtn.style.opacity = '0.6';
    statusEl.textContent = 'Running weaponized brain…';
    statusEl.style.color = '#d4a843';

    const payload = readAnalysisForm();
    const started = Date.now();

    try {
      const response = await fetch(NETLIFY_BASE + '/api/brain/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      const durationMs = Date.now() - started;

      if (!response.ok) {
        statusEl.textContent = `✗ ${response.status} ${body.error || 'error'} (${durationMs}ms)`;
        statusEl.style.color = '#D94F4F';
        resultEl.style.display = 'block';
        resultEl.innerHTML = `
          <div style="${STYLE.cardErr}">
            <strong style="color:#D94F4F;">Brain returned ${response.status}</strong>
            <div style="${STYLE.code}margin-top:8px;">${escapeHtml(JSON.stringify(body, null, 2))}</div>
          </div>
        `;
        return;
      }

      lastAnalysisResult = body;
      const powerLabel = body.powerScore
        ? ` · brain=${body.powerScore.score}/${body.powerScore.verdict}`
        : '';
      const crossLabel =
        body.crossCase && body.crossCase.findings.length > 0
          ? ` · cross-case=${body.crossCase.findings.length}/${body.crossCase.topSeverity}`
          : '';
      const typoLabel =
        body.typologies && body.typologies.matches.length > 0
          ? ` · typo=${body.typologies.matches.length}/${body.typologies.topSeverity}`
          : '';
      const driftLabel =
        body.regulatoryDrift && !body.regulatoryDrift.clean
          ? ` · DRIFT=${body.regulatoryDrift.topSeverity}`
          : '';
      statusEl.textContent = `✓ verdict=${body.decision.verdict} confidence=${body.decision.confidence.toFixed(3)}${powerLabel}${crossLabel}${typoLabel}${driftLabel} (${durationMs}ms)`;
      statusEl.style.color = '#3DA876';
      renderAnalysisResult(
        body.decision,
        body.powerScore,
        body.asanaDispatch,
        body.crossCase,
        body.typologies,
        body.regulatoryDrift,
        body.velocity,
        body.ensemble,
        body.uncertainty,
        body.debate
      );
    } catch (err) {
      statusEl.textContent = `✗ network error: ${err.message || err}`;
      statusEl.style.color = '#D94F4F';
    } finally {
      runBtn.disabled = false;
      runBtn.style.opacity = '1';
    }
  }

  function verdictBadge(verdict) {
    const map = {
      pass: { color: '#3DA876', bg: '#0f2a1b', label: 'PASS' },
      flag: { color: '#E8A030', bg: '#2a1f0a', label: 'FLAG' },
      escalate: { color: '#E8A030', bg: '#2a1f0a', label: 'ESCALATE' },
      freeze: { color: '#D94F4F', bg: '#2a1012', label: 'FREEZE' },
    };
    const cfg = map[verdict] || { color: '#8b949e', bg: '#161b22', label: verdict.toUpperCase() };
    return `<span style="background:${cfg.bg};color:${cfg.color};border:1px solid ${cfg.color}66;padding:3px 12px;border-radius:3px;font-size:12px;font-weight:700;letter-spacing:0.5px;">${cfg.label}</span>`;
  }

  function severityBadge(sev) {
    const map = {
      info: '#8b949e',
      low: '#3DA876',
      medium: '#E8A030',
      high: '#E8A030',
      critical: '#D94F4F',
    };
    return `<span style="color:${map[sev] || '#8b949e'};font-weight:700;font-size:10px;letter-spacing:0.5px;">${(sev || 'info').toUpperCase()}</span>`;
  }

  function renderPowerScoreCard(powerScore) {
    if (!powerScore) return '';
    const verdictColors = {
      thin: '#8b949e',
      standard: '#3DA876',
      advanced: '#d4a843',
      weaponized: '#D94F4F',
    };
    const color = verdictColors[powerScore.verdict] || '#8b949e';
    const filled = Math.max(0, Math.min(100, powerScore.score));
    const componentsHtml = (powerScore.components || [])
      .map(
        (c) => `
      <tr>
        <td style="padding:3px 8px;font-size:10px;color:#8b949e;">${escapeHtml(c.label)}</td>
        <td style="padding:3px 8px;font-size:10px;color:#e6edf3;font-family:monospace;text-align:right;">${c.points}/${c.max}</td>
        <td style="padding:3px 8px;width:100px;">
          <div style="background:#0d1117;border-radius:2px;height:5px;overflow:hidden;">
            <div style="background:${color};height:100%;width:${c.max > 0 ? (c.points / c.max) * 100 : 0}%;"></div>
          </div>
        </td>
      </tr>
    `
      )
      .join('');

    return `
      <div style="${STYLE.panel}border-left:4px solid ${color};">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
          <div>
            <div style="font-size:11px;letter-spacing:0.5px;color:${color};font-weight:700;text-transform:uppercase;">BRAIN POWER SCORE</div>
            <div style="font-size:36px;font-weight:700;color:${color};line-height:1;margin-top:4px;">${powerScore.score}<span style="font-size:14px;color:#8b949e;font-weight:400;">/100</span></div>
            <div style="font-size:12px;color:${color};margin-top:2px;letter-spacing:0.5px;text-transform:uppercase;">${escapeHtml(powerScore.verdict)}</div>
          </div>
          <div style="flex:1;min-width:180px;">
            <div style="font-size:10px;color:#8b949e;margin-bottom:6px;letter-spacing:0.3px;">SUBSYSTEMS</div>
            <div style="background:#0d1117;border-radius:3px;height:8px;overflow:hidden;margin-bottom:4px;">
              <div style="background:${color};height:100%;width:${filled}%;"></div>
            </div>
            <div style="font-size:10px;color:#8b949e;line-height:1.6;">
              ${powerScore.subsystemsInvoked} invoked · ${powerScore.subsystemsFailed} failed · ${powerScore.clampsFired} clamps fired<br>
              ${powerScore.advisorInvoked ? '🎓 advisor escalated · ' : ''}${powerScore.attestationSealed ? '🔒 zk-attestation sealed' : 'attestation skipped'}
            </div>
          </div>
        </div>
        <table style="width:100%;margin-top:12px;border-collapse:collapse;">
          <tbody>${componentsHtml}</tbody>
        </table>
      </div>
    `;
  }

  function renderAsanaDispatchCard(asanaDispatch) {
    if (!asanaDispatch) {
      return `
        <div style="${STYLE.cardNeutral}">
          <strong style="color:#8b949e;">ASANA DISPATCH — SKIPPED</strong>
          <div style="font-size:10px;color:#8b949e;margin-top:4px;">Verdict was 'pass' — no Asana task needed.</div>
        </div>
      `;
    }
    const status = asanaDispatch.created
      ? '✓ CREATED'
      : asanaDispatch.skippedReason
        ? '⚠ SKIPPED'
        : '↻ REPLAYED (idempotent)';
    const cardStyle = asanaDispatch.created
      ? STYLE.cardOk
      : asanaDispatch.skippedReason
        ? STYLE.cardWarn
        : STYLE.cardNeutral;
    return `
      <div style="${cardStyle}">
        <strong style="color:#3DA876;">ASANA DISPATCH — ${status}</strong>
        <div style="font-size:10px;color:#8b949e;margin-top:4px;font-family:monospace;word-break:break-all;">
          ${asanaDispatch.taskGid ? 'task gid: ' + escapeHtml(asanaDispatch.taskGid) : ''}
          ${asanaDispatch.skippedReason ? 'reason: ' + escapeHtml(asanaDispatch.skippedReason) : ''}
        </div>
      </div>
    `;
  }

  function renderCrossCaseCard(crossCase) {
    if (!crossCase || !crossCase.findings || crossCase.findings.length === 0) {
      return `
        <div style="${STYLE.cardNeutral}">
          <strong style="color:#8b949e;">CROSS-CASE CORRELATION — NO PATTERNS</strong>
          <div style="font-size:10px;color:#8b949e;margin-top:4px;">${crossCase ? crossCase.caseCount : 0} cases in memory · no multi-case rings detected.</div>
        </div>
      `;
    }
    const kindColors = {
      'wallet-reuse': '#D94F4F',
      'shared-ubo-ring': '#D94F4F',
      'sanctions-key-reuse': '#D94F4F',
      'structuring-cluster': '#E8A030',
      'corridor-burst': '#E8A030',
      'address-reuse': '#d4a843',
      'narrative-copypaste': '#d4a843',
    };
    const findingsHtml = crossCase.findings
      .map((f) => {
        const color = kindColors[f.kind] || '#8b949e';
        return `
        <div style="border:1px solid ${color}44;border-left:3px solid ${color};background:#0d1117;border-radius:3px;padding:10px 12px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
            <strong style="color:${color};font-size:12px;letter-spacing:0.5px;">${escapeHtml(f.kind.toUpperCase())}</strong>
            <span style="font-size:10px;color:#8b949e;">${f.caseIds.length} cases · conf ${(f.confidence * 100).toFixed(0)}% · ${escapeHtml(f.severity)}</span>
          </div>
          <div style="font-size:11px;color:#e6edf3;line-height:1.6;">${escapeHtml(f.description)}</div>
          <div style="font-size:9px;color:#8b949e;margin-top:4px;font-style:italic;">${escapeHtml(f.regulatory)}</div>
        </div>
      `;
      })
      .join('');
    return `
      <div style="${STYLE.panel}border-left:4px solid #D94F4F;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
          <div style="font-size:14px;font-weight:700;color:#D94F4F;letter-spacing:0.5px;">🕸 CROSS-CASE CORRELATION</div>
          <div style="font-size:10px;color:#8b949e;">${crossCase.caseCount} cases scanned · top severity ${escapeHtml(crossCase.topSeverity)}</div>
        </div>
        ${findingsHtml}
      </div>
    `;
  }

  function renderTypologiesCard(typologies) {
    if (!typologies || !typologies.matches || typologies.matches.length === 0) {
      return `
        <div style="${STYLE.cardNeutral}">
          <strong style="color:#8b949e;">FATF TYPOLOGIES — NO MATCH</strong>
          <div style="font-size:10px;color:#8b949e;margin-top:4px;">No named money-laundering typology matched this case.</div>
        </div>
      `;
    }
    const sevColors = {
      low: '#3DA876',
      medium: '#E8A030',
      high: '#E8A030',
      critical: '#D94F4F',
    };
    const rows = typologies.matches
      .map((m) => {
        const color = sevColors[m.severity] || '#8b949e';
        const signalHtml = (m.firedSignals || [])
          .slice(0, 5)
          .map(
            (s) =>
              `<span style="display:inline-block;background:#010409;border:1px solid ${color}44;color:${color};padding:2px 8px;border-radius:10px;font-size:10px;margin:2px 4px 2px 0;">${escapeHtml(s)}</span>`
          )
          .join('');
        return `
        <div style="border:1px solid ${color}44;border-left:3px solid ${color};background:#0d1117;border-radius:3px;padding:10px 12px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
            <div>
              <strong style="color:${color};font-size:12px;letter-spacing:0.5px;">${escapeHtml(m.id)} — ${escapeHtml(m.name)}</strong>
            </div>
            <span style="font-size:10px;color:#8b949e;">score ${(m.score * 100).toFixed(0)}% · ${escapeHtml(m.severity)}</span>
          </div>
          <div style="font-size:11px;color:#e6edf3;line-height:1.6;margin-bottom:4px;">${escapeHtml(m.description)}</div>
          <div style="margin-top:6px;">${signalHtml}</div>
          <div style="font-size:9px;color:#8b949e;margin-top:6px;font-style:italic;">${escapeHtml(m.regulatory)}</div>
          <div style="font-size:10px;color:#d4a843;margin-top:4px;"><strong>Action:</strong> ${escapeHtml(m.recommendedAction)}</div>
        </div>
      `;
      })
      .join('');

    return `
      <div style="${STYLE.panel}border-left:4px solid #d4a843;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
          <div style="font-size:14px;font-weight:700;color:#d4a843;letter-spacing:0.5px;">📖 FATF DPMS TYPOLOGIES</div>
          <div style="font-size:10px;color:#8b949e;">${typologies.matches.length} matched · top severity ${escapeHtml(typologies.topSeverity)}</div>
        </div>
        <div style="font-size:11px;color:#cfc7b3;margin-bottom:10px;font-style:italic;">${escapeHtml(typologies.summary)}</div>
        ${rows}
      </div>
    `;
  }

  function renderRegulatoryDriftCard(drift) {
    if (!drift) return '';
    if (drift.clean) {
      return `
        <div style="${STYLE.cardOk}">
          <strong style="color:#3DA876;">REGULATORY DRIFT — CLEAN</strong>
          <div style="font-size:10px;color:#8b949e;margin-top:4px;">Constants version ${escapeHtml(drift.currentVersion)} matches baseline.</div>
        </div>
      `;
    }
    const sevColors = {
      low: '#d4a843',
      medium: '#E8A030',
      high: '#E8A030',
      critical: '#D94F4F',
      none: '#8b949e',
    };
    const color = sevColors[drift.topSeverity] || '#8b949e';
    const rows = (drift.findings || [])
      .map((f) => {
        const fc = sevColors[f.severity] || '#8b949e';
        return `
        <div style="border:1px solid ${fc}44;border-left:3px solid ${fc};background:#0d1117;border-radius:3px;padding:8px 12px;margin-bottom:6px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <strong style="color:${fc};font-size:11px;font-family:monospace;">${escapeHtml(f.key)}</strong>
            <span style="font-size:10px;color:#8b949e;">${escapeHtml(f.severity)}</span>
          </div>
          <div style="font-size:11px;color:#e6edf3;line-height:1.5;margin-top:4px;">
            <code style="color:#8b949e;">${escapeHtml(String(f.previous))}</code> → <code style="color:#e6edf3;">${escapeHtml(String(f.current))}</code>
          </div>
          <div style="font-size:9px;color:#8b949e;margin-top:3px;font-style:italic;">${escapeHtml(f.regulatory)}</div>
        </div>
      `;
      })
      .join('');
    return `
      <div style="${STYLE.panel}border-left:4px solid ${color};">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap;">
          <div style="font-size:14px;font-weight:700;color:${color};letter-spacing:0.5px;">⚠ REGULATORY DRIFT</div>
          <div style="font-size:10px;color:#8b949e;">${escapeHtml(drift.baselineVersion)} → ${escapeHtml(drift.currentVersion)} · top ${escapeHtml(drift.topSeverity)}</div>
        </div>
        <div style="font-size:11px;color:#cfc7b3;margin-bottom:10px;font-style:italic;">${escapeHtml(drift.summary)}</div>
        ${rows}
      </div>
    `;
  }

  function renderEnsembleCard(ensemble) {
    if (!ensemble) return '';
    const color = ensemble.unstable ? '#D94F4F' : '#3DA876';
    const badge = ensemble.unstable ? 'UNSTABLE' : 'STABLE';
    return `
      <div style="${ensemble.unstable ? STYLE.cardErr : STYLE.cardOk}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <strong style="color:${color};">🎯 CONSENSUS ENSEMBLE — ${badge}</strong>
          <span style="font-size:10px;color:#8b949e;">${ensemble.majorityVoteCount}/${ensemble.runs} agree · ${(ensemble.agreement * 100).toFixed(0)}%</span>
        </div>
        <div style="font-size:11px;color:#e6edf3;margin-top:6px;line-height:1.6;">
          Majority: <code style="color:#d4a843;">${escapeHtml(ensemble.majorityTypologyId || 'no-match')}</code>
          · severity <strong>${escapeHtml(ensemble.majoritySeverity)}</strong>
          · mean ${ensemble.meanMatchCount.toFixed(1)} matches/run
        </div>
        <div style="font-size:10px;color:#8b949e;margin-top:6px;font-style:italic;">${escapeHtml(ensemble.summary)}</div>
      </div>
    `;
  }

  function renderVelocityCard(velocity) {
    if (!velocity) {
      return `
        <div style="${STYLE.cardNeutral}">
          <strong style="color:#8b949e;">BEHAVIOURAL VELOCITY — N/A</strong>
          <div style="font-size:10px;color:#8b949e;margin-top:4px;">Memory backend disabled for this request.</div>
        </div>
      `;
    }
    const sevColors = {
      info: '#8b949e',
      low: '#3DA876',
      medium: '#d4a843',
      high: '#E8A030',
      critical: '#D94F4F',
    };
    const color = sevColors[velocity.severity] || '#8b949e';
    const pct = (n) => (n * 100).toFixed(0) + '%';
    return `
      <div style="${STYLE.panel}border-left:4px solid ${color};">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap;">
          <div style="font-size:14px;font-weight:700;color:${color};letter-spacing:0.5px;">⚡ BEHAVIOURAL VELOCITY</div>
          <div style="font-size:10px;color:#8b949e;">composite ${pct(velocity.compositeScore)} · ${escapeHtml(velocity.severity)} · ${velocity.caseCount} cases</div>
        </div>
        <div style="font-size:11px;color:#cfc7b3;margin-bottom:10px;font-style:italic;">${escapeHtml(velocity.summary)}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">
          <div style="${STYLE.cardNeutral}">
            <div style="font-size:10px;color:#8b949e;">BURST</div>
            <div style="font-size:14px;color:${velocity.burst.score >= 0.5 ? color : '#e6edf3'};font-weight:700;margin-top:2px;">${pct(velocity.burst.score)}</div>
            <div style="font-size:10px;color:#8b949e;margin-top:4px;line-height:1.4;">${escapeHtml(velocity.burst.description)}</div>
          </div>
          <div style="${STYLE.cardNeutral}">
            <div style="font-size:10px;color:#8b949e;">OFF-HOURS</div>
            <div style="font-size:14px;color:${velocity.offHours.score >= 0.5 ? color : '#e6edf3'};font-weight:700;margin-top:2px;">${pct(velocity.offHours.score)}</div>
            <div style="font-size:10px;color:#8b949e;margin-top:4px;line-height:1.4;">${escapeHtml(velocity.offHours.description)}</div>
          </div>
          <div style="${STYLE.cardNeutral}">
            <div style="font-size:10px;color:#8b949e;">WEEKEND</div>
            <div style="font-size:14px;color:${velocity.weekend.score >= 0.5 ? color : '#e6edf3'};font-weight:700;margin-top:2px;">${pct(velocity.weekend.score)}</div>
            <div style="font-size:10px;color:#8b949e;margin-top:4px;line-height:1.4;">${escapeHtml(velocity.weekend.description)}</div>
          </div>
        </div>
        <div style="font-size:9px;color:#8b949e;margin-top:8px;font-style:italic;">${escapeHtml(velocity.regulatory)}</div>
      </div>
    `;
  }

  function renderUncertaintyCard(uncertainty) {
    if (!uncertainty) return '';
    const bandColors = {
      point: '#3DA876',
      narrow: '#3DA876',
      moderate: '#E8A030',
      wide: '#D94F4F',
      critical: '#D94F4F',
    };
    const color = bandColors[uncertainty.coverage] || '#8b949e';
    const cardStyle =
      uncertainty.coverage === 'critical' || uncertainty.coverage === 'wide'
        ? STYLE.cardErr
        : uncertainty.coverage === 'moderate'
          ? STYLE.cardWarn
          : STYLE.cardOk;
    return `
      <div style="${cardStyle}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <strong style="color:${color};">📐 UNCERTAINTY INTERVAL — ${uncertainty.coverage.toUpperCase()}</strong>
          <span style="font-size:10px;color:#8b949e;">n=${uncertainty.sampleSize} · sd ${uncertainty.stddev.toFixed(3)}</span>
        </div>
        <div style="font-size:11px;color:#e6edf3;margin-top:6px;line-height:1.6;">
          point <code style="color:#d4a843;">${uncertainty.pointEstimate.toFixed(3)}</code>
          · interval <code style="color:#d4a843;">[${uncertainty.lower.toFixed(3)}, ${uncertainty.upper.toFixed(3)}]</code>
          · width ${uncertainty.width.toFixed(3)}
          · agreement ${(uncertainty.agreement * 100).toFixed(0)}%
        </div>
        <div style="font-size:10px;color:#8b949e;margin-top:6px;font-style:italic;">${escapeHtml(uncertainty.summary)}</div>
      </div>
    `;
  }

  function renderDebateCard(debate) {
    if (!debate) return '';
    const outcomeColors = {
      prosecution_wins: '#D94F4F',
      defence_wins: '#3DA876',
      undetermined: '#E8A030',
    };
    const color = outcomeColors[debate.outcome] || '#8b949e';
    const cardStyle = debate.outcome === 'undetermined' ? STYLE.cardWarn : STYLE.cardNeutral;
    return `
      <div style="${cardStyle}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <strong style="color:${color};">⚖ ADVERSARIAL DEBATE — ${debate.outcome.replace(/_/g, ' ').toUpperCase()}</strong>
          <span style="font-size:10px;color:#8b949e;">gap ${debate.gap.toFixed(3)} · threshold ${debate.threshold.toFixed(2)}</span>
        </div>
        <div style="font-size:11px;color:#e6edf3;margin-top:6px;line-height:1.6;">
          <div><strong style="color:#D94F4F;">Prosecution ${debate.prosecutionScore.toFixed(3)}:</strong> ${escapeHtml(debate.prosecutionPosition)}</div>
          <div style="margin-top:4px;"><strong style="color:#3DA876;">Defence ${debate.defenceScore.toFixed(3)}:</strong> ${escapeHtml(debate.defencePosition)}</div>
        </div>
        <div style="font-size:10px;color:#8b949e;margin-top:6px;font-style:italic;border-top:1px solid #21262d;padding-top:6px;">${escapeHtml(debate.judgeSynthesis)}</div>
      </div>
    `;
  }

  // ────────────────────────────────────────────────────────────────
  // TIER C OPS PANEL — clamp suggestion log, deferred outbound queue,
  // and break-glass override. Each sub-card lets the MLRO list pending
  // items and (where applicable) accept / reject / release / approve
  // via the orchestrator. Tier C is the safe-equivalent layer for
  // operations that would otherwise create regulatory liability:
  //
  //   - Clamp suggestions (NIST AI RMF GOVERN-4) — auto-tuning
  //     thresholds is illegal; suggestions queue for MLRO sign-off
  //   - Outbound queue (FDL Art.29) — auto-sending customer messages
  //     would be tipping off; messages queue for CO release
  //   - Break-glass override (Cabinet Res 134/2025 Art.12-14) —
  //     single-user verdict overrides break four-eyes; pairs A and B
  //
  // Cards are intentionally read-only by default. Action buttons
  // require the operator to first paste the target item id into the
  // input next to the action. This avoids accidental mutations from
  // a stray click.
  // ────────────────────────────────────────────────────────────────

  function renderTierCOpsCard() {
    return `
      <div style="${STYLE.panel}">
        <div style="${STYLE.label}">TIER C OPS — SAFE EQUIVALENTS</div>
        <div style="font-size:10px;color:#8b949e;margin-top:4px;line-height:1.6;">
          Read-only inspection of the Tier C blob stores. Mutations require pasting the target id and confirming. Every Tier C action is audit-logged with citation.
        </div>

        <!-- Clamp suggestion sub-card -->
        <div style="${STYLE.cardNeutral}margin-top:10px;">
          <strong style="color:#d4a843;">🔧 CLAMP SUGGESTION LOG</strong>
          <div style="font-size:10px;color:#8b949e;margin-top:4px;">NIST AI RMF GOVERN-4 — auto-tune proposals queued for MLRO review</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
            <button class="btn btn-sm btn-blue" data-action="brainConsoleClampList" title="List clamp suggestions awaiting MLRO review">↻ List pending</button>
            <input type="text" id="brain-tierc-clamp-id" placeholder="suggestion:key:ts" style="${STYLE.input}flex:1;min-width:200px;font-size:10px;font-family:monospace;">
            <button class="btn btn-sm btn-green" data-action="brainConsoleClampDecide" data-arg="accepted" title="Mark the pasted suggestion as accepted (still needs a PR)">✓ Accept</button>
            <button class="btn btn-sm btn-red" data-action="brainConsoleClampDecide" data-arg="rejected" title="Mark the pasted suggestion as rejected">✗ Reject</button>
          </div>
          <div id="brain-tierc-clamp-result" style="margin-top:8px;font-size:10px;color:#8b949e;font-family:monospace;max-height:200px;overflow:auto;"></div>
        </div>

        <!-- Outbound queue sub-card -->
        <div style="${STYLE.cardNeutral}margin-top:10px;">
          <strong style="color:#d4a843;">📤 DEFERRED OUTBOUND QUEUE</strong>
          <div style="font-size:10px;color:#8b949e;margin-top:4px;">FDL Art.29 — customer messages pending CO release (tipping-off-safe)</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
            <input type="text" id="brain-tierc-outbound-tenant" placeholder="tenantId" style="${STYLE.input}flex:1;min-width:140px;font-size:10px;font-family:monospace;">
            <button class="btn btn-sm btn-blue" data-action="brainConsoleOutboundList" title="List outbound items awaiting CO release for this tenant">↻ List pending</button>
            <input type="text" id="brain-tierc-outbound-id" placeholder="outbound:..." style="${STYLE.input}flex:1;min-width:200px;font-size:10px;font-family:monospace;">
            <button class="btn btn-sm btn-green" data-action="brainConsoleOutboundAction" data-arg="release" title="Release the pasted outbound item (CO only)">▶ Release</button>
            <button class="btn btn-sm btn-red" data-action="brainConsoleOutboundAction" data-arg="cancel" title="Cancel the pasted outbound item">✗ Cancel</button>
          </div>
          <div id="brain-tierc-outbound-result" style="margin-top:8px;font-size:10px;color:#8b949e;font-family:monospace;max-height:200px;overflow:auto;"></div>
        </div>

        <!-- Break-glass sub-card -->
        <div style="${STYLE.cardNeutral}margin-top:10px;">
          <strong style="color:#d4a843;">🚨 BREAK-GLASS OVERRIDE</strong>
          <div style="font-size:10px;color:#8b949e;margin-top:4px;">Cabinet Res 134/2025 Art.12-14 — two-person approval. Self-approval rejected by construction.</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
            <input type="text" id="brain-tierc-bg-tenant" placeholder="tenantId" style="${STYLE.input}flex:1;min-width:140px;font-size:10px;font-family:monospace;">
            <button class="btn btn-sm btn-blue" data-action="brainConsoleBreakGlassList" title="List break-glass requests awaiting a second approver">↻ List pending</button>
            <input type="text" id="brain-tierc-bg-id" placeholder="breakglass:..." style="${STYLE.input}flex:1;min-width:200px;font-size:10px;font-family:monospace;">
            <input type="text" id="brain-tierc-bg-approver" placeholder="approverId" style="${STYLE.input}flex:1;min-width:140px;font-size:10px;font-family:monospace;">
            <button class="btn btn-sm btn-green" data-action="brainConsoleBreakGlassApprove" title="Approve the pasted break-glass request — must be a different user from the requester">✓ Approve</button>
          </div>
          <div id="brain-tierc-bg-result" style="margin-top:8px;font-size:10px;color:#8b949e;font-family:monospace;max-height:200px;overflow:auto;"></div>
        </div>
      </div>
    `;
  }

  function renderCaseToolsCard(decision) {
    if (!decision) return '';
    const tenantId = decision.tenantId || '';
    const caseId = decision.id || '';
    return `
      <div style="${STYLE.cardNeutral}">
        <strong style="color:#d4a843;">🛠 CASE TOOLS</strong>
        <div style="font-size:10px;color:#8b949e;margin-top:4px;">tenant <code>${escapeHtml(tenantId)}</code> · case <code>${escapeHtml(caseId)}</code></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
          <button class="btn btn-sm btn-blue" data-action="brainConsoleReplay" data-arg="${escapeHtml(tenantId)}" data-arg2="${escapeHtml(caseId)}" title="Re-validate this case against the current regulatory baseline">↻ Replay</button>
          <button class="btn btn-sm btn-blue" data-action="brainConsoleEvidenceBundle" data-arg="${escapeHtml(tenantId)}" data-arg2="${escapeHtml(caseId)}" title="Export the SHA3-512-sealed audit bundle">📦 Evidence Bundle</button>
        </div>
        <div id="brain-case-tools-result" style="margin-top:8px;font-size:10px;color:#8b949e;font-family:monospace;max-height:240px;overflow:auto;"></div>
      </div>
    `;
  }

  function renderAnalysisResult(
    decision,
    powerScore,
    asanaDispatch,
    crossCase,
    typologies,
    regulatoryDrift,
    velocity,
    ensemble,
    uncertainty,
    debate
  ) {
    const resultEl = document.getElementById('brain-analyze-result');
    if (!resultEl) return;

    const factorsHtml = (decision.strPrediction.topFactors || [])
      .map(
        (f) => `
        <tr>
          <td style="padding:4px 8px;color:#e6edf3;font-family:monospace;font-size:11px;">${escapeHtml(f.feature)}</td>
          <td style="padding:4px 8px;color:#8b949e;font-family:monospace;font-size:11px;">${escapeHtml(String(f.value))}</td>
          <td style="padding:4px 8px;color:${f.impact === 'increases-risk' ? '#D94F4F' : f.impact === 'decreases-risk' ? '#3DA876' : '#8b949e'};font-family:monospace;font-size:11px;">${f.contribution >= 0 ? '+' : ''}${f.contribution.toFixed(3)}</td>
          <td style="padding:4px 8px;color:#8b949e;font-size:10px;">${escapeHtml(f.impact)}</td>
        </tr>
      `
      )
      .join('');

    const clampsHtml =
      (decision.brain.clampReasons || []).length > 0
        ? `<div style="${STYLE.cardWarn}">
          <strong style="color:#E8A030;">⚠ SAFETY CLAMPS FIRED</strong>
          <ul style="margin:6px 0 0;padding-left:18px;font-size:11px;color:#e6edf3;line-height:1.6;">
            ${decision.brain.clampReasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}
          </ul>
        </div>`
        : '';

    const failuresHtml =
      (decision.brain.subsystemFailures || []).length > 0
        ? `<div style="${STYLE.cardErr}">
          <strong style="color:#D94F4F;">✗ SUBSYSTEM FAILURES (${decision.brain.subsystemFailures.length})</strong>
          <div style="font-size:11px;color:#e6edf3;margin-top:6px;">${escapeHtml(decision.brain.subsystemFailures.join(', '))}</div>
        </div>`
        : '';

    const advisorHtml = decision.brain.advisorInvoked
      ? `<div style="${STYLE.cardWarn}">
          <strong style="color:#d4a843;">🎓 ADVISOR ESCALATION</strong>
          <div style="font-size:11px;color:#8b949e;margin-top:4px;">Model: ${escapeHtml(decision.brain.advisorModel || 'unknown')}</div>
        </div>`
      : '';

    const fourEyesHtml = decision.fourEyes
      ? `<div style="${decision.fourEyes.meetsRequirements ? STYLE.cardOk : STYLE.cardWarn}">
          <strong style="color:${decision.fourEyes.meetsRequirements ? '#3DA876' : '#E8A030'};">✓ FOUR-EYES ${decision.fourEyes.status.toUpperCase()}</strong>
          <div style="font-size:11px;color:#e6edf3;margin-top:4px;line-height:1.6;">
            ${decision.fourEyes.approvalCount}/${decision.fourEyes.requiredCount} approvals · ${escapeHtml(decision.fourEyes.regulatoryRef)}<br>
            ${decision.fourEyes.missingRoles.length > 0 ? 'Missing: ' + escapeHtml(decision.fourEyes.missingRoles.join(', ')) : ''}
          </div>
        </div>`
      : '';

    const attestationHtml = decision.attestation
      ? `<div style="${STYLE.cardNeutral}">
          <strong style="color:#d4a843;">🔒 ZK-COMPLIANCE ATTESTATION</strong>
          <div style="font-size:10px;color:#8b949e;margin-top:4px;font-family:monospace;word-break:break-all;">
            ${escapeHtml(decision.attestation.commitHash.slice(0, 64))}…<br>
            list: ${escapeHtml(decision.attestation.listName)} · published: ${escapeHtml(decision.attestation.attestationPublishedAtIso)}
          </div>
        </div>`
      : '';

    resultEl.style.display = 'block';
    resultEl.innerHTML = `
      <div style="${STYLE.panel}border-left:4px solid #d4a843;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
          <div style="font-size:16px;font-weight:700;color:#d4a843;">DECISION</div>
          ${verdictBadge(decision.verdict)}
          <span style="color:#8b949e;font-size:11px;">confidence ${(decision.confidence * 100).toFixed(1)}%</span>
          ${decision.requiresHumanReview ? '<span style="background:#2a1012;color:#D94F4F;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:700;">HUMAN REVIEW REQUIRED</span>' : ''}
        </div>
        <div style="font-size:12px;color:#e6edf3;line-height:1.7;padding:10px 12px;background:#0d1117;border:1px solid #21262d;border-radius:4px;">
          <strong style="color:#d4a843;">Recommended action:</strong> ${escapeHtml(decision.recommendedAction)}
        </div>
        <div style="font-size:11px;color:#8b949e;margin-top:8px;line-height:1.6;">
          <strong>Audit narrative:</strong> ${escapeHtml(decision.auditNarrative)}
        </div>
      </div>

      ${renderPowerScoreCard(powerScore)}
      ${renderUncertaintyCard(uncertainty)}
      ${renderDebateCard(debate)}
      ${renderRegulatoryDriftCard(regulatoryDrift)}
      ${renderEnsembleCard(ensemble)}
      ${renderVelocityCard(velocity)}
      ${renderTypologiesCard(typologies)}
      ${renderCrossCaseCard(crossCase)}
      ${renderAsanaDispatchCard(asanaDispatch)}
      ${renderCaseToolsCard(decision)}
      ${clampsHtml}
      ${failuresHtml}
      ${advisorHtml}
      ${fourEyesHtml}
      ${attestationHtml}

      <div style="${STYLE.panel}">
        <div style="${STYLE.label}">STR PREDICTION — ${decision.strPrediction.band.toUpperCase()} band (${(decision.strPrediction.probability * 100).toFixed(1)}% probability, recommendation: ${escapeHtml(decision.strPrediction.recommendation)})</div>
        <table style="width:100%;margin-top:10px;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid #21262d;">
              <th style="text-align:left;padding:6px 8px;font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;">Feature</th>
              <th style="text-align:left;padding:6px 8px;font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;">Value</th>
              <th style="text-align:left;padding:6px 8px;font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;">Contribution</th>
              <th style="text-align:left;padding:6px 8px;font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;">Impact</th>
            </tr>
          </thead>
          <tbody>${factorsHtml}</tbody>
        </table>
      </div>

      <div style="${STYLE.panel}">
        <div style="${STYLE.label}">WAR-ROOM EVENT</div>
        <div style="margin-top:8px;font-size:11px;color:#e6edf3;line-height:1.7;">
          <div><strong>ID:</strong> <code style="color:#d4a843;font-size:10px;">${escapeHtml(decision.warRoomEvent.id)}</code></div>
          <div><strong>Severity:</strong> ${severityBadge(decision.warRoomEvent.severity)}</div>
          <div><strong>Kind:</strong> ${escapeHtml(decision.warRoomEvent.kind)}</div>
          <div><strong>Title:</strong> ${escapeHtml(decision.warRoomEvent.title)}</div>
          <div><strong>At:</strong> ${escapeHtml(decision.warRoomEvent.at)}</div>
        </div>
      </div>

      <div style="${STYLE.panel}">
        <div style="${STYLE.label}">BRAIN INTERNALS</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-top:10px;">
          <div style="${STYLE.cardNeutral}">
            <div style="font-size:10px;color:#8b949e;">MEGA VERDICT</div>
            <div style="font-size:13px;color:#e6edf3;font-weight:700;margin-top:2px;">${escapeHtml(decision.brain.megaVerdict)}</div>
          </div>
          <div style="${STYLE.cardNeutral}">
            <div style="font-size:10px;color:#8b949e;">FINAL VERDICT</div>
            <div style="font-size:13px;color:#e6edf3;font-weight:700;margin-top:2px;">${escapeHtml(decision.brain.finalVerdict)}</div>
          </div>
          <div style="${STYLE.cardNeutral}">
            <div style="font-size:10px;color:#8b949e;">MEGA CONFIDENCE</div>
            <div style="font-size:13px;color:#e6edf3;font-weight:700;margin-top:2px;">${(decision.brain.megaConfidence * 100).toFixed(1)}%</div>
          </div>
          <div style="${STYLE.cardNeutral}">
            <div style="font-size:10px;color:#8b949e;">REASONING NODES</div>
            <div style="font-size:13px;color:#e6edf3;font-weight:700;margin-top:2px;">${decision.brain.reasoningChainNodeCount}</div>
          </div>
          <div style="${STYLE.cardNeutral}">
            <div style="font-size:10px;color:#8b949e;">REASONING EDGES</div>
            <div style="font-size:13px;color:#e6edf3;font-weight:700;margin-top:2px;">${decision.brain.reasoningChainEdgeCount}</div>
          </div>
          <div style="${STYLE.cardNeutral}">
            <div style="font-size:10px;color:#8b949e;">MANAGED AGENTS</div>
            <div style="font-size:13px;color:#e6edf3;font-weight:700;margin-top:2px;">${decision.brain.managedAgentPlan.length}</div>
          </div>
        </div>
        ${
          decision.brain.megaNotes && decision.brain.megaNotes.length > 0
            ? `<div style="${STYLE.code}margin-top:10px;">${decision.brain.megaNotes.map(escapeHtml).join('\n')}</div>`
            : ''
        }
      </div>
    `;
  }

  function clearAnalysis() {
    lastAnalysisResult = null;
    const resultEl = document.getElementById('brain-analyze-result');
    const statusEl = document.getElementById('brain-analyze-status');
    if (resultEl) {
      resultEl.style.display = 'none';
      resultEl.innerHTML = '';
    }
    if (statusEl) {
      statusEl.textContent = '';
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Init / mount
  // ────────────────────────────────────────────────────────────────

  function init() {
    if (initialized) return;
    initialized = true;

    const container = document.getElementById('tab-brain');
    if (!container) {
      console.warn('[BrainConsole] #tab-brain mount point not found');
      return;
    }

    container.innerHTML = `
      ${renderHeader()}
      ${renderAnalysisPanel()}
      ${renderHelp()}
      <div style="${STYLE.panel}">
        <div style="${STYLE.label}">CRON HEALTH</div>
        <div id="brain-cron-list" style="margin-top:10px;"></div>
      </div>
      ${renderTierCOpsCard()}
      ${renderTierSummary()}
    `;

    document.getElementById('brain-probe-all').addEventListener('click', () => {
      probeAllCrons();
    });
    document.getElementById('brain-refresh').addEventListener('click', () => {
      renderCronList();
    });
    document.getElementById('brain-analyze-run').addEventListener('click', runAnalysis);
    document.getElementById('brain-analyze-clear').addEventListener('click', clearAnalysis);

    // Local data-action delegate scoped to the brain tab. The legacy
    // app-core.js switch only knows about app-wide actions; brain
    // console actions (replay, evidence bundle, Tier C ops) are
    // handled here so they do not pollute the global switch and so
    // the brain tab stays self-contained.
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn || !container.contains(btn)) return;
      const action = btn.getAttribute('data-action');
      if (!action || !action.startsWith('brainConsole')) return;
      const fn = window[action];
      if (typeof fn !== 'function') return;
      e.preventDefault();
      e.stopPropagation();
      const arg = btn.getAttribute('data-arg');
      const arg2 = btn.getAttribute('data-arg2');
      try {
        // Forward up to two args — covers all current callers.
        if (arg2 !== null && arg2 !== undefined) fn(arg, arg2);
        else if (arg !== null && arg !== undefined) fn(arg);
        else fn();
      } catch (err) {
        console.warn('[BrainConsole] action handler threw:', err);
      }
    });

    renderCronList();

    // Auto-probe on first open so the user sees something immediately
    setTimeout(() => probeAllCrons(), 500);
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ─── Case-tools handlers — replay + evidence bundle ─────────────────
  async function callCaseEndpoint(path, tenantId, caseId) {
    const out = document.getElementById('brain-case-tools-result');
    const token = window.HAWKEYE_BRAIN_TOKEN;
    if (!token) {
      if (out) out.textContent = 'HAWKEYE_BRAIN_TOKEN missing — set it in Settings.';
      return;
    }
    if (!tenantId || !caseId) {
      if (out) out.textContent = 'Missing tenant or case id.';
      return;
    }
    if (out) out.textContent = `Calling ${path}…`;
    try {
      const response = await fetch(NETLIFY_BASE + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tenantId, caseId }),
      });
      const body = await response.json().catch(() => ({}));
      if (out) out.textContent = JSON.stringify(body, null, 2);
    } catch (err) {
      if (out)
        out.textContent = 'fetch failed: ' + (err && err.message ? err.message : String(err));
    }
  }

  async function brainConsoleReplay(tenantId, caseId) {
    return callCaseEndpoint('/api/brain/replay', tenantId, caseId);
  }
  async function brainConsoleEvidenceBundle(tenantId, caseId) {
    return callCaseEndpoint('/api/brain/evidence-bundle', tenantId, caseId);
  }
  // Expose for the data-action delegate.
  window.brainConsoleReplay = brainConsoleReplay;
  window.brainConsoleEvidenceBundle = brainConsoleEvidenceBundle;

  // ─── Tier C ops handlers — clamp, outbound, break-glass ────────────
  //
  // Each handler is a thin shim over the corresponding /api/brain/*
  // endpoint. The shims:
  //   - read the operator-supplied id from the input next to the button
  //   - check that HAWKEYE_BRAIN_TOKEN is set
  //   - POST through the orchestrator-bound endpoint (NEVER directly)
  //   - render the JSON response into the sub-card result element
  //
  // None of these handlers can bypass the endpoint's own validation
  // (auth, rate limit, self-approval rejection on break-glass).

  async function tierCFetch(path, body, resultElId) {
    const out = document.getElementById(resultElId);
    const token = window.HAWKEYE_BRAIN_TOKEN;
    if (!token) {
      if (out) out.textContent = 'HAWKEYE_BRAIN_TOKEN missing — set it in Settings.';
      return;
    }
    if (out) out.textContent = `Calling ${path}…`;
    try {
      const response = await fetch(NETLIFY_BASE + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => ({}));
      if (out) out.textContent = JSON.stringify(json, null, 2);
    } catch (err) {
      if (out)
        out.textContent = 'fetch failed: ' + (err && err.message ? err.message : String(err));
    }
  }

  async function brainConsoleClampList() {
    return tierCFetch(
      '/api/brain/clamp-suggestion',
      { action: 'list', statusFilter: 'pending_mlro_review' },
      'brain-tierc-clamp-result'
    );
  }
  async function brainConsoleClampDecide(status) {
    const idEl = document.getElementById('brain-tierc-clamp-id');
    const id = idEl ? idEl.value.trim() : '';
    if (!id) {
      const out = document.getElementById('brain-tierc-clamp-result');
      if (out) out.textContent = 'Paste a suggestion id first.';
      return;
    }
    return tierCFetch(
      '/api/brain/clamp-suggestion',
      { action: 'decide', id, status },
      'brain-tierc-clamp-result'
    );
  }

  async function brainConsoleOutboundList() {
    const tenantEl = document.getElementById('brain-tierc-outbound-tenant');
    const tenantId = tenantEl ? tenantEl.value.trim() : '';
    if (!tenantId) {
      const out = document.getElementById('brain-tierc-outbound-result');
      if (out) out.textContent = 'Enter a tenantId first.';
      return;
    }
    return tierCFetch(
      '/api/brain/outbound-queue',
      { action: 'pending', tenantId },
      'brain-tierc-outbound-result'
    );
  }
  async function brainConsoleOutboundAction(action) {
    const tenantEl = document.getElementById('brain-tierc-outbound-tenant');
    const idEl = document.getElementById('brain-tierc-outbound-id');
    const tenantId = tenantEl ? tenantEl.value.trim() : '';
    const id = idEl ? idEl.value.trim() : '';
    if (!tenantId || !id) {
      const out = document.getElementById('brain-tierc-outbound-result');
      if (out) out.textContent = 'tenantId + outbound id are both required.';
      return;
    }
    return tierCFetch(
      '/api/brain/outbound-queue',
      { action, tenantId, id },
      'brain-tierc-outbound-result'
    );
  }

  async function brainConsoleBreakGlassList() {
    const tenantEl = document.getElementById('brain-tierc-bg-tenant');
    const tenantId = tenantEl ? tenantEl.value.trim() : '';
    if (!tenantId) {
      const out = document.getElementById('brain-tierc-bg-result');
      if (out) out.textContent = 'Enter a tenantId first.';
      return;
    }
    return tierCFetch(
      '/api/brain/break-glass',
      { action: 'pending', tenantId },
      'brain-tierc-bg-result'
    );
  }
  async function brainConsoleBreakGlassApprove() {
    const tenantEl = document.getElementById('brain-tierc-bg-tenant');
    const idEl = document.getElementById('brain-tierc-bg-id');
    const approverEl = document.getElementById('brain-tierc-bg-approver');
    const tenantId = tenantEl ? tenantEl.value.trim() : '';
    const id = idEl ? idEl.value.trim() : '';
    const approverId = approverEl ? approverEl.value.trim() : '';
    if (!tenantId || !id || !approverId) {
      const out = document.getElementById('brain-tierc-bg-result');
      if (out) out.textContent = 'tenantId + break-glass id + approverId are all required.';
      return;
    }
    return tierCFetch(
      '/api/brain/break-glass',
      { action: 'approve', tenantId, id, approverId },
      'brain-tierc-bg-result'
    );
  }

  // Expose for the data-action delegate.
  window.brainConsoleClampList = brainConsoleClampList;
  window.brainConsoleClampDecide = brainConsoleClampDecide;
  window.brainConsoleOutboundList = brainConsoleOutboundList;
  window.brainConsoleOutboundAction = brainConsoleOutboundAction;
  window.brainConsoleBreakGlassList = brainConsoleBreakGlassList;
  window.brainConsoleBreakGlassApprove = brainConsoleBreakGlassApprove;

  // Expose the public API
  window.BrainConsole = {
    init: init,
    probeAll: probeAllCrons,
    state: () => ({ ...cronStates }),
    runAnalysis: runAnalysis,
    clearAnalysis: clearAnalysis,
    lastAnalysis: () => lastAnalysisResult,
    replay: brainConsoleReplay,
    evidenceBundle: brainConsoleEvidenceBundle,
    clampList: brainConsoleClampList,
    clampDecide: brainConsoleClampDecide,
    outboundList: brainConsoleOutboundList,
    outboundAction: brainConsoleOutboundAction,
    breakGlassList: brainConsoleBreakGlassList,
    breakGlassApprove: brainConsoleBreakGlassApprove,
  };
})();
