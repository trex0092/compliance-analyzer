/**
 * Voice MLRO Assistant — Web Speech API wrapper.
 *
 * Browser-side voice interface for the MLRO. Uses the standard
 * SpeechRecognition + SpeechSynthesis APIs (no LiveKit, no external
 * server, no API keys) so the assistant works offline and degrades
 * gracefully when speech support is missing.
 *
 * Capabilities:
 *   1. listen()        — start a single recognition turn, resolves with
 *                        the recognised transcript.
 *   2. speak()         — speak a string with neutral SSML-free prosody.
 *   3. brief()         — convenience: speak each sentence in a voice
 *                        brief produced by `buildVoiceBrief`.
 *   4. interpretCommand() — classify a transcript into one of the
 *                        supported MLRO intents. Pure function — no
 *                        I/O — so it can be unit-tested deterministically.
 *
 * Privacy & security:
 *   - The assistant ONLY runs in a secure context (HTTPS).
 *   - It DOES NOT transmit transcripts to any server. The recognition
 *     happens via the browser's built-in engine.
 *   - All commands go through the same authenticated backend as the
 *     visual UI — voice does not bypass auth.
 */

// ---------------------------------------------------------------------------
// Browser API typings — Web Speech is not in lib.dom.d.ts by default.
// ---------------------------------------------------------------------------

interface MinimalSpeechRecognitionEvent {
  results: ArrayLike<{
    isFinal?: boolean;
    [index: number]: { transcript: string };
  }>;
}

interface MinimalSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: MinimalSpeechRecognitionEvent) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechWindow {
  SpeechRecognition?: { new (): MinimalSpeechRecognition };
  webkitSpeechRecognition?: { new (): MinimalSpeechRecognition };
  speechSynthesis?: {
    speak(utterance: { text: string; rate: number; pitch: number; lang: string }): void;
    cancel(): void;
    speaking: boolean;
  };
  SpeechSynthesisUtterance?: {
    new (text: string): { text: string; rate: number; pitch: number; lang: string };
  };
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type VoiceIntent =
  | { kind: 'screen'; entityName: string }
  | { kind: 'rescreen'; entityName: string }
  | { kind: 'status' }
  | { kind: 'show_alerts' }
  | { kind: 'show_freezes' }
  | { kind: 'file_str'; entityName: string }
  | { kind: 'unknown'; raw: string };

export interface VoiceMlroOptions {
  language?: string;
  win?: SpeechWindow;
}

export class VoiceMlroAssistant {
  private readonly language: string;
  private readonly win: SpeechWindow;

  constructor(options: VoiceMlroOptions = {}) {
    this.language = options.language ?? 'en-AE';
    this.win =
      options.win ??
      (typeof window !== 'undefined' ? (window as unknown as SpeechWindow) : ({} as SpeechWindow));
  }

  isSupported(): boolean {
    return Boolean(
      (this.win.SpeechRecognition || this.win.webkitSpeechRecognition) && this.win.speechSynthesis
    );
  }

  /**
   * Start a single recognition turn. Resolves with the final transcript
   * or rejects with an Error describing why recognition failed.
   */
  listen(): Promise<string> {
    return new Promise((resolve, reject) => {
      const Ctor = this.win.SpeechRecognition || this.win.webkitSpeechRecognition;
      if (!Ctor) {
        reject(new Error('SpeechRecognition not supported in this browser.'));
        return;
      }
      const rec = new Ctor();
      rec.lang = this.language;
      rec.continuous = false;
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      let settled = false;
      rec.onresult = (ev) => {
        if (settled) return;
        settled = true;
        const results = ev.results;
        if (!results || results.length === 0) {
          reject(new Error('No transcript produced.'));
          return;
        }
        const first = results[0];
        const transcript = first[0]?.transcript ?? '';
        if (!transcript.trim()) {
          reject(new Error('Empty transcript.'));
          return;
        }
        resolve(transcript.trim());
      };
      rec.onerror = (ev) => {
        if (settled) return;
        settled = true;
        reject(new Error(`SpeechRecognition error: ${ev.error}`));
      };
      rec.onend = () => {
        if (!settled) {
          settled = true;
          reject(new Error('SpeechRecognition ended without a result.'));
        }
      };
      try {
        rec.start();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reject(new Error(`SpeechRecognition.start() threw: ${msg}`));
      }
    });
  }

  /**
   * Speak one sentence at a neutral pace (rate 1.0). The function does
   * NOT wait for the utterance to finish — speak each sentence
   * sequentially via `await brief()` if you need ordering.
   */
  speak(text: string): void {
    const synth = this.win.speechSynthesis;
    const Utt = this.win.SpeechSynthesisUtterance;
    if (!synth || !Utt) return;
    const utt = new Utt(text);
    utt.rate = 1.0;
    utt.pitch = 1.0;
    utt.lang = this.language;
    synth.speak(utt);
  }

  /**
   * Speak every sentence in a voice brief sequentially. Each sentence
   * waits a short pause so the TTS engine can finish naturally before
   * the next one starts.
   */
  async brief(sentences: readonly string[]): Promise<void> {
    for (const s of sentences) {
      this.speak(s);
      // A 600ms pause between sentences gives the synthesizer time to
      // finish even on the slowest engines without queuing them all.
      await delay(600);
    }
  }

  /**
   * Cancel any pending or active utterance. Useful when the operator
   * issues a new command while a brief is still being read.
   */
  cancel(): void {
    if (this.win.speechSynthesis) this.win.speechSynthesis.cancel();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// ---------------------------------------------------------------------------
// Pure intent classifier
// ---------------------------------------------------------------------------

/**
 * Classify a free-text MLRO command into a structured intent. Pure —
 * no I/O — so the unit suite can pin the parser without mocking the
 * SpeechRecognition API.
 *
 * Patterns are intentionally permissive: the assistant should accept
 * "screen Acme Corp", "please screen Acme Corp", "run a screen on
 * Acme Corp", "screening Acme Corp now", etc.
 */
export function interpretCommand(transcript: string): VoiceIntent {
  const raw = (transcript || '').trim();
  if (!raw) return { kind: 'unknown', raw };
  const lower = raw.toLowerCase();

  // Status commands — try these first because they're the cheapest.
  if (/\b(status|brief(?:\s+me)?|sitrep|summary|how are we doing|war room)\b/.test(lower)) {
    return { kind: 'status' };
  }
  if (/\b(alerts?|warnings?)\b/.test(lower) && /\bshow|list|what\b/.test(lower)) {
    return { kind: 'show_alerts' };
  }
  if (/\b(freezes?|freezing)\b/.test(lower) && /\b(show|list|what|active)\b/.test(lower)) {
    return { kind: 'show_freezes' };
  }

  // Re-screen — must check before screen so the prefix doesn't win.
  let m = lower.match(/\b(?:re[-\s]?screen|rescreen)\b\s+(?:on\s+)?(.+?)$/);
  if (m && m[1]) {
    return { kind: 'rescreen', entityName: cleanEntityName(m[1]) };
  }
  // File STR — handle "file an STR on Acme", "draft an STR for Acme",
  // "prepare the STR against Acme". Allow optional articles between
  // the verb and the noun.
  m = lower.match(
    /\b(?:file|draft|prepare)\b\s+(?:an?\s+|the\s+)?\bstr\b\s+(?:on|for|against)\s+(.+?)$/
  );
  if (m && m[1]) {
    return { kind: 'file_str', entityName: cleanEntityName(m[1]) };
  }
  // Screen — broad pattern.
  m = lower.match(/\b(?:screen(?:ing)?|run\s+a\s+screen)\b\s+(?:on\s+|for\s+)?(.+?)$/);
  if (m && m[1]) {
    return { kind: 'screen', entityName: cleanEntityName(m[1]) };
  }

  return { kind: 'unknown', raw };
}

function cleanEntityName(s: string): string {
  return s
    .replace(/\b(now|please|right away|asap)\b/gi, '')
    .replace(/[.?!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
