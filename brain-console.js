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
      description: 'Watches Asana comments for slash commands like /screen or /audit. Runs every minute.',
      icon: '⚡',
      regulatory: 'FDL No.10/2025 Art.20-21',
    },
    {
      id: 'governance',
      name: 'AI Governance Self-Audit',
      path: '/.netlify/functions/ai-governance-self-audit-cron',
      description: 'Daily self-audit against EU AI Act, NIST AI RMF, ISO/IEC 42001, UAE AI Charter. Runs at 02:00 UTC.',
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
    panel: 'background:#161b22;border:1px solid #21262d;border-radius:8px;padding:16px;margin-bottom:12px;',
    cardOk: 'background:#0f2a1b;border:1px solid #3DA87644;border-left:3px solid #3DA876;border-radius:6px;padding:12px;margin-bottom:8px;',
    cardErr: 'background:#2a1012;border:1px solid #D94F4F44;border-left:3px solid #D94F4F;border-radius:6px;padding:12px;margin-bottom:8px;',
    cardWarn: 'background:#1f2933;border:1px solid #E8A03044;border-left:3px solid #E8A030;border-radius:6px;padding:12px;margin-bottom:8px;',
    cardNeutral: 'background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:12px;margin-bottom:8px;',
    btnPrimary: 'padding:8px 20px;background:#d4a843;color:#000;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:0.5px;',
    btnSecondary: 'padding:6px 14px;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:6px;font-size:11px;cursor:pointer;',
    code: 'background:#010409;color:#3DA876;padding:8px 12px;border-radius:4px;font-family:monospace;font-size:11px;white-space:pre-wrap;word-break:break-all;',
    label: 'font-size:11px;color:#8b949e;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;',
  };

  // ────────────────────────────────────────────────────────────────
  // State
  // ────────────────────────────────────────────────────────────────

  let initialized = false;
  let cronStates = {}; // id → { status, lastResponse, lastCheckedAt }

  // ────────────────────────────────────────────────────────────────
  // Brain token persistence — solves the "HAWKEYE_BRAIN_TOKEN not in
  // window" NEEDS AUTH error by giving the operator a place to paste
  // the token, persisting it in localStorage, and injecting it into
  // window.HAWKEYE_BRAIN_TOKEN on every Brain Console init.
  // ────────────────────────────────────────────────────────────────

  const TOKEN_STORAGE_KEY = 'fgl_brain_token';

  function loadBrainTokenFromStorage() {
    try {
      var stored = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (stored && stored.length >= 16) {
        window.HAWKEYE_BRAIN_TOKEN = stored;
        return stored;
      }
    } catch (e) { /* ignore */ }
    return undefined;
  }

  function saveBrainToken(token) {
    try {
      var clean = (token || '').trim();
      if (clean.length === 0) {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        delete window.HAWKEYE_BRAIN_TOKEN;
      } else {
        if (clean.length < 16) {
          alert('Brain token looks too short. Expected 32+ hex characters from openssl rand -hex 24.');
          return false;
        }
        localStorage.setItem(TOKEN_STORAGE_KEY, clean);
        window.HAWKEYE_BRAIN_TOKEN = clean;
      }
      return true;
    } catch (e) {
      alert('Could not save token: ' + (e && e.message ? e.message : String(e)));
      return false;
    }
  }

  // Expose as global helpers so the data-action delegation can call
  // them by name from the Settings card.
  window._brainSaveToken = function () {
    var input = document.getElementById('brain-token-input');
    if (!input) return;
    if (saveBrainToken(input.value)) {
      input.value = '';
      renderTokenStatus();
      // Re-probe the toast stream cron now that auth is configured.
      var toastCron = CRON_ENDPOINTS.find(function (c) { return c.id === 'toaststream'; });
      if (toastCron) probeCron(toastCron);
    }
  };

  window._brainClearToken = function () {
    if (!confirm('Clear the saved Brain token? You will need to re-paste it next time.')) return;
    saveBrainToken('');
    renderTokenStatus();
  };

  function renderTokenStatus() {
    var status = document.getElementById('brain-token-status');
    if (!status) return;
    var current = window.HAWKEYE_BRAIN_TOKEN;
    if (current && typeof current === 'string' && current.length >= 16) {
      status.innerHTML = '<span style="color:#3DA876;font-weight:700;">✓ TOKEN SET</span> <span style="color:#8b949e;font-size:10px;">(' + current.length + ' chars)</span>';
    } else {
      status.innerHTML = '<span style="color:#E8A030;font-weight:700;">⚠ NOT SET</span> <span style="color:#8b949e;font-size:10px;">— paste your HAWKEYE_BRAIN_TOKEN above</span>';
    }
  }

  function renderTokenSettings() {
    return (
      '<div style="' + STYLE.panel + '">' +
      '<div style="' + STYLE.label + '">BRAIN TOKEN — REQUIRED FOR AUTHED CRON PROBES</div>' +
      '<div style="font-size:11px;color:#8b949e;line-height:1.5;margin-top:8px;margin-bottom:10px;">' +
      'Paste your <code>HAWKEYE_BRAIN_TOKEN</code> here once. It is stored in this browser only ' +
      '(localStorage), never sent anywhere except as <code>Authorization: Bearer &lt;token&gt;</code> when ' +
      'probing the toast stream cron. The same token must be set in Netlify env vars for the ' +
      'server side to accept it.' +
      '</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
      '<input id="brain-token-input" type="password" placeholder="paste 32+ hex chars from Netlify HAWKEYE_BRAIN_TOKEN here" ' +
      'style="flex:1;padding:8px 12px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:12px;font-family:monospace;" />' +
      '<button class="btn btn-sm btn-green" data-action="_brainSaveToken" style="' + STYLE.btnSecondary + 'background:#0f2a1b;border-color:#3DA876;color:#3DA876;">Save</button>' +
      '<button class="btn btn-sm btn-red" data-action="_brainClearToken" style="' + STYLE.btnSecondary + 'background:#2a1012;border-color:#D94F4F;color:#D94F4F;">Clear</button>' +
      '</div>' +
      '<div id="brain-token-status" style="font-size:11px;"></div>' +
      '</div>'
    );
  }

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
            error: 'HAWKEYE_BRAIN_TOKEN not in window — see Settings',
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
    if (state.status === 'pending') return '<span style="color:#E8A030;font-size:10px;font-weight:700;">PROBING…</span>';
    if (state.status === 'ok') return '<span style="color:#3DA876;font-size:10px;font-weight:700;">✓ ALIVE</span>';
    if (state.status === 'unauthed') return '<span style="color:#E8A030;font-size:10px;font-weight:700;">⚠ NEEDS AUTH</span>';
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

      const lastResp = state && state.lastResponse
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
          ${TIER_FEATURES.map((tier) => `
            <div style="background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:10px;">
              <div style="font-size:11px;color:#d4a843;font-weight:700;margin-bottom:6px;">TIER ${tier.tier} — ${tier.title}</div>
              <ul style="margin:0;padding-left:16px;font-size:10px;color:#8b949e;line-height:1.6;">
                ${tier.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
              </ul>
            </div>
          `).join('')}
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
  // Init / mount
  // ────────────────────────────────────────────────────────────────

  function init() {
    if (initialized) return;
    initialized = true;

    // Pull a previously-saved Brain token from localStorage into
    // window so authed cron probes (toast stream) can use it without
    // the operator having to re-paste it on every page load.
    loadBrainTokenFromStorage();

    const container = document.getElementById('tab-brain');
    if (!container) {
      console.warn('[BrainConsole] #tab-brain mount point not found');
      return;
    }

    container.innerHTML = `
      ${renderHeader()}
      ${renderHelp()}
      ${renderTokenSettings()}
      <div style="${STYLE.panel}">
        <div style="${STYLE.label}">CRON HEALTH</div>
        <div id="brain-cron-list" style="margin-top:10px;"></div>
      </div>
      ${renderTierSummary()}
    `;

    document.getElementById('brain-probe-all').addEventListener('click', () => {
      probeAllCrons();
    });
    document.getElementById('brain-refresh').addEventListener('click', () => {
      renderCronList();
    });

    renderTokenStatus();
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

  // Expose the public API
  window.BrainConsole = {
    init: init,
    probeAll: probeAllCrons,
    state: () => ({ ...cronStates }),
  };
})();
