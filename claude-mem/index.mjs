/**
 * Claude Memory Module
 * Persistent cross-session intelligence store for autopilot observations.
 * Records compliance decisions, patterns, and alerts for trend analysis.
 */
import { load, save } from '../scripts/lib/store.mjs';

class ClaudeMemory {
  constructor() {
    this.sessionId = null;
    this.observations = [];
    this.startedAt = null;
  }

  startSession(sessionId) {
    this.sessionId = sessionId;
    this.observations = [];
    this.startedAt = new Date().toISOString();
  }

  observe({ category, content, importance = 5 }) {
    this.observations.push({
      category,
      content,
      importance,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
    });
  }

  async endSession(summary) {
    const sessions = await load('memory-sessions', []);

    sessions.push({
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      summary,
      observations: this.observations,
      observationCount: this.observations.length,
    });

    // Keep last 365 sessions (1 year of daily runs)
    if (sessions.length > 365) sessions.splice(0, sessions.length - 365);

    await save('memory-sessions', sessions);

    // Also append high-importance observations to the global memory
    const globalMemory = await load('memory-global', []);
    const important = this.observations.filter(o => o.importance >= 7);
    globalMemory.push(...important);

    // Keep last 1000 global observations
    if (globalMemory.length > 1000) globalMemory.splice(0, globalMemory.length - 1000);

    await save('memory-global', globalMemory);
  }

  close() {
    this.sessionId = null;
    this.observations = [];
  }
}

export default new ClaudeMemory();
