/**
 * Hawkeye Sterling — premium luxury watermark.
 *
 * Self-contained: injects CSS + HTML on DOMContentLoaded.
 * pointer-events: none on every layer — never blocks UI.
 * z-index: 1–5 — stays behind all page chrome (modals sit at 999+).
 *
 * Five composited layers:
 *   1. Full-page CRT scan lines (pink, 1.2% opacity)
 *   2. Radial pink glow from bottom-right corner
 *   3. Diagonal micro-text repeat (2.8% opacity, almost invisible)
 *   4. Cyborg bust SVG — bottom-right, partially off-screen, 7% opacity
 *   5. Edge accent lines + wordmark + corner pip
 */
(function () {
  'use strict';

  var CSS = `
/* ── Hawkeye Premium Watermark ───────────────────────────────── */
.hspw-scanlines {
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: repeating-linear-gradient(
    0deg,
    transparent               0px,
    transparent               3px,
    rgba(255,45,120,0.012)    3px,
    rgba(255,45,120,0.012)    4px
  );
}
.hspw-glow {
  position: fixed;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background: radial-gradient(
    ellipse 65% 55% at 100% 100%,
    rgba(255,45,120,0.09)  0%,
    rgba(196,0,106,0.035)  40%,
    transparent            70%
  );
}
.hspw-texture {
  position: fixed;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  overflow: hidden;
}
.hspw-texture-inner {
  position: absolute;
  inset: -80%;
  width: 260%;
  height: 260%;
  transform: rotate(-28deg);
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
}
.hspw-texture-inner span {
  flex: 0 0 300px;
  height: 60px;
  display: flex;
  align-items: center;
  font-size: 9px;
  letter-spacing: 7px;
  text-transform: uppercase;
  color: #FF2D78;
  opacity: 0.028;
  white-space: nowrap;
  user-select: none;
  font-family: 'DM Mono','Fira Mono','Courier New',monospace;
}
.hspw-robot {
  position: fixed;
  bottom: -70px;
  right: -55px;
  z-index: 3;
  pointer-events: none;
  width: 400px;
  opacity: 0.07;
  filter: drop-shadow(0 0 36px rgba(255,45,120,0.85))
          drop-shadow(0 0 10px rgba(255,45,120,0.55));
}
.hspw-robot svg {
  display: block;
  width: 100%;
  height: auto;
  fill: #FF2D78;
}
.hspw-wordmark {
  position: fixed;
  top: 18px;
  right: 26px;
  z-index: 5;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  user-select: none;
  font-family: 'DM Mono','Fira Mono','Courier New',monospace;
}
.hspw-wordmark-primary {
  font-size: 8px;
  letter-spacing: 9px;
  text-transform: uppercase;
  color: #FF2D78;
  opacity: 0.30;
}
.hspw-wordmark-sub {
  font-size: 7px;
  letter-spacing: 5px;
  text-transform: uppercase;
  color: #FF2D78;
  opacity: 0.16;
}
.hspw-edge-right {
  position: fixed;
  top: 0;
  right: 0;
  width: 1px;
  height: 100vh;
  z-index: 4;
  pointer-events: none;
  background: linear-gradient(
    to bottom,
    transparent          0%,
    rgba(255,45,120,0.4) 20%,
    rgba(255,45,120,0.65) 50%,
    rgba(255,45,120,0.4) 80%,
    transparent          100%
  );
}
.hspw-edge-bottom {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100vw;
  height: 1px;
  z-index: 4;
  pointer-events: none;
  background: linear-gradient(
    to right,
    transparent           0%,
    rgba(255,45,120,0.25) 35%,
    rgba(255,45,120,0.65) 80%,
    rgba(255,45,120,0.4)  100%
  );
}
.hspw-pip {
  position: fixed;
  bottom: -2px;
  right: -2px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #FF2D78;
  box-shadow: 0 0 7px 3px rgba(255,45,120,0.75);
  z-index: 5;
  pointer-events: none;
}
`;

  var ROBOT_SVG = `<svg viewBox="0 0 320 380" xmlns="http://www.w3.org/2000/svg">
  <circle cx="160" cy="155" r="148" fill="none" stroke="#FF2D78" stroke-width="0.4" opacity="0.5"/>
  <circle cx="160" cy="155" r="135" fill="none" stroke="#FF2D78" stroke-width="0.25" opacity="0.35"/>
  <line x1="160" y1="8"   x2="160" y2="18"  stroke="#FF2D78" stroke-width="1.2" opacity="0.6"/>
  <line x1="160" y1="292" x2="160" y2="302" stroke="#FF2D78" stroke-width="1.2" opacity="0.6"/>
  <line x1="13"  y1="155" x2="23"  y2="155" stroke="#FF2D78" stroke-width="1.2" opacity="0.6"/>
  <line x1="297" y1="155" x2="307" y2="155" stroke="#FF2D78" stroke-width="1.2" opacity="0.6"/>
  <line x1="55"  y1="50"  x2="62"  y2="57"  stroke="#FF2D78" stroke-width="0.8" opacity="0.4"/>
  <line x1="258" y1="50"  x2="265" y2="57"  stroke="#FF2D78" stroke-width="0.8" opacity="0.4"/>
  <line x1="55"  y1="260" x2="62"  y2="253" stroke="#FF2D78" stroke-width="0.8" opacity="0.4"/>
  <line x1="258" y1="260" x2="265" y2="253" stroke="#FF2D78" stroke-width="0.8" opacity="0.4"/>
  <rect x="156" y="2"  width="8" height="28" rx="4"/>
  <circle cx="160" cy="0" r="5"/>
  <line x1="160" y1="10" x2="140" y2="28" stroke="#FF2D78" stroke-width="1" opacity="0.5"/>
  <line x1="160" y1="10" x2="180" y2="28" stroke="#FF2D78" stroke-width="1" opacity="0.5"/>
  <path d="M 75 85 Q 75 55 160 55 Q 245 55 245 85 L 245 210 Q 245 240 160 240 Q 75 240 75 210 Z"/>
  <circle cx="115" cy="145" r="28" fill="#020B18"/>
  <circle cx="205" cy="145" r="28" fill="#020B18"/>
  <circle cx="115" cy="145" r="24" fill="none" stroke="#FF2D78" stroke-width="1.5"/>
  <circle cx="205" cy="145" r="24" fill="none" stroke="#FF2D78" stroke-width="1.5"/>
  <circle cx="115" cy="145" r="18" fill="#FF2D78" opacity="0.15"/>
  <circle cx="205" cy="145" r="18" fill="#FF2D78" opacity="0.15"/>
  <circle cx="115" cy="145" r="10" fill="#FF2D78"/>
  <circle cx="205" cy="145" r="10" fill="#FF2D78"/>
  <circle cx="115" cy="145" r="5"  fill="#020B18"/>
  <circle cx="205" cy="145" r="5"  fill="#020B18"/>
  <line x1="91"  y1="145" x2="139" y2="145" stroke="#FF2D78" stroke-width="0.5" opacity="0.6"/>
  <line x1="181" y1="145" x2="229" y2="145" stroke="#FF2D78" stroke-width="0.5" opacity="0.6"/>
  <rect x="153" y="170" width="14" height="22" rx="5"/>
  <rect x="100" y="205" width="120" height="8" rx="4"/>
  <rect x="112" y="205" width="2"   height="8" fill="#020B18"/>
  <rect x="124" y="205" width="2"   height="8" fill="#020B18"/>
  <rect x="140" y="205" width="2"   height="8" fill="#020B18"/>
  <rect x="156" y="205" width="2"   height="8" fill="#020B18"/>
  <rect x="172" y="205" width="2"   height="8" fill="#020B18"/>
  <rect x="188" y="205" width="2"   height="8" fill="#020B18"/>
  <rect x="204" y="205" width="2"   height="8" fill="#020B18"/>
  <rect x="44"  y="115" width="31"  height="70" rx="8"/>
  <rect x="245" y="115" width="31"  height="70" rx="8"/>
  <line x1="52"  y1="130" x2="68"  y2="130" stroke="#020B18" stroke-width="1.5"/>
  <line x1="52"  y1="140" x2="68"  y2="140" stroke="#020B18" stroke-width="1.5"/>
  <line x1="52"  y1="150" x2="68"  y2="150" stroke="#020B18" stroke-width="1.5"/>
  <line x1="252" y1="130" x2="268" y2="130" stroke="#020B18" stroke-width="1.5"/>
  <line x1="252" y1="140" x2="268" y2="140" stroke="#020B18" stroke-width="1.5"/>
  <line x1="252" y1="150" x2="268" y2="150" stroke="#020B18" stroke-width="1.5"/>
  <line x1="80"  y1="175" x2="100" y2="175" stroke="#FF2D78" stroke-width="0.8" opacity="0.5"/>
  <line x1="80"  y1="175" x2="80"  y2="190" stroke="#FF2D78" stroke-width="0.8" opacity="0.5"/>
  <line x1="220" y1="175" x2="240" y2="175" stroke="#FF2D78" stroke-width="0.8" opacity="0.5"/>
  <line x1="240" y1="175" x2="240" y2="190" stroke="#FF2D78" stroke-width="0.8" opacity="0.5"/>
  <circle cx="80"  cy="190" r="2" opacity="0.6"/>
  <circle cx="240" cy="190" r="2" opacity="0.6"/>
  <rect x="135" y="240" width="50" height="30" rx="6"/>
  <line x1="147" y1="248" x2="147" y2="262" stroke="#020B18" stroke-width="2"/>
  <line x1="160" y1="248" x2="160" y2="262" stroke="#020B18" stroke-width="2"/>
  <line x1="173" y1="248" x2="173" y2="262" stroke="#020B18" stroke-width="2"/>
  <path d="M 30 280 Q 30 270 80 270 L 135 270 L 135 380 L 30 380 Z"/>
  <path d="M 290 280 Q 290 270 240 270 L 185 270 L 185 380 L 290 380 Z"/>
  <rect x="135" y="270" width="50" height="110"/>
  <rect x="142" y="295" width="36" height="20" rx="3" fill="#020B18" opacity="0.7"/>
  <rect x="146" y="299" width="28" height="2" rx="1"/>
  <rect x="146" y="305" width="20" height="2" rx="1"/>
  <rect x="146" y="311" width="24" height="2" rx="1"/>
  <line x1="60"  y1="290" x2="90"  y2="290" stroke="#FF2D78" stroke-width="0.8" opacity="0.45"/>
  <line x1="60"  y1="300" x2="80"  y2="300" stroke="#FF2D78" stroke-width="0.8" opacity="0.45"/>
  <line x1="230" y1="290" x2="260" y2="290" stroke="#FF2D78" stroke-width="0.8" opacity="0.45"/>
  <line x1="240" y1="300" x2="260" y2="300" stroke="#FF2D78" stroke-width="0.8" opacity="0.45"/>
  <circle cx="90"  cy="290" r="2" opacity="0.5"/>
  <circle cx="230" cy="290" r="2" opacity="0.5"/>
  <line x1="105" y1="78" x2="105" y2="95" stroke="#FF2D78" stroke-width="0.7" opacity="0.4"/>
  <line x1="160" y1="58" x2="160" y2="75" stroke="#FF2D78" stroke-width="0.7" opacity="0.4"/>
  <line x1="215" y1="78" x2="215" y2="95" stroke="#FF2D78" stroke-width="0.7" opacity="0.4"/>
  <line x1="105" y1="95" x2="215" y2="95" stroke="#FF2D78" stroke-width="0.7" opacity="0.4"/>
</svg>`;

  function inject() {
    // Inject CSS
    var style = document.createElement('style');
    style.id = 'hspw-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    // Scan lines
    var sl = document.createElement('div');
    sl.className = 'hspw-scanlines';

    // Radial glow
    var glow = document.createElement('div');
    glow.className = 'hspw-glow';

    // Micro-text texture
    var tex = document.createElement('div');
    tex.className = 'hspw-texture';
    var inner = document.createElement('div');
    inner.className = 'hspw-texture-inner';
    var label = 'HAWKEYE STERLING · AI COMPLIANCE · ';
    for (var i = 0; i < 160; i++) {
      var s = document.createElement('span');
      s.textContent = label;
      inner.appendChild(s);
    }
    tex.appendChild(inner);

    // Robot bust
    var robot = document.createElement('div');
    robot.className = 'hspw-robot';
    robot.innerHTML = ROBOT_SVG;

    // Wordmark
    var wm = document.createElement('div');
    wm.className = 'hspw-wordmark';
    wm.innerHTML =
      '<div class="hspw-wordmark-primary">Hawkeye Sterling</div>' +
      '<div class="hspw-wordmark-sub">Compliance AI · Est. 2025</div>';

    // Edge accents + pip
    var edgeR  = document.createElement('div'); edgeR.className  = 'hspw-edge-right';
    var edgeB  = document.createElement('div'); edgeB.className  = 'hspw-edge-bottom';
    var pip    = document.createElement('div'); pip.className    = 'hspw-pip';

    [sl, glow, tex, robot, wm, edgeR, edgeB, pip].forEach(function (el) {
      document.body.appendChild(el);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
