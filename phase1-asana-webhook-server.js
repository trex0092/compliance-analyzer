/**
 * PHASE 1: REAL-TIME ASANA SYNC ENGINE
 * Asana Webhook Server - Receives and processes real-time Asana events
 * 
 * TARGET IMPROVEMENT: 90% latency reduction
 * EXPECTED OUTCOME: Real-time bi-directional sync with < 1 second latency
 */

const express = require('express');
const crypto = require('crypto');
const logger = require('./logger-service');
const tracer = require('./tracer-service');
const metrics = require('./metrics-service');

class AsanaWebhookServer {
  constructor(config = {}) {
    this.app = express();
    this.config = {
      port: config.port || 3002,
      webhookSecret: config.webhookSecret || process.env.ASANA_WEBHOOK_SECRET,
      asanaApiToken: config.asanaApiToken || process.env.ASANA_PAT,
      workspaceId: config.workspaceId || '1213645083721316',
      ...config,
    };

    this.eventHandlers = {};
    this.eventQueue = [];
    this.setupMiddleware();
    this.setupRoutes();
    this.setupEventHandlers();
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(this.requestLogger.bind(this));
    this.app.use(this.errorHandler.bind(this));
  }

  /**
   * Request logger middleware
   */
  requestLogger(req, res, next) {
    const span = tracer.startSpan('http_request', {
      'http.method': req.method,
      'http.url': req.url,
    });

    logger.info('Incoming request', {
      method: req.method,
      url: req.url,
      headers: req.headers,
    });

    res.on('finish', () => {
      span.setTag('http.status_code', res.statusCode);
      logger.info('Request completed', {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
      });
      span.finish();
    });

    next();
  }

  /**
   * Error handler middleware
   */
  errorHandler(err, req, res, next) {
    logger.error('Request error', { error: err.message, stack: err.stack });
    metrics.increment('http.errors', 1);
    res.status(500).json({ error: 'Internal server error' });
  }

  /**
   * Setup Express routes
   */
  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    });

    // Webhook endpoint
    this.app.post('/webhook/asana', this.handleWebhook.bind(this));

    // Webhook verification endpoint (Asana requires this)
    this.app.post('/webhook/asana/verify', this.handleWebhookVerification.bind(this));

    // Status endpoint
    this.app.get('/status', (req, res) => {
      res.json({
        status: 'running',
        eventsProcessed: metrics.getMetric('webhook.events_processed'),
        eventQueueSize: this.eventQueue.length,
        lastEventTime: metrics.getMetric('webhook.last_event_time'),
      });
    });
  }

  /**
   * Handle Asana webhook verification
   */
  handleWebhookVerification(req, res) {
    logger.info('Webhook verification request received');

    // Asana sends a challenge parameter during verification
    const challenge = req.body.challenge;

    if (!challenge) {
      logger.error('No challenge in verification request');
      return res.status(400).json({ error: 'No challenge provided' });
    }

    // Return the challenge to verify
    res.json({ data: { challenge } });
    logger.info('Webhook verification successful');
  }

  /**
   * Handle incoming Asana webhook
   */
  async handleWebhook(req, res) {
    const span = tracer.startSpan('asana_webhook_received');

    try {
      // Verify webhook signature
      if (!this.verifyWebhookSignature(req)) {
        logger.error('Webhook signature verification failed');
        metrics.increment('webhook.verification_failed', 1);
        span.setTag('error', true);
        span.finish();
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const events = req.body.events || [];
      logger.info('Webhook received', { eventCount: events.length });
      metrics.increment('webhook.received', 1);

      // Queue events for processing
      for (const event of events) {
        this.eventQueue.push(event);
        metrics.increment('webhook.events_queued', 1);
      }

      // Process events asynchronously
      this.processEventQueue();

      // Return 200 OK immediately (Asana expects fast response)
      res.json({ data: { success: true } });
      span.setTag('events_queued', events.length);
      span.finish();
    } catch (error) {
      logger.error('Webhook processing error', { error: error.message });
      metrics.increment('webhook.processing_errors', 1);
      span.setTag('error', true);
      span.finish();
      res.status(500).json({ error: 'Processing failed' });
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(req) {
    const signature = req.headers['x-hook-signature'];
    if (!signature) {
      logger.warn('No webhook signature in request');
      return false;
    }

    const body = JSON.stringify(req.body);
    const hash = crypto
      .createHmac('sha256', this.config.webhookSecret)
      .update(body)
      .digest('hex');

    const isValid = signature === hash;
    if (!isValid) {
      logger.error('Webhook signature mismatch', { provided: signature, calculated: hash });
    }

    return isValid;
  }

  /**
   * Process event queue
   */
  async processEventQueue() {
    const span = tracer.startSpan('process_event_queue');

    while (this.eventQueue.length > 0) {
      const event = this.eventQueue.shift();

      try {
        await this.processEvent(event);
        metrics.increment('webhook.events_processed', 1);
        metrics.gauge('webhook.queue_size', this.eventQueue.length);
      } catch (error) {
        logger.error('Event processing failed', { 
          error: error.message, 
          event: event.resource?.gid 
        });
        metrics.increment('webhook.event_processing_errors', 1);
        
        // Re-queue failed event for retry
        this.eventQueue.push(event);
      }
    }

    span.finish();
  }

  /**
   * Process individual event
   */
  async processEvent(event) {
    const span = tracer.startSpan('process_event', {
      'event.type': event.type,
      'event.action': event.action,
      'resource.type': event.resource?.resource_type,
    });

    logger.info('Processing event', {
      type: event.type,
      action: event.action,
      resourceType: event.resource?.resource_type,
      resourceId: event.resource?.gid,
    });

    try {
      // Route event to appropriate handler
      const handler = this.eventHandlers[event.type];
      if (handler) {
        await handler.call(this, event);
        span.setTag('handled', true);
      } else {
        logger.warn('No handler for event type', { type: event.type });
        span.setTag('handled', false);
      }

      metrics.timing('webhook.event_processing_time', Date.now());
      span.finish();
    } catch (error) {
      logger.error('Event processing error', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    // Task created event
    this.eventHandlers['resource'] = async (event) => {
      if (event.resource?.resource_type === 'task' && event.action === 'added') {
        await this.handleTaskCreated(event);
      }
    };

    // Task updated event
    this.eventHandlers['resource'] = async (event) => {
      if (event.resource?.resource_type === 'task' && event.action === 'changed') {
        await this.handleTaskUpdated(event);
      }
    };

    // Task deleted event
    this.eventHandlers['resource'] = async (event) => {
      if (event.resource?.resource_type === 'task' && event.action === 'removed') {
        await this.handleTaskDeleted(event);
      }
    };
  }

  /**
   * Handle task created event
   */
  async handleTaskCreated(event) {
    const span = tracer.startSpan('handle_task_created');
    const task = event.resource;

    logger.info('Task created in Asana', {
      taskId: task.gid,
      taskName: task.name,
      projectId: task.projects?.[0]?.gid,
    });

    try {
      // Link task to system finding if applicable
      if (task.custom_fields?.system_id) {
        await this.linkTaskToFinding(task);
      }

      // Update system state
      await this.updateSystemState(task, 'created');

      // Trigger downstream actions
      await this.triggerDownstreamActions(task);

      metrics.increment('task.created', 1);
      span.finish();
    } catch (error) {
      logger.error('Error handling task creation', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Handle task updated event
   */
  async handleTaskUpdated(event) {
    const span = tracer.startSpan('handle_task_updated');
    const task = event.resource;
    const changes = event.changes || {};

    logger.info('Task updated in Asana', {
      taskId: task.gid,
      changes: Object.keys(changes),
    });

    try {
      // Handle status change
      if (changes.status) {
        await this.handleStatusChange(task, changes.status);
      }

      // Handle priority change
      if (changes.priority_level) {
        await this.handlePriorityChange(task, changes.priority_level);
      }

      // Handle assignee change
      if (changes.assignee) {
        await this.handleAssigneeChange(task, changes.assignee);
      }

      // Handle due date change
      if (changes.due_date) {
        await this.handleDueDateChange(task, changes.due_date);
      }

      // Update system state
      await this.updateSystemState(task, 'updated');

      metrics.increment('task.updated', 1);
      span.finish();
    } catch (error) {
      logger.error('Error handling task update', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Handle task deleted event
   */
  async handleTaskDeleted(event) {
    const span = tracer.startSpan('handle_task_deleted');
    const task = event.resource;

    logger.info('Task deleted in Asana', { taskId: task.gid });

    try {
      // Mark finding as deleted
      if (task.custom_fields?.system_id) {
        await this.deleteFinding(task);
      }

      // Update system state
      await this.updateSystemState(task, 'deleted');

      metrics.increment('task.deleted', 1);
      span.finish();
    } catch (error) {
      logger.error('Error handling task deletion', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Handle status change
   */
  async handleStatusChange(task, statusChange) {
    const oldStatus = statusChange.old_value;
    const newStatus = statusChange.new_value;

    logger.info('Task status changed', {
      taskId: task.gid,
      oldStatus,
      newStatus,
    });

    // Update finding status
    if (task.custom_fields?.system_id) {
      await this.updateFindingStatus(task, newStatus);
    }

    // Handle escalation
    if (this.isOverdue(task) && newStatus !== 'completed') {
      await this.escalateTask(task);
    }

    // Update reports
    await this.updateReports(task, newStatus);

    metrics.increment('task.status_changed', 1);
  }

  /**
   * Handle priority change
   */
  async handlePriorityChange(task, priorityChange) {
    logger.info('Task priority changed', {
      taskId: task.gid,
      oldPriority: priorityChange.old_value,
      newPriority: priorityChange.new_value,
    });

    metrics.increment('task.priority_changed', 1);
  }

  /**
   * Handle assignee change
   */
  async handleAssigneeChange(task, assigneeChange) {
    logger.info('Task assignee changed', {
      taskId: task.gid,
      oldAssignee: assigneeChange.old_value?.name,
      newAssignee: assigneeChange.new_value?.name,
    });

    metrics.increment('task.assignee_changed', 1);
  }

  /**
   * Handle due date change
   */
  async handleDueDateChange(task, dueDateChange) {
    logger.info('Task due date changed', {
      taskId: task.gid,
      oldDueDate: dueDateChange.old_value,
      newDueDate: dueDateChange.new_value,
    });

    metrics.increment('task.due_date_changed', 1);
  }

  /**
   * Link task to system finding
   */
  async linkTaskToFinding(task) {
    logger.info('Linking task to finding', {
      taskId: task.gid,
      systemId: task.custom_fields.system_id,
    });

    // TODO: Implement finding linking logic
    // This would update the finding record with Asana task reference
  }

  /**
   * Update system state
   */
  async updateSystemState(task, action) {
    logger.info('Updating system state', {
      taskId: task.gid,
      action,
    });

    // TODO: Implement system state update logic
    // This would sync Asana task data to system database
  }

  /**
   * Trigger downstream actions
   */
  async triggerDownstreamActions(task) {
    logger.info('Triggering downstream actions', { taskId: task.gid });

    // If task is high-risk, trigger additional monitoring
    if (task.custom_fields?.risk_level === 'Critical') {
      logger.info('Enabling enhanced monitoring', { taskId: task.gid });
      // TODO: Trigger enhanced monitoring
    }

    // If task is sanctions-related, trigger screening
    if (task.custom_fields?.finding_type === 'Sanctions Match') {
      logger.info('Triggering sanctions screening', { taskId: task.gid });
      // TODO: Trigger sanctions screening
    }

    // If task is incident, trigger investigation
    if (task.custom_fields?.finding_type === 'Incident') {
      logger.info('Starting incident investigation', { taskId: task.gid });
      // TODO: Start incident investigation
    }
  }

  /**
   * Update finding status
   */
  async updateFindingStatus(task, newStatus) {
    logger.info('Updating finding status', {
      taskId: task.gid,
      newStatus,
    });

    // TODO: Implement finding status update logic
  }

  /**
   * Escalate task
   */
  async escalateTask(task) {
    logger.info('Escalating task', { taskId: task.gid });

    // TODO: Implement task escalation logic
  }

  /**
   * Update reports
   */
  async updateReports(task, newStatus) {
    logger.info('Updating reports', {
      taskId: task.gid,
      newStatus,
    });

    // TODO: Implement report update logic
  }

  /**
   * Delete finding
   */
  async deleteFinding(task) {
    logger.info('Deleting finding', { taskId: task.gid });

    // TODO: Implement finding deletion logic
  }

  /**
   * Check if task is overdue
   */
  isOverdue(task) {
    if (!task.due_date) return false;
    return new Date(task.due_date) < new Date();
  }

  /**
   * Start server
   */
  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, () => {
        logger.info('Asana Webhook Server started', { port: this.config.port });
        console.log(`\n✅ Asana Webhook Server running on port ${this.config.port}`);
        console.log(`   Webhook URL: http://localhost:${this.config.port}/webhook/asana`);
        console.log(`   Health check: http://localhost:${this.config.port}/health\n`);
        resolve(this.server);
      });
    });
  }

  /**
   * Stop server
   */
  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Asana Webhook Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = AsanaWebhookServer;
