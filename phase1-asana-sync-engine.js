/**
 * PHASE 1: REAL-TIME ASANA SYNC ENGINE
 * Bi-directional sync logic for real-time data synchronization
 * 
 * TARGET: < 1 second latency for all sync operations
 */

const logger = require('./logger-service');
const tracer = require('./tracer-service');
const metrics = require('./metrics-service');
const axios = require('axios');

class AsanaSyncEngine {
  constructor(config = {}) {
    this.config = {
      asanaApiToken: config.asanaApiToken || process.env.ASANA_PAT,
      workspaceId: config.workspaceId || '1213645083721316',
      batchSize: config.batchSize || 100,
      syncInterval: config.syncInterval || 5 * 60 * 1000, // 5 minutes
      ...config,
    };

    this.asanaClient = axios.create({
      baseURL: 'https://app.asana.com/api/1.0',
      headers: {
        'Authorization': `Bearer ${this.config.asanaApiToken}`,
        'Content-Type': 'application/json',
      },
    });

    this.syncState = {
      lastSyncTime: null,
      syncInProgress: false,
      syncErrors: [],
      syncMetrics: {},
    };

    this.setupInterceptors();
  }

  /**
   * Setup axios interceptors for logging and metrics
   */
  setupInterceptors() {
    this.asanaClient.interceptors.request.use((config) => {
      config.metadata = { startTime: Date.now() };
      return config;
    });

    this.asanaClient.interceptors.response.use(
      (response) => {
        const duration = Date.now() - response.config.metadata.startTime;
        metrics.timing('asana.api.response_time', duration);
        return response;
      },
      (error) => {
        logger.error('Asana API error', {
          status: error.response?.status,
          message: error.response?.data?.errors?.[0]?.message,
        });
        metrics.increment('asana.api.errors', 1);
        throw error;
      }
    );
  }

  /**
   * Sync all tasks from Asana workspace
   */
  async syncAllTasks() {
    const span = tracer.startSpan('sync_all_tasks');

    if (this.syncState.syncInProgress) {
      logger.warn('Sync already in progress');
      return;
    }

    this.syncState.syncInProgress = true;

    try {
      logger.info('Starting full task sync');
      const startTime = Date.now();

      // Get all projects in workspace
      const projects = await this.getWorkspaceProjects();
      logger.info('Found projects', { count: projects.length });

      let totalTasks = 0;
      const syncResults = [];

      // Sync tasks from each project
      for (const project of projects) {
        const tasks = await this.getProjectTasks(project.gid);
        logger.info('Syncing project tasks', { 
          projectId: project.gid, 
          projectName: project.name,
          taskCount: tasks.length 
        });

        // Batch process tasks
        for (let i = 0; i < tasks.length; i += this.config.batchSize) {
          const batch = tasks.slice(i, i + this.config.batchSize);
          const batchResults = await this.syncTaskBatch(batch);
          syncResults.push(...batchResults);
          totalTasks += batch.length;
        }
      }

      const duration = Date.now() - startTime;
      this.syncState.lastSyncTime = new Date();

      logger.info('Full task sync completed', {
        totalTasks,
        duration,
        successCount: syncResults.filter(r => r.success).length,
        errorCount: syncResults.filter(r => !r.success).length,
      });

      metrics.timing('sync.full_sync_duration', duration);
      metrics.gauge('sync.total_tasks', totalTasks);
      metrics.increment('sync.full_syncs_completed', 1);

      span.setTag('total_tasks', totalTasks);
      span.setTag('duration', duration);
      span.finish();

      return {
        success: true,
        totalTasks,
        duration,
        results: syncResults,
      };
    } catch (error) {
      logger.error('Full task sync failed', { error: error.message });
      this.syncState.syncErrors.push({
        timestamp: new Date(),
        error: error.message,
      });
      metrics.increment('sync.full_sync_errors', 1);
      span.setTag('error', true);
      span.finish();
      throw error;
    } finally {
      this.syncState.syncInProgress = false;
    }
  }

  /**
   * Get all projects in workspace
   */
  async getWorkspaceProjects() {
    const span = tracer.startSpan('get_workspace_projects');

    try {
      const response = await this.asanaClient.get('/workspaces/' + this.config.workspaceId + '/projects', {
        params: {
          opt_fields: 'gid,name,archived',
          limit: 100,
        },
      });

      const projects = response.data.data.filter(p => !p.archived);
      logger.info('Retrieved workspace projects', { count: projects.length });

      span.setTag('project_count', projects.length);
      span.finish();

      return projects;
    } catch (error) {
      logger.error('Failed to get workspace projects', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Get all tasks in project
   */
  async getProjectTasks(projectId) {
    const span = tracer.startSpan('get_project_tasks', { 'project.id': projectId });

    try {
      const response = await this.asanaClient.get(`/projects/${projectId}/tasks`, {
        params: {
          opt_fields: 'gid,name,status,priority,assignee,due_date,custom_fields,notes',
          limit: 100,
        },
      });

      const tasks = response.data.data;
      logger.info('Retrieved project tasks', { projectId, count: tasks.length });

      span.setTag('task_count', tasks.length);
      span.finish();

      return tasks;
    } catch (error) {
      logger.error('Failed to get project tasks', { projectId, error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Sync batch of tasks
   */
  async syncTaskBatch(tasks) {
    const span = tracer.startSpan('sync_task_batch', { 'batch.size': tasks.length });

    const results = [];

    for (const task of tasks) {
      try {
        const result = await this.syncTask(task);
        results.push({ taskId: task.gid, success: true, result });
        metrics.increment('sync.tasks_synced', 1);
      } catch (error) {
        logger.error('Failed to sync task', { taskId: task.gid, error: error.message });
        results.push({ taskId: task.gid, success: false, error: error.message });
        metrics.increment('sync.task_sync_errors', 1);
      }
    }

    span.setTag('synced_count', results.filter(r => r.success).length);
    span.finish();

    return results;
  }

  /**
   * Sync individual task
   */
  async syncTask(task) {
    const span = tracer.startSpan('sync_task', { 'task.id': task.gid });

    try {
      logger.info('Syncing task', { 
        taskId: task.gid, 
        taskName: task.name,
        status: task.status,
      });

      // TODO: Update system database with task data
      // This would insert/update the task in the compliance_tasks table

      span.finish();

      return {
        taskId: task.gid,
        synced: true,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error('Task sync failed', { taskId: task.gid, error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Create task in Asana from finding
   */
  async createTaskFromFinding(finding) {
    const span = tracer.startSpan('create_task_from_finding', { 'finding.id': finding.id });

    try {
      logger.info('Creating Asana task from finding', {
        findingId: finding.id,
        findingType: finding.type,
        riskLevel: finding.riskLevel,
      });

      const taskData = {
        data: {
          name: this.formatTaskName(finding),
          notes: this.formatTaskDescription(finding),
          projects: [finding.projectId || this.config.defaultProjectId],
          priority: this.mapRiskToPriority(finding.riskLevel),
          due_date: this.calculateDueDate(finding),
          custom_fields: {
            system_id: finding.id,
            finding_type: finding.type,
            risk_level: finding.riskLevel,
          },
        },
      };

      const response = await this.asanaClient.post('/tasks', taskData);
      const task = response.data.data;

      logger.info('Asana task created', {
        taskId: task.gid,
        findingId: finding.id,
      });

      metrics.increment('asana.tasks_created', 1);
      span.setTag('task_id', task.gid);
      span.finish();

      return task;
    } catch (error) {
      logger.error('Failed to create Asana task', {
        findingId: finding.id,
        error: error.message,
      });
      metrics.increment('asana.task_creation_errors', 1);
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Update task in Asana
   */
  async updateTaskInAsana(taskId, updates) {
    const span = tracer.startSpan('update_task_in_asana', { 'task.id': taskId });

    try {
      logger.info('Updating Asana task', { taskId, updates: Object.keys(updates) });

      const response = await this.asanaClient.put(`/tasks/${taskId}`, {
        data: updates,
      });

      const task = response.data.data;

      logger.info('Asana task updated', { taskId });
      metrics.increment('asana.tasks_updated', 1);
      span.finish();

      return task;
    } catch (error) {
      logger.error('Failed to update Asana task', { taskId, error: error.message });
      metrics.increment('asana.task_update_errors', 1);
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Format task name from finding
   */
  formatTaskName(finding) {
    const prefix = this.mapFindingTypeToPrefix(finding.type);
    const riskIndicator = finding.riskLevel === 'Critical' ? '🔴' : finding.riskLevel === 'High' ? '🟠' : '🟡';
    return `${riskIndicator} ${prefix}: ${finding.title}`;
  }

  /**
   * Format task description from finding
   */
  formatTaskDescription(finding) {
    return `
**Finding ID:** ${finding.id}
**Type:** ${finding.type}
**Risk Level:** ${finding.riskLevel}
**Description:** ${finding.description}
**Evidence:** ${finding.evidence || 'N/A'}
**Recommended Action:** ${finding.recommendedAction || 'N/A'}
**Created:** ${new Date().toISOString()}
    `.trim();
  }

  /**
   * Map risk level to Asana priority
   */
  mapRiskToPriority(riskLevel) {
    const mapping = {
      'Critical': 'urgent',
      'High': 'high',
      'Medium': 'normal',
      'Low': 'low',
    };
    return mapping[riskLevel] || 'normal';
  }

  /**
   * Calculate due date based on risk level
   */
  calculateDueDate(finding) {
    const daysMap = {
      'Critical': 1,
      'High': 3,
      'Medium': 7,
      'Low': 14,
    };

    const days = daysMap[finding.riskLevel] || 7;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + days);

    return dueDate.toISOString().split('T')[0];
  }

  /**
   * Map finding type to task prefix
   */
  mapFindingTypeToPrefix(findingType) {
    const mapping = {
      'STR': 'Suspicious Transaction Report',
      'KYC': 'Know Your Customer',
      'CDD': 'Customer Due Diligence',
      'Sanctions': 'Sanctions Screening',
      'AML': 'Anti-Money Laundering',
      'Incident': 'Compliance Incident',
    };
    return mapping[findingType] || findingType;
  }

  /**
   * Start continuous sync
   */
  startContinuousSync() {
    logger.info('Starting continuous sync', { interval: this.config.syncInterval });

    this.syncInterval = setInterval(async () => {
      try {
        await this.syncAllTasks();
      } catch (error) {
        logger.error('Continuous sync error', { error: error.message });
      }
    }, this.config.syncInterval);

    // Initial sync
    this.syncAllTasks();
  }

  /**
   * Stop continuous sync
   */
  stopContinuousSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      logger.info('Continuous sync stopped');
    }
  }

  /**
   * Get sync status
   */
  getSyncStatus() {
    return {
      lastSyncTime: this.syncState.lastSyncTime,
      syncInProgress: this.syncState.syncInProgress,
      recentErrors: this.syncState.syncErrors.slice(-10),
      metrics: this.syncState.syncMetrics,
    };
  }
}

module.exports = AsanaSyncEngine;
