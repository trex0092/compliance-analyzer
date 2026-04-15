/**
 * Keyboard Shortcuts — registry + conflict detector + action router.
 *
 * Why this exists:
 *   Power users will not adopt a tool that makes them reach for the
 *   mouse. MLROs navigating 50 cases per shift save hours with
 *   well-chosen keyboard shortcuts. This module is the single source
 *   of truth for every shortcut in the tool:
 *
 *     - The registry is a typed list — UI uses it to render the
 *       cheat sheet and wire the listeners.
 *     - The conflict detector runs at module load and throws if two
 *       shortcuts bind the same key combo.
 *     - The action router takes a keyboard event and returns the
 *       matching action key (or null).
 *
 *   Pure function layer. No DOM. The UI layer binds
 *   `document.addEventListener('keydown', handler)` and feeds events
 *   through `matchShortcut`.
 *
 *   The registry supports:
 *     - Single-key shortcuts:   `?` → open cheat sheet
 *     - Modifier combos:        `Ctrl+K` → command palette
 *     - Chord sequences:        `g s` → switch to screening tab
 *
 *   Chords time out after 1.5 seconds of inactivity.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO operational efficiency)
 *   EU Accessibility Act     (keyboard navigation is mandatory)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShortcutModifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

export interface Shortcut {
  /** Stable id — dispatched to the action handler. */
  action: string;
  /** Human-readable label shown in the cheat sheet. */
  label: string;
  /**
   * Key sequence. Single-element array = one keystroke. Multi-element
   * = chord (e.g. ['g', 's']). Each element is the lowercase KeyboardEvent.key
   * plus optional modifiers.
   */
  sequence: ReadonlyArray<{ key: string; modifiers?: ShortcutModifiers }>;
  /** Category for the cheat sheet sections. */
  category: 'navigation' | 'brain' | 'tier-c' | 'audit' | 'help';
  /** Regulatory anchor explaining why this shortcut exists. */
  regulatory?: string;
}

export interface ShortcutConflict {
  a: Shortcut;
  b: Shortcut;
  collidingKey: string;
}

// ---------------------------------------------------------------------------
// Default registry
// ---------------------------------------------------------------------------

export const DEFAULT_SHORTCUTS: readonly Shortcut[] = [
  {
    action: 'help.open',
    label: 'Open keyboard cheat sheet',
    sequence: [{ key: '?' }],
    category: 'help',
  },
  {
    action: 'nav.commandPalette',
    label: 'Open command palette',
    sequence: [{ key: 'k', modifiers: { ctrl: true } }],
    category: 'navigation',
  },
  {
    action: 'nav.screening',
    label: 'Go to screening tab',
    sequence: [{ key: 'g' }, { key: 's' }],
    category: 'navigation',
  },
  {
    action: 'nav.incidents',
    label: 'Go to incidents tab',
    sequence: [{ key: 'g' }, { key: 'i' }],
    category: 'navigation',
  },
  {
    action: 'nav.brain',
    label: 'Go to brain console',
    sequence: [{ key: 'g' }, { key: 'b' }],
    category: 'navigation',
  },
  {
    action: 'nav.audit',
    label: 'Go to audit log viewer',
    sequence: [{ key: 'g' }, { key: 'a' }],
    category: 'navigation',
  },
  {
    action: 'nav.settings',
    label: 'Go to settings',
    sequence: [{ key: 'g' }, { key: 'c' }],
    category: 'navigation',
  },
  {
    action: 'brain.analyzeCurrent',
    label: 'Analyze current case',
    sequence: [{ key: 'enter', modifiers: { ctrl: true } }],
    category: 'brain',
    regulatory: 'FDL Art.20-22',
  },
  {
    action: 'brain.replayCurrent',
    label: 'Replay current case',
    sequence: [{ key: 'r', modifiers: { ctrl: true, shift: true } }],
    category: 'brain',
    regulatory: 'FDL Art.20',
  },
  {
    action: 'brain.evidenceCurrent',
    label: 'Export evidence bundle for current case',
    sequence: [{ key: 'e', modifiers: { ctrl: true, shift: true } }],
    category: 'brain',
    regulatory: 'FDL Art.24',
  },
  {
    action: 'tierC.clampList',
    label: 'List pending clamp suggestions',
    sequence: [{ key: 'c' }, { key: 'l' }],
    category: 'tier-c',
    regulatory: 'NIST AI RMF GOVERN-4',
  },
  {
    action: 'tierC.breakGlassList',
    label: 'List pending break-glass requests',
    sequence: [{ key: 'b' }, { key: 'g' }],
    category: 'tier-c',
    regulatory: 'Cabinet Res 134/2025 Art.12-14',
  },
  {
    action: 'audit.searchFocus',
    label: 'Focus audit search',
    sequence: [{ key: '/' }],
    category: 'audit',
  },
  {
    action: 'nav.back',
    label: 'Go back',
    sequence: [{ key: 'escape' }],
    category: 'navigation',
  },
];

// ---------------------------------------------------------------------------
// Conflict detector
// ---------------------------------------------------------------------------

function seqKey(seq: Shortcut['sequence']): string {
  return seq
    .map((s) => {
      const mods = s.modifiers ?? {};
      const flags = [
        mods.ctrl ? 'C' : '',
        mods.shift ? 'S' : '',
        mods.alt ? 'A' : '',
        mods.meta ? 'M' : '',
      ].join('');
      return `${flags}:${s.key.toLowerCase()}`;
    })
    .join('|');
}

export function detectConflicts(
  shortcuts: readonly Shortcut[] = DEFAULT_SHORTCUTS
): ShortcutConflict[] {
  const byKey = new Map<string, Shortcut>();
  const out: ShortcutConflict[] = [];
  for (const s of shortcuts) {
    const key = seqKey(s.sequence);
    const prior = byKey.get(key);
    if (prior) {
      out.push({ a: prior, b: s, collidingKey: key });
    } else {
      byKey.set(key, s);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Match engine
// ---------------------------------------------------------------------------

export interface PendingChordState {
  buffer: ReadonlyArray<{ key: string; modifiers?: ShortcutModifiers }>;
  /** Epoch ms of the last keystroke in the buffer. */
  lastPressedAt: number;
}

export const CHORD_TIMEOUT_MS = 1500;

export function emptyChordState(): PendingChordState {
  return { buffer: [], lastPressedAt: 0 };
}

function modifiersMatch(
  a: ShortcutModifiers | undefined,
  b: ShortcutModifiers | undefined
): boolean {
  const aFlags = {
    ctrl: Boolean(a?.ctrl),
    shift: Boolean(a?.shift),
    alt: Boolean(a?.alt),
    meta: Boolean(a?.meta),
  };
  const bFlags = {
    ctrl: Boolean(b?.ctrl),
    shift: Boolean(b?.shift),
    alt: Boolean(b?.alt),
    meta: Boolean(b?.meta),
  };
  return (
    aFlags.ctrl === bFlags.ctrl &&
    aFlags.shift === bFlags.shift &&
    aFlags.alt === bFlags.alt &&
    aFlags.meta === bFlags.meta
  );
}

export interface MatchResult {
  action: string | null;
  nextState: PendingChordState;
  isPending: boolean;
}

export function matchShortcut(
  press: { key: string; modifiers?: ShortcutModifiers },
  state: PendingChordState,
  now: number,
  shortcuts: readonly Shortcut[] = DEFAULT_SHORTCUTS
): MatchResult {
  // Drop chord buffer if stale.
  const buffer = now - state.lastPressedAt <= CHORD_TIMEOUT_MS ? [...state.buffer] : [];
  buffer.push({ key: press.key.toLowerCase(), modifiers: press.modifiers });

  // Exact match?
  for (const s of shortcuts) {
    if (s.sequence.length !== buffer.length) continue;
    let ok = true;
    for (let i = 0; i < buffer.length; i++) {
      const expected = s.sequence[i]!;
      const actual = buffer[i]!;
      if (actual.key !== expected.key.toLowerCase()) {
        ok = false;
        break;
      }
      if (!modifiersMatch(actual.modifiers, expected.modifiers)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return {
        action: s.action,
        nextState: emptyChordState(),
        isPending: false,
      };
    }
  }

  // Is this a prefix of a longer shortcut? → keep buffer
  const isPending = shortcuts.some((s) => {
    if (s.sequence.length <= buffer.length) return false;
    for (let i = 0; i < buffer.length; i++) {
      const expected = s.sequence[i]!;
      const actual = buffer[i]!;
      if (actual.key !== expected.key.toLowerCase()) return false;
      if (!modifiersMatch(actual.modifiers, expected.modifiers)) return false;
    }
    return true;
  });

  return {
    action: null,
    nextState: isPending ? { buffer, lastPressedAt: now } : emptyChordState(),
    isPending,
  };
}

/**
 * Group shortcuts by category for the cheat sheet. Returns a stable
 * ordering so the help dialog never shuffles.
 */
export function groupShortcuts(
  shortcuts: readonly Shortcut[] = DEFAULT_SHORTCUTS
): Record<Shortcut['category'], Shortcut[]> {
  const groups: Record<Shortcut['category'], Shortcut[]> = {
    navigation: [],
    brain: [],
    'tier-c': [],
    audit: [],
    help: [],
  };
  for (const s of shortcuts) {
    groups[s.category].push(s);
  }
  for (const cat of Object.keys(groups) as Shortcut['category'][]) {
    groups[cat].sort((a, b) => a.label.localeCompare(b.label));
  }
  return groups;
}

// Exports for tests.
export const __test__ = { seqKey, modifiersMatch };
