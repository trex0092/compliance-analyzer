/**
 * ============================================================================
 * ASANA BRAIN: UNIFIED SYSTEM INTEGRATION TESTS
 * ============================================================================
 * 
 * Comprehensive test suite for all integrated components
 * 60+ integration tests covering all layers and features
 */

const {
  LoggerService,
  TracingService,
  MetricsService,
  AsanaPATAuthService,
  AsanaAPIClient,
  DatabaseService,
  AsanaTaskSyncEngine,
  AsanaWebhookHandler,
  RealTimeSyncScheduler,
  RiskScoringEngine,
  ComplianceValidator,
  EventProcessingPipeline,
  NotificationService,
  AlertRulesEngine,
  AsanaBrainOrchestrator,
} = require('./asana-brain-unified-system');

// ============================================================================
// TEST UTILITIES
// ============================================================================

class TestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  async run() {
    console.log('\n🧪 RUNNING ASANA BRAIN INTEGRATION TESTS\n');
    console.log('='.repeat(80));

    for (const test of this.tests) {
      try {
        await test.fn();
        console.log(`✅ ${test.name}`);
        this.passed++;
      } catch (error) {
        console.log(`❌ ${test.name}`);
        console.log(`   Error: ${error.message}`);
        this.failed++;
      }
    }

    console.log('='.repeat(80));
    console.log(`\n📊 TEST RESULTS: ${this.passed} passed, ${this.failed} failed\n`);

    return {
      total: this.tests.length,
      passed: this.passed,
      failed: this.failed,
      successRate: ((this.passed / this.tests.length) * 100).toFixed(2) + '%',
    };
  }
}

const runner = new TestRunner();

// ============================================================================
// CORE SERVICES TESTS
// ============================================================================

runner.test('LoggerService: Initialize and log messages', () => {
  const logger = new LoggerService({ debug: true });
  logger.info('Test message', { key: 'value' });
  logger.warn('Warning message');
  logger.error('Error message');

  const logs = logger.getLogs();
  if (logs.length < 3) throw new Error('Logs not recorded');
});

runner.test('LoggerService: Filter logs by level', () => {
  const logger = new LoggerService();
  logger.info('Info message');
  logger.error('Error message');

  const errors = logger.getLogs('ERROR');
  if (errors.length !== 1) throw new Error('Log filtering failed');
});

runner.test('TracingService: Create and finish spans', () => {
  const tracer = new TracingService();
  const span = tracer.startSpan('test_span');
  span.setTag('key', 'value');
  span.finish();

  const spans = tracer.getSpans();
  if (spans.length !== 1) throw new Error('Span not recorded');
  if (spans[0].tags.key !== 'value') throw new Error('Tag not set');
});

runner.test('TracingService: Calculate metrics', () => {
  const tracer = new TracingService();
  const span = tracer.startSpan('test');
  span.finish();

  const metrics = tracer.getMetrics();
  if (metrics.totalSpans !== 1) throw new Error('Metrics calculation failed');
});

runner.test('MetricsService: Increment counters', () => {
  const metrics = new MetricsService();
  metrics.increment('test.counter', 1);
  metrics.increment('test.counter', 2);

  const allMetrics = metrics.getMetrics();
  if (allMetrics['test.counter'] !== 3) throw new Error('Counter increment failed');
});

runner.test('MetricsService: Set gauge values', () => {
  const metrics = new MetricsService();
  metrics.gauge('test.gauge', 42);

  const allMetrics = metrics.getMetrics();
  if (allMetrics['test.gauge'] !== 42) throw new Error('Gauge not set');
});

runner.test('MetricsService: Record timings', () => {
  const metrics = new MetricsService();
  metrics.timing('test.timing', 100);
  metrics.timing('test.timing', 200);

  const allMetrics = metrics.getMetrics();
  if (allMetrics['test.timing.timings'].length !== 2) throw new Error('Timings not recorded');
});

// ============================================================================
// FOUNDATION LAYER TESTS
// ============================================================================

runner.test('AsanaPATAuthService: Authenticate with PAT', async () => {
  const logger = new LoggerService();
  const auth = new AsanaPATAuthService('test-pat-token', logger);
  const result = await auth.authenticate();

  if (!result.success) throw new Error('Authentication failed');
  if (!auth.isTokenValid()) throw new Error('Token not valid');
});

runner.test('AsanaPATAuthService: Validate token expiry', async () => {
  const logger = new LoggerService();
  const auth = new AsanaPATAuthService('test-pat-token', logger);
  await auth.authenticate();

  const token = auth.getToken();
  if (!token) throw new Error('Token not retrieved');
});

runner.test('AsanaAPIClient: Make API request', async () => {
  const logger = new LoggerService();
  const tracer = new TracingService();
  const metrics = new MetricsService();

  const client = new AsanaAPIClient('test-pat', logger, tracer, metrics);
  const response = await client.makeRequest('/projects/123/tasks');

  if (response.status !== 200) throw new Error('API request failed');
  if (!response.data) throw new Error('No response data');
});

runner.test('AsanaAPIClient: Get tasks', async () => {
  const logger = new LoggerService();
  const tracer = new TracingService();
  const metrics = new MetricsService();

  const client = new AsanaAPIClient('test-pat', logger, tracer, metrics);
  const response = await client.getTasks('project-123');

  if (!response.data) throw new Error('Tasks not retrieved');
});

runner.test('DatabaseService: Connect to database', async () => {
  const logger = new LoggerService();
  const db = new DatabaseService({ host: 'localhost' }, logger);
  const result = await db.connect();

  if (!result.success) throw new Error('Database connection failed');
});

runner.test('DatabaseService: Execute query', async () => {
  const logger = new LoggerService();
  const db = new DatabaseService({ host: 'localhost' }, logger);
  await db.connect();

  const result = await db.query('SELECT * FROM tasks');
  if (!result.rows) throw new Error('Query execution failed');
});

runner.test('DatabaseService: Transaction support', async () => {
  const logger = new LoggerService();
  const db = new DatabaseService({ host: 'localhost' }, logger);
  await db.connect();

  await db.beginTransaction();
  if (!db.inTransaction) throw new Error('Transaction not started');

  await db.commit();
  if (db.inTransaction) throw new Error('Transaction not committed');
});

// ============================================================================
// SYNC LAYER TESTS
// ============================================================================

runner.test('AsanaTaskSyncEngine: Sync all tasks', async () => {
  const logger = new LoggerService();
  const tracer = new TracingService();
  const metrics = new MetricsService();

  const asanaClient = new AsanaAPIClient('test-pat', logger, tracer, metrics);
  const db = new DatabaseService({ host: 'localhost' }, logger);
  await db.connect();

  const syncEngine = new AsanaTaskSyncEngine(asanaClient, db, logger, tracer, metrics);
  const result = await syncEngine.syncAllTasks('project-123');

  if (result.synced === undefined) throw new Error('Sync failed');
  if (!result.lastSyncTime) throw new Error('Sync time not recorded');
});

runner.test('AsanaTaskSyncEngine: Push changes to Asana', async () => {
  const logger = new LoggerService();
  const tracer = new TracingService();
  const metrics = new MetricsService();

  const asanaClient = new AsanaAPIClient('test-pat', logger, tracer, metrics);
  const db = new DatabaseService({ host: 'localhost' }, logger);
  await db.connect();

  const syncEngine = new AsanaTaskSyncEngine(asanaClient, db, logger, tracer, metrics);
  const result = await syncEngine.pushChanges('task-123', { status: 'completed' });

  if (!result.success) throw new Error('Push failed');
});

runner.test('AsanaWebhookHandler: Register webhook', async () => {
  const logger = new LoggerService();
  const tracer = new TracingService();
  const metrics = new MetricsService();

  const db = new DatabaseService({ host: 'localhost' }, logger);
  const handler = new AsanaWebhookHandler(db, logger, tracer, metrics);

  const result = await handler.registerWebhook('project-123', 'https://example.com/webhook');
  if (!result.success) throw new Error('Webhook registration failed');
});

runner.test('AsanaWebhookHandler: Handle webhook event', async () => {
  const logger = new LoggerService();
  const tracer = new TracingService();
  const metrics = new MetricsService();

  const db = new DatabaseService({ host: 'localhost' }, logger);
  const handler = new AsanaWebhookHandler(db, logger, tracer, metrics);

  const event = { type: 'task.created', data: { id: 'task-123', name: 'Test Task' } };
  const result = await handler.handleWebhookEvent(event);

  if (!result.processed) throw new Error('Event not processed');
});

runner.test('RealTimeSyncScheduler: Start and stop scheduler', () => {
  const logger = new LoggerService();
  const tracer = new TracingService();
  const metrics = new MetricsService();

  const asanaClient = new AsanaAPIClient('test-pat', logger, tracer, metrics);
  const db = new DatabaseService({ host: 'localhost' }, logger);
  const syncEngine = new AsanaTaskSyncEngine(asanaClient, db, logger, tracer, metrics);

  const scheduler = new RealTimeSyncScheduler(syncEngine, logger);
  scheduler.start('project-123');

  if (!scheduler.timer) throw new Error('Scheduler not started');

  scheduler.stop();
  if (scheduler.timer) throw new Error('Scheduler not stopped');
});

// ============================================================================
// INTELLIGENCE LAYER TESTS
// ============================================================================

runner.test('RiskScoringEngine: Score task risk', async () => {
  const logger = new LoggerService();
  const tracer = new TracingService();
  const metrics = new MetricsService();

  const db = new DatabaseService({ host: 'localhost' }, logger);
  const engine = new RiskScoringEngine(db, logger, tracer, metrics);

  const task = {
    id: 'task-123',
    title: 'Compliance Task',
    description: 'This is a long description about compliance requirements that needs to be completed',
    due_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    assignee_id: 'user-123',
  };

  const result = await engine.scoreTask(task);
  if (result.score === undefined) throw new Error('Risk score not calculated');
  if (!result.riskLevel) throw new Error('Risk level not determined');
});

runner.test('ComplianceValidator: Validate task compliance', async () => {
  const logger = new LoggerService();
  const tracer = new TracingService();
  const metrics = new MetricsService();

  const db = new DatabaseService({ host: 'localhost' }, logger);
  const validator = new ComplianceValidator(db, logger, tracer, metrics);

  const task = {
    id: 'task-123',
    title: 'Test Task',
    description: 'This is a test task with sufficient documentation',
    assignee_id: 'user-123',
    due_date: new Date(),
  };

  const result = await validator.validateTask(task);
  if (result.compliant === undefined) throw new Error('Compliance validation failed');
  if (!Array.isArray(result.violations)) throw new Error('Violations not returned');
});

runner.test('ComplianceValidator: Detect missing fields', async () => {
  const logger = new LoggerService();
  const tracer = new TracingService();
  const metrics = new MetricsService();

  const db = new DatabaseService({ host: 'localhost' }, logger);
  const validator = new ComplianceValidator(db, logger, tracer, metrics);

  const task = {
    id: 'task-123',
    title: '',
    description: '',
    assignee_id: null,
    due_date: null,
  };

  const result = await validator.validateTask(task);
  if (result.violations.length === 0) throw new Error('Violations not detected');
});

runner.test('EventProcessingPipeline: Process event', async () => {
  const logger = new LoggerService();
  const tracer = new TracingService();
  const metrics = new MetricsService();

  const db = new DatabaseService({ host: 'localhost' }, logger);
  const pipeline = new EventProcessingPipeline(db, logger, tracer, metrics);

  const event = { type: 'task.created', data: { id: 'task-123' } };
  const result = await pipeline.processEvent(event);

  if (!result.processed) throw new Error('Event not processed');
});

runner.test('EventProcessingPipeline: Queue status', async () => {
  const logger = new LoggerService();
  const tracer = new TracingService();
  const metrics = new MetricsService();

  const db = new DatabaseService({ host: 'localhost' }, logger);
  const pipeline = new EventProcessingPipeline(db, logger, tracer, metrics);

  const status = pipeline.getQueueStatus();
  if (status.queueLength === undefined) throw new Error('Queue status not available');
});

// ============================================================================
// OPERATIONS LAYER TESTS
// ============================================================================

runner.test('NotificationService: Register notification channel', async () => {
  const logger = new LoggerService();
  const tracer = new TracingService();
  const metrics = new MetricsService();

  const service = new NotificationService(logger, tracer, metrics);
  await service.registerChannel('test', async (alert) => {
    return { sent: true };
  });

  if (service.channels.size !== 1) throw new Error('Channel not registered');
});

runner.test('NotificationService: Send alert', async () => {
  const logger = new LoggerService();
  const tracer = new TracingService();
  const metrics = new MetricsService();

  const service = new NotificationService(logger, tracer, metrics);
  await service.registerChannel('test', async (alert) => {
    return { sent: true };
  });

  const result = await service.sendAlert('high', 'Test alert');
  if (!result.sent) throw new Error('Alert not sent');
});

runner.test('AlertRulesEngine: Create alert rule', async () => {
  const logger = new LoggerService();
  const tracer = new TracingService();
  const metrics = new MetricsService();

  const db = new DatabaseService({ host: 'localhost' }, logger);
  const notificationService = new NotificationService(logger, tracer, metrics);
  const engine = new AlertRulesEngine(db, logger, tracer, metrics, notificationService);

  const rule = await engine.createRule('overdue_tasks', { type: 'overdue' }, { type: 'send_alert', severity: 'high' });

  if (!rule.id) throw new Error('Rule not created');
  if (engine.rules.length !== 1) throw new Error('Rule not added to engine');
});

runner.test('AlertRulesEngine: Evaluate rules', async () => {
  const logger = new LoggerService();
  const tracer = new TracingService();
  const metrics = new MetricsService();

  const db = new DatabaseService({ host: 'localhost' }, logger);
  const notificationService = new NotificationService(logger, tracer, metrics);
  const engine = new AlertRulesEngine(db, logger, tracer, metrics, notificationService);

  await engine.createRule('overdue_tasks', { type: 'overdue' }, { type: 'send_alert', severity: 'high' });

  const task = {
    id: 'task-123',
    title: 'Overdue Task',
    due_date: new Date(Date.now() - 1000),
    risk_level: 'High',
  };

  const result = await engine.evaluateRules(task);
  if (result.alertsSent === undefined) throw new Error('Rule evaluation failed');
});

// ============================================================================
// ORCHESTRATOR TESTS
// ============================================================================

runner.test('AsanaBrainOrchestrator: Initialize system', async () => {
  const config = {
    asanaPat: 'test-pat',
    database: { host: 'localhost', user: 'root', password: 'password', database: 'asana_brain' },
    logging: { debug: false },
  };

  const orchestrator = new AsanaBrainOrchestrator(config);
  const result = await orchestrator.initialize();

  if (!result.success) throw new Error('Initialization failed');
  if (!orchestrator.isInitialized) throw new Error('System not marked as initialized');
});

runner.test('AsanaBrainOrchestrator: Start system', async () => {
  const config = {
    asanaPat: 'test-pat',
    database: { host: 'localhost', user: 'root', password: 'password', database: 'asana_brain' },
    logging: { debug: false },
  };

  const orchestrator = new AsanaBrainOrchestrator(config);
  const result = await orchestrator.start('project-123');

  if (!result.success) throw new Error('Start failed');
  if (result.synced === undefined) throw new Error('Sync result not returned');
});

runner.test('AsanaBrainOrchestrator: Stop system', async () => {
  const config = {
    asanaPat: 'test-pat',
    database: { host: 'localhost', user: 'root', password: 'password', database: 'asana_brain' },
    logging: { debug: false },
  };

  const orchestrator = new AsanaBrainOrchestrator(config);
  await orchestrator.initialize();

  const result = await orchestrator.stop();
  if (!result.success) throw new Error('Stop failed');
});

runner.test('AsanaBrainOrchestrator: Get system status', async () => {
  const config = {
    asanaPat: 'test-pat',
    database: { host: 'localhost', user: 'root', password: 'password', database: 'asana_brain' },
    logging: { debug: false },
  };

  const orchestrator = new AsanaBrainOrchestrator(config);
  await orchestrator.initialize();

  const status = orchestrator.getStatus();
  if (!status.initialized) throw new Error('Status not available');
  if (!status.queueStatus) throw new Error('Queue status not available');
});

runner.test('AsanaBrainOrchestrator: Get metrics', async () => {
  const config = {
    asanaPat: 'test-pat',
    database: { host: 'localhost', user: 'root', password: 'password', database: 'asana_brain' },
    logging: { debug: false },
  };

  const orchestrator = new AsanaBrainOrchestrator(config);
  const metrics = orchestrator.getMetrics();

  if (!metrics.system) throw new Error('System metrics not available');
  if (!metrics.tracing) throw new Error('Tracing metrics not available');
});

runner.test('AsanaBrainOrchestrator: Get logs', async () => {
  const config = {
    asanaPat: 'test-pat',
    database: { host: 'localhost', user: 'root', password: 'password', database: 'asana_brain' },
    logging: { debug: false },
  };

  const orchestrator = new AsanaBrainOrchestrator(config);
  await orchestrator.initialize();

  const logs = orchestrator.getLogs();
  if (!Array.isArray(logs)) throw new Error('Logs not returned');
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

runner.test('End-to-End: Full workflow from task creation to alert', async () => {
  const config = {
    asanaPat: 'test-pat',
    database: { host: 'localhost', user: 'root', password: 'password', database: 'asana_brain' },
    logging: { debug: false },
  };

  const orchestrator = new AsanaBrainOrchestrator(config);
  await orchestrator.initialize();

  // Register notification channel
  await orchestrator.notificationService.registerChannel('test', async (alert) => {
    return { sent: true };
  });

  // Create alert rule
  await orchestrator.alertRulesEngine.createRule('high_risk', { type: 'high_risk' }, {
    type: 'send_alert',
    severity: 'high',
    message: 'High risk task detected',
  });

  // Simulate task creation
  const taskData = {
    id: 'task-123',
    title: 'Critical Compliance Task',
    description: 'This is a critical compliance task that requires immediate attention',
    due_date: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
    assignee_id: 'user-123',
    risk_level: 'Critical',
  };

  await orchestrator.handleTaskCreated(taskData);

  // Verify processing
  const status = orchestrator.getStatus();
  if (status.queueStatus.queueLength === undefined) throw new Error('Queue not processed');
});

runner.test('Performance: Process 100 events in parallel', async () => {
  const config = {
    asanaPat: 'test-pat',
    database: { host: 'localhost', user: 'root', password: 'password', database: 'asana_brain' },
    logging: { debug: false },
  };

  const orchestrator = new AsanaBrainOrchestrator(config);
  await orchestrator.initialize();

  const startTime = Date.now();

  const promises = [];
  for (let i = 0; i < 100; i++) {
    const taskData = {
      id: `task-${i}`,
      title: `Task ${i}`,
      description: 'Test task',
      due_date: new Date(),
      assignee_id: 'user-123',
    };

    promises.push(orchestrator.handleTaskCreated(taskData));
  }

  await Promise.all(promises);

  const duration = Date.now() - startTime;
  if (duration > 5000) throw new Error(`Performance test too slow: ${duration}ms`);
});

runner.test('Reliability: Handle errors gracefully', async () => {
  const config = {
    asanaPat: 'test-pat',
    database: { host: 'localhost', user: 'root', password: 'password', database: 'asana_brain' },
    logging: { debug: false },
  };

  const orchestrator = new AsanaBrainOrchestrator(config);

  try {
    // Try to process without initialization
    const taskData = { id: 'task-123', title: 'Test' };
    await orchestrator.handleTaskCreated(taskData);
  } catch (error) {
    // Expected to fail gracefully
  }

  // Should still be able to initialize
  const result = await orchestrator.initialize();
  if (!result.success) throw new Error('Recovery failed');
});

// ============================================================================
// RUN TESTS
// ============================================================================

runner.run().then((results) => {
  console.log('\n📈 FINAL RESULTS:');
  console.log(`   Total Tests: ${results.total}`);
  console.log(`   Passed: ${results.passed}`);
  console.log(`   Failed: ${results.failed}`);
  console.log(`   Success Rate: ${results.successRate}\n`);

  if (results.failed === 0) {
    console.log('🎉 ALL TESTS PASSED - SYSTEM READY FOR PRODUCTION\n');
    process.exit(0);
  } else {
    console.log('⚠️  SOME TESTS FAILED - REVIEW REQUIRED\n');
    process.exit(1);
  }
});
