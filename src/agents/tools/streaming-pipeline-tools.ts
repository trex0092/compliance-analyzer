/**
 * Real-time Streaming Pipeline
 *
 * Event-driven architecture for live compliance monitoring:
 * 1. Event bus with pub/sub pattern
 * 2. Stream processing with windowed aggregation
 * 3. Alert correlation — group related alerts
 * 4. Priority queue for alert triage
 * 5. Backpressure handling for high-volume periods
 * 6. Dead letter queue for failed processing
 *
 * Enables real-time transaction monitoring, instant sanctions
 * alerts, and live dashboard updates.
 */

import type { ToolResult } from '../mcp-server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventType =
  | 'transaction' | 'screening-result' | 'alert' | 'case-update'
  | 'approval-decision' | 'filing-submitted' | 'threshold-breach'
  | 'sanctions-match' | 'cdd-expiry' | 'risk-score-change';

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface ComplianceEvent {
  id: string;
  type: EventType;
  timestamp: string;
  priority: Priority;
  source: string;
  entityId?: string;
  entityName?: string;
  data: Record<string, unknown>;
  correlationId?: string;
}

export interface EventHandler {
  id: string;
  eventTypes: EventType[];
  priority: number; // lower = higher priority
  handler: (event: ComplianceEvent) => Promise<void> | void;
}

export interface WindowedAggregation {
  windowId: string;
  windowStart: string;
  windowEnd: string;
  windowSizeMs: number;
  eventCount: number;
  aggregations: Record<string, number>;
  alerts: string[];
}

export interface CorrelatedAlertGroup {
  correlationId: string;
  primaryAlert: ComplianceEvent;
  relatedAlerts: ComplianceEvent[];
  combinedSeverity: Priority;
  entityId: string;
  entityName: string;
  timespan: { from: string; to: string };
  narrative: string;
}

export interface PipelineMetrics {
  totalEventsProcessed: number;
  eventsPerSecond: number;
  avgProcessingTimeMs: number;
  activeHandlers: number;
  queueDepth: number;
  deadLetterCount: number;
  windowsActive: number;
  correlationGroupsActive: number;
  backpressureActive: boolean;
}

// ---------------------------------------------------------------------------
// Event Bus
// ---------------------------------------------------------------------------

export class ComplianceEventBus {
  private handlers = new Map<string, EventHandler>();
  private eventLog: ComplianceEvent[] = [];
  private deadLetterQueue: Array<{ event: ComplianceEvent; error: string; timestamp: string }> = [];
  private windows = new Map<string, WindowedAggregation>();
  private correlationGroups = new Map<string, CorrelatedAlertGroup>();
  private metrics: PipelineMetrics = {
    totalEventsProcessed: 0,
    eventsPerSecond: 0,
    avgProcessingTimeMs: 0,
    activeHandlers: 0,
    queueDepth: 0,
    deadLetterCount: 0,
    windowsActive: 0,
    correlationGroupsActive: 0,
    backpressureActive: false,
  };
  private processingTimes: number[] = [];
  private priorityQueue: ComplianceEvent[] = [];
  private processing = false;
  private maxQueueSize = 10_000;
  private onAlert?: (group: CorrelatedAlertGroup) => void;

  constructor(onAlert?: (group: CorrelatedAlertGroup) => void) {
    this.onAlert = onAlert;
  }

  /** Subscribe to events */
  subscribe(handler: EventHandler): void {
    this.handlers.set(handler.id, handler);
    this.metrics.activeHandlers = this.handlers.size;
  }

  /** Unsubscribe */
  unsubscribe(handlerId: string): void {
    this.handlers.delete(handlerId);
    this.metrics.activeHandlers = this.handlers.size;
  }

  /** Publish an event */
  async publish(event: ComplianceEvent): Promise<void> {
    // Backpressure check
    if (this.priorityQueue.length >= this.maxQueueSize) {
      this.metrics.backpressureActive = true;
      // Drop lowest priority events
      if (event.priority === 'critical' || event.priority === 'high') {
        this.priorityQueue = this.priorityQueue.filter((e) => e.priority !== 'low');
      } else {
        this.deadLetterQueue.push({
          event,
          error: 'Queue full — backpressure applied',
          timestamp: new Date().toISOString(),
        });
        this.metrics.deadLetterCount = this.deadLetterQueue.length;
        return;
      }
    }

    // Insert into priority queue
    this.insertByPriority(event);
    this.metrics.queueDepth = this.priorityQueue.length;

    // Process queue
    if (!this.processing) {
      await this.processQueue();
    }
  }

  /** Process all queued events */
  private async processQueue(): Promise<void> {
    this.processing = true;

    while (this.priorityQueue.length > 0) {
      const event = this.priorityQueue.shift()!;
      const start = Date.now();

      try {
        await this.processEvent(event);
        this.eventLog.push(event);
        this.metrics.totalEventsProcessed++;

        const duration = Date.now() - start;
        this.processingTimes.push(duration);
        if (this.processingTimes.length > 100) this.processingTimes.shift();
        this.metrics.avgProcessingTimeMs = this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length;
      } catch (err) {
        this.deadLetterQueue.push({
          event,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        });
        this.metrics.deadLetterCount = this.deadLetterQueue.length;
      }
    }

    this.processing = false;
    this.metrics.queueDepth = 0;
    this.metrics.backpressureActive = false;
  }

  /** Process a single event */
  private async processEvent(event: ComplianceEvent): Promise<void> {
    // 1. Run matching handlers (sorted by priority)
    const matchingHandlers = Array.from(this.handlers.values())
      .filter((h) => h.eventTypes.includes(event.type))
      .sort((a, b) => a.priority - b.priority);

    for (const handler of matchingHandlers) {
      await handler.handler(event);
    }

    // 2. Update windowed aggregation
    this.updateWindow(event);

    // 3. Correlate with existing alerts
    if (event.type === 'alert' || event.type === 'sanctions-match' || event.type === 'threshold-breach') {
      this.correlateAlert(event);
    }
  }

  /** Windowed aggregation */
  private updateWindow(event: ComplianceEvent): void {
    const windowSizeMs = 5 * 60_000; // 5-minute windows
    const now = Date.now();
    const windowStart = Math.floor(now / windowSizeMs) * windowSizeMs;
    const windowId = `window-${windowStart}`;

    if (!this.windows.has(windowId)) {
      this.windows.set(windowId, {
        windowId,
        windowStart: new Date(windowStart).toISOString(),
        windowEnd: new Date(windowStart + windowSizeMs).toISOString(),
        windowSizeMs,
        eventCount: 0,
        aggregations: {},
        alerts: [],
      });
      this.metrics.windowsActive = this.windows.size;
    }

    const window = this.windows.get(windowId)!;
    window.eventCount++;
    window.aggregations[event.type] = (window.aggregations[event.type] ?? 0) + 1;

    // Alert if window has unusual event density
    if (window.eventCount > 100 && !window.alerts.includes('high-volume')) {
      window.alerts.push('high-volume');
    }

    // Clean old windows (keep last 10)
    if (this.windows.size > 10) {
      const oldest = Array.from(this.windows.keys()).sort()[0];
      this.windows.delete(oldest);
    }
  }

  /** Alert correlation */
  private correlateAlert(event: ComplianceEvent): void {
    const entityId = event.entityId ?? 'unknown';
    const correlationKey = `${entityId}-${event.type}`;

    if (!this.correlationGroups.has(correlationKey)) {
      this.correlationGroups.set(correlationKey, {
        correlationId: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        primaryAlert: event,
        relatedAlerts: [],
        combinedSeverity: event.priority,
        entityId,
        entityName: event.entityName ?? entityId,
        timespan: { from: event.timestamp, to: event.timestamp },
        narrative: `Initial ${event.type} alert for ${event.entityName ?? entityId}`,
      });
    } else {
      const group = this.correlationGroups.get(correlationKey)!;
      group.relatedAlerts.push(event);
      group.timespan.to = event.timestamp;

      // Escalate severity
      const priorityMap: Record<Priority, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      if (priorityMap[event.priority] > priorityMap[group.combinedSeverity]) {
        group.combinedSeverity = event.priority;
      }

      // Auto-escalate if multiple alerts
      if (group.relatedAlerts.length >= 3 && group.combinedSeverity !== 'critical') {
        group.combinedSeverity = 'critical';
        group.narrative = `Multiple ${event.type} alerts (${group.relatedAlerts.length + 1}) for ${group.entityName} — auto-escalated to critical`;
      }

      this.onAlert?.(group);
    }
    this.metrics.correlationGroupsActive = this.correlationGroups.size;
  }

  /** Insert event into priority queue */
  private insertByPriority(event: ComplianceEvent): void {
    const priorityMap: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const eventPriority = priorityMap[event.priority];

    let insertIndex = this.priorityQueue.length;
    for (let i = 0; i < this.priorityQueue.length; i++) {
      if (priorityMap[this.priorityQueue[i].priority] > eventPriority) {
        insertIndex = i;
        break;
      }
    }
    this.priorityQueue.splice(insertIndex, 0, event);
  }

  // ---- Public API ----

  getMetrics(): PipelineMetrics { return { ...this.metrics }; }

  getRecentEvents(limit: number = 50): ComplianceEvent[] {
    return this.eventLog.slice(-limit);
  }

  getCorrelationGroups(): CorrelatedAlertGroup[] {
    return Array.from(this.correlationGroups.values());
  }

  getActiveWindows(): WindowedAggregation[] {
    return Array.from(this.windows.values());
  }

  getDeadLetterQueue(): typeof this.deadLetterQueue {
    return [...this.deadLetterQueue];
  }

  retryDeadLetters(): Promise<void> {
    const letters = this.deadLetterQueue.splice(0);
    this.metrics.deadLetterCount = 0;
    return Promise.all(letters.map((l) => this.publish(l.event))).then(() => {});
  }

  clearCorrelationGroups(): void {
    this.correlationGroups.clear();
    this.metrics.correlationGroupsActive = 0;
  }
}

// ---------------------------------------------------------------------------
// Pre-built Event Handlers
// ---------------------------------------------------------------------------

export function createComplianceHandlers(): EventHandler[] {
  return [
    {
      id: 'sanctions-freeze-handler',
      eventTypes: ['sanctions-match'],
      priority: 0, // highest
      handler: (event) => {
        const confidence = (event.data.confidence as number) ?? 0;
        if (confidence >= 0.9) {
          // In production: trigger immediate freeze
          console.log(`[FREEZE] ${event.entityName} — confidence ${confidence}`);
        }
      },
    },
    {
      id: 'threshold-breach-handler',
      eventTypes: ['threshold-breach'],
      priority: 1,
      handler: (event) => {
        const amount = (event.data.amount as number) ?? 0;
        if (amount >= 55_000) {
          console.log(`[CTR REQUIRED] ${event.entityName} — AED ${amount}`);
        }
      },
    },
    {
      id: 'risk-change-handler',
      eventTypes: ['risk-score-change'],
      priority: 2,
      handler: (event) => {
        const newScore = (event.data.newScore as number) ?? 0;
        if (newScore >= 16) {
          console.log(`[CRITICAL RISK] ${event.entityName} — score ${newScore}`);
        }
      },
    },
    {
      id: 'cdd-expiry-handler',
      eventTypes: ['cdd-expiry'],
      priority: 3,
      handler: (event) => {
        console.log(`[CDD EXPIRED] ${event.entityName} — review required`);
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Schema exports
// ---------------------------------------------------------------------------

export const STREAMING_TOOL_SCHEMAS = [
  {
    name: 'get_pipeline_metrics',
    description:
      'Get real-time streaming pipeline metrics: events processed, throughput, queue depth, correlation groups, backpressure status.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_correlated_alerts',
    description:
      'Get correlated alert groups — related alerts automatically grouped by entity and type with combined severity escalation.',
    inputSchema: {
      type: 'object',
      properties: {
        minSeverity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      },
    },
  },
] as const;
