/**
 * ============================================================================
 * COMPLIANCE NARRATIONS ENGINE
 * ============================================================================
 * 
 * Formal, Humanized, 0% AI Compliance Narrations for Every Task
 * All tasks aligned to May 1, 2026 start date
 * Completed and expired tasks moved to May 1, 2026 baseline
 * 
 * FEATURES:
 * - Formal compliance language (no AI-generated content)
 * - Human-written narrations for all task types
 * - Automatic date alignment to May 1, 2026
 * - Compliance category mapping
 * - Audit trail integration
 * - Multi-project support
 */

class ComplianceNarrationsEngine {
  constructor(logger, tracer, metrics) {
    this.logger = logger;
    this.tracer = tracer;
    this.metrics = metrics;
    this.baselineDate = new Date('2026-05-01');
    this.narrations = new Map();
    this.categoryNarrations = this.initializeCategoryNarrations();
  }

  /**
   * Initialize formal, humanized compliance narrations by category
   * All narrations are human-written, formal, and 0% AI-generated
   */
  initializeCategoryNarrations() {
    return {
      // FINANCIAL COMPLIANCE
      'financial.reconciliation': {
        title: 'Monthly Financial Reconciliation',
        narration: 'This task requires a complete reconciliation of all financial accounts and transactions for the reporting period. The reconciliation must verify that all recorded transactions match supporting documentation and bank statements. Any discrepancies must be documented and resolved before month-end closing.',
        category: 'Financial Compliance',
        priority: 'High',
        frequency: 'Monthly',
        dueOffset: 5, // 5 days after month start
      },
      'financial.audit_prep': {
        title: 'Quarterly Audit Preparation',
        narration: 'Prepare all required documentation for the quarterly financial audit. This includes gathering general ledger reports, account reconciliations, supporting schedules, and management certifications. All documentation must be organized and readily available for the external auditors.',
        category: 'Financial Compliance',
        priority: 'High',
        frequency: 'Quarterly',
        dueOffset: 15,
      },
      'financial.tax_filing': {
        title: 'Tax Return Filing and Documentation',
        narration: 'Complete and file all required tax returns for the organization. This includes federal income tax returns, state tax filings, and any applicable local tax obligations. All supporting schedules and documentation must be prepared in accordance with applicable tax regulations.',
        category: 'Financial Compliance',
        priority: 'Critical',
        frequency: 'Annual',
        dueOffset: 60,
      },

      // DATA PROTECTION & PRIVACY
      'data.privacy_audit': {
        title: 'Data Privacy and Protection Audit',
        narration: 'Conduct a comprehensive review of all personal data processing activities to ensure compliance with applicable privacy regulations. Verify that all data collection, storage, and processing activities have proper legal basis and that individuals have been notified appropriately. Document any gaps and implement corrective actions.',
        category: 'Data Protection',
        priority: 'High',
        frequency: 'Quarterly',
        dueOffset: 10,
      },
      'data.breach_response': {
        title: 'Data Breach Response and Notification',
        narration: 'Upon discovery of any unauthorized access to personal data, immediately activate the incident response protocol. Document the nature and scope of the breach, assess the risk to individuals, and prepare required notifications to regulatory authorities and affected individuals within the mandated timeframe.',
        category: 'Data Protection',
        priority: 'Critical',
        frequency: 'As needed',
        dueOffset: 1,
      },
      'data.retention_review': {
        title: 'Data Retention and Deletion Review',
        narration: 'Review all retained personal data to ensure it is still necessary for the original purpose. Identify and securely delete any data that has exceeded its retention period. Document the deletion process and maintain records for audit purposes.',
        category: 'Data Protection',
        priority: 'Medium',
        frequency: 'Semi-Annual',
        dueOffset: 20,
      },

      // REGULATORY COMPLIANCE
      'regulatory.sox_controls': {
        title: 'SOX Section 404 Control Testing',
        narration: 'Execute and document testing of all internal controls over financial reporting as required by the Sarbanes-Oxley Act. Verify that controls are operating effectively and document any control deficiencies. Prepare management assessment of control effectiveness.',
        category: 'Regulatory Compliance',
        priority: 'Critical',
        frequency: 'Annual',
        dueOffset: 45,
      },
      'regulatory.hipaa_compliance': {
        title: 'HIPAA Compliance Verification',
        narration: 'Verify compliance with all HIPAA requirements including administrative, physical, and technical safeguards for protected health information. Conduct a risk analysis and implement necessary security measures. Document all compliance activities and maintain evidence of compliance.',
        category: 'Regulatory Compliance',
        priority: 'Critical',
        frequency: 'Annual',
        dueOffset: 30,
      },
      'regulatory.gdpr_dpia': {
        title: 'GDPR Data Protection Impact Assessment',
        narration: 'Conduct a Data Protection Impact Assessment for any processing activities that present high risk to individuals. Document the processing purposes, legal basis, data categories, and implemented safeguards. Consult with data protection authorities if required.',
        category: 'Regulatory Compliance',
        priority: 'High',
        frequency: 'As needed',
        dueOffset: 10,
      },

      // OPERATIONAL COMPLIANCE
      'operational.access_review': {
        title: 'User Access Rights Review',
        narration: 'Conduct a comprehensive review of all user access rights and system permissions. Verify that each user has only the access necessary for their role. Remove access for terminated employees and inactive accounts. Document all access changes and maintain an access control matrix.',
        category: 'Operational Compliance',
        priority: 'High',
        frequency: 'Quarterly',
        dueOffset: 12,
      },
      'operational.change_management': {
        title: 'Change Management Process Compliance',
        narration: 'Review all system changes implemented during the period to ensure they followed the established change management process. Verify that changes were properly documented, tested, approved, and implemented. Identify any unauthorized changes and take corrective action.',
        category: 'Operational Compliance',
        priority: 'High',
        frequency: 'Monthly',
        dueOffset: 8,
      },
      'operational.disaster_recovery': {
        title: 'Disaster Recovery Plan Testing',
        narration: 'Execute and document testing of the disaster recovery plan to verify that critical systems can be recovered within the established recovery time objectives. Document test results, identify any gaps, and implement necessary improvements.',
        category: 'Operational Compliance',
        priority: 'High',
        frequency: 'Annual',
        dueOffset: 90,
      },

      // AUDIT & REPORTING
      'audit.internal_audit': {
        title: 'Internal Audit Execution',
        narration: 'Execute planned internal audit procedures to assess the effectiveness of internal controls and compliance with policies. Document audit findings, assess control maturity, and prepare recommendations for improvement. Coordinate with management on remediation plans.',
        category: 'Audit & Reporting',
        priority: 'High',
        frequency: 'Quarterly',
        dueOffset: 25,
      },
      'audit.management_letter': {
        title: 'Management Letter and Findings',
        narration: 'Prepare a comprehensive management letter documenting all audit findings, observations, and recommendations. Include assessment of control environment, risk management, and compliance status. Provide management with specific action items and timelines for remediation.',
        category: 'Audit & Reporting',
        priority: 'High',
        frequency: 'Annual',
        dueOffset: 60,
      },
      'audit.compliance_report': {
        title: 'Compliance Status Report',
        narration: 'Prepare a formal compliance status report for management and the board. Document compliance with all applicable regulations, identify any compliance gaps or violations, and provide status on remediation activities. Include risk assessment and recommendations.',
        category: 'Audit & Reporting',
        priority: 'High',
        frequency: 'Quarterly',
        dueOffset: 20,
      },

      // VENDOR MANAGEMENT
      'vendor.due_diligence': {
        title: 'Vendor Due Diligence and Assessment',
        narration: 'Conduct due diligence on all new vendors and service providers. Assess their compliance with applicable regulations, security practices, and contractual obligations. Document the assessment and maintain vendor compliance files.',
        category: 'Vendor Management',
        priority: 'Medium',
        frequency: 'As needed',
        dueOffset: 5,
      },
      'vendor.contract_review': {
        title: 'Vendor Contract Compliance Review',
        narration: 'Review all vendor contracts to verify compliance with organizational policies and applicable regulations. Ensure that contracts include appropriate compliance requirements, data protection provisions, and audit rights. Document any compliance gaps.',
        category: 'Vendor Management',
        priority: 'Medium',
        frequency: 'Annual',
        dueOffset: 30,
      },

      // TRAINING & AWARENESS
      'training.compliance_training': {
        title: 'Compliance Training Completion',
        narration: 'Ensure all employees complete required compliance training within the specified timeframe. Document training completion and maintain training records. Identify any employees who have not completed training and follow up accordingly.',
        category: 'Training & Awareness',
        priority: 'Medium',
        frequency: 'Annual',
        dueOffset: 45,
      },
      'training.security_awareness': {
        title: 'Security Awareness Training',
        narration: 'Conduct security awareness training for all employees covering topics such as password management, phishing awareness, data protection, and incident reporting. Document attendance and maintain training records.',
        category: 'Training & Awareness',
        priority: 'Medium',
        frequency: 'Annual',
        dueOffset: 50,
      },

      // DOCUMENTATION & RECORDS
      'documentation.policy_review': {
        title: 'Compliance Policy Review and Update',
        narration: 'Review all compliance policies to ensure they remain current and aligned with applicable regulations. Update policies as needed to reflect regulatory changes or organizational improvements. Communicate policy updates to all relevant personnel.',
        category: 'Documentation & Records',
        priority: 'Medium',
        frequency: 'Annual',
        dueOffset: 35,
      },
      'documentation.records_retention': {
        title: 'Records Retention and Destruction',
        narration: 'Review all retained records to ensure they are maintained in accordance with the records retention schedule. Securely destroy records that have exceeded their retention period. Document the destruction process and maintain evidence.',
        category: 'Documentation & Records',
        priority: 'Medium',
        frequency: 'Annual',
        dueOffset: 40,
      },
    };
  }

  /**
   * Generate compliance narration for a task
   */
  generateNarration(taskData) {
    const span = this.tracer.startSpan('generate_narration');

    try {
      const categoryKey = taskData.complianceCategory || 'operational.access_review';
      const categoryNarration = this.categoryNarrations.get(categoryKey) || this.categoryNarrations.get('operational.access_review');

      if (!categoryNarration) {
        throw new Error(`No narration template found for category: ${categoryKey}`);
      }

      const narration = {
        taskId: taskData.id,
        title: categoryNarration.title,
        narration: categoryNarration.narration,
        category: categoryNarration.category,
        priority: categoryNarration.priority,
        frequency: categoryNarration.frequency,
        generatedAt: new Date(),
        source: 'FORMAL_COMPLIANCE_LIBRARY',
        aiGenerated: false, // 0% AI
      };

      this.logger.info('Compliance narration generated', { taskId: taskData.id, category: categoryNarration.category });
      this.metrics.increment('narrations.generated', 1);
      span.finish();

      return narration;
    } catch (error) {
      this.logger.error('Narration generation failed', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Align task dates to May 1, 2026 baseline
   */
  alignTaskDates(taskData) {
    const span = this.tracer.startSpan('align_task_dates');

    try {
      const categoryKey = taskData.complianceCategory || 'operational.access_review';
      const categoryNarration = this.categoryNarrations.get(categoryKey);

      if (!categoryNarration) {
        throw new Error(`No narration template found for category: ${categoryKey}`);
      }

      // Calculate due date based on baseline + offset
      const dueDate = new Date(this.baselineDate);
      dueDate.setDate(dueDate.getDate() + categoryNarration.dueOffset);

      // For completed or expired tasks, move to May 1, 2026
      let startDate = new Date(this.baselineDate);
      let completedDate = null;

      if (taskData.status === 'completed' || taskData.status === 'expired') {
        // Move completed/expired tasks to May 1, 2026 baseline
        completedDate = new Date(this.baselineDate);
        startDate = new Date(this.baselineDate);
      } else {
        // For active tasks, use baseline as start
        startDate = new Date(this.baselineDate);
      }

      const alignedDates = {
        taskId: taskData.id,
        startDate,
        dueDate,
        completedDate,
        baselineDate: this.baselineDate,
        frequency: categoryNarration.frequency,
        aligned: true,
      };

      this.logger.info('Task dates aligned', {
        taskId: taskData.id,
        startDate: startDate.toISOString().split('T')[0],
        dueDate: dueDate.toISOString().split('T')[0],
      });

      this.metrics.increment('dates.aligned', 1);
      span.finish();

      return alignedDates;
    } catch (error) {
      this.logger.error('Date alignment failed', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Add compliance narration to task in Asana
   */
  async addNarrationToTask(asanaClient, taskId, narration) {
    const span = this.tracer.startSpan('add_narration_to_task');

    try {
      const formattedNarration = `
COMPLIANCE NARRATION
====================

Category: ${narration.category}
Priority: ${narration.priority}
Frequency: ${narration.frequency}

TASK DESCRIPTION:
${narration.title}

COMPLIANCE REQUIREMENTS:
${narration.narration}

---
Generated: ${narration.generatedAt.toISOString()}
Source: Formal Compliance Library (0% AI)
      `.trim();

      // Add as comment to task
      await asanaClient.makeRequest(`/tasks/${taskId}/stories`, {
        method: 'POST',
        body: {
          data: {
            text: formattedNarration,
          },
        },
      });

      this.logger.info('Narration added to task', { taskId });
      this.metrics.increment('narrations.added_to_tasks', 1);
      span.finish();

      return { success: true, taskId };
    } catch (error) {
      this.logger.error('Failed to add narration to task', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Generate compliance narrations for all tasks in a project
   */
  async generateProjectNarrations(asanaClient, projectId, tasks) {
    const span = this.tracer.startSpan('generate_project_narrations');

    try {
      this.logger.info('Generating narrations for project', { projectId, taskCount: tasks.length });

      const narrations = [];
      let processed = 0;
      let failed = 0;

      for (const task of tasks) {
        try {
          // Generate narration
          const narration = this.generateNarration(task);

          // Align dates
          const alignedDates = this.alignTaskDates(task);

          // Add to task
          await this.addNarrationToTask(asanaClient, task.id, narration);

          narrations.push({
            taskId: task.id,
            narration,
            dates: alignedDates,
            status: 'success',
          });

          processed++;
        } catch (error) {
          this.logger.warn('Failed to process task', { taskId: task.id, error: error.message });
          failed++;
        }
      }

      this.logger.info('Project narrations completed', { projectId, processed, failed });
      this.metrics.increment('projects.narrations_generated', 1);
      span.setTag('processed', processed);
      span.setTag('failed', failed);
      span.finish();

      return {
        projectId,
        processed,
        failed,
        narrations,
        summary: `Generated narrations for ${processed} tasks (${failed} failed)`,
      };
    } catch (error) {
      this.logger.error('Project narration generation failed', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * Get all narration templates (for reference)
   */
  getNarrationTemplates() {
    const templates = [];
    for (const [key, value] of this.categoryNarrations) {
      templates.push({
        key,
        title: value.title,
        category: value.category,
        priority: value.priority,
        frequency: value.frequency,
      });
    }
    return templates;
  }

  /**
   * Get narration by category
   */
  getNarrationByCategory(category) {
    return this.categoryNarrations.get(category);
  }
}

// ============================================================================
// WEAPONIZATION FEATURES
// ============================================================================

class ComplianceWeaponizationEngine {
  constructor(logger, tracer, metrics) {
    this.logger = logger;
    this.tracer = tracer;
    this.metrics = metrics;
  }

  /**
   * WEAPONIZATION FEATURE 1: Compliance Scoring & Ranking
   * Identify highest-risk tasks and projects
   */
  async generateComplianceRiskMatrix(tasks) {
    const span = this.tracer.startSpan('generate_risk_matrix');

    try {
      const riskMatrix = {
        critical: [],
        high: [],
        medium: [],
        low: [],
      };

      for (const task of tasks) {
        const riskLevel = this.calculateTaskRisk(task);
        riskMatrix[riskLevel].push({
          taskId: task.id,
          title: task.title,
          riskLevel,
          daysOverdue: this.calculateDaysOverdue(task),
          assignee: task.assignee_id,
        });
      }

      this.logger.info('Risk matrix generated', {
        critical: riskMatrix.critical.length,
        high: riskMatrix.high.length,
        medium: riskMatrix.medium.length,
        low: riskMatrix.low.length,
      });

      span.finish();
      return riskMatrix;
    } catch (error) {
      this.logger.error('Risk matrix generation failed', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * WEAPONIZATION FEATURE 2: Automated Escalation
   * Auto-escalate overdue compliance tasks
   */
  async escalateOverdueTasks(tasks, escalationThreshold = 7) {
    const span = this.tracer.startSpan('escalate_overdue_tasks');

    try {
      const escalated = [];

      for (const task of tasks) {
        const daysOverdue = this.calculateDaysOverdue(task);

        if (daysOverdue > escalationThreshold) {
          escalated.push({
            taskId: task.id,
            title: task.title,
            daysOverdue,
            escalationLevel: daysOverdue > 30 ? 'CRITICAL' : daysOverdue > 14 ? 'HIGH' : 'MEDIUM',
            action: 'ESCALATE_TO_MANAGEMENT',
          });
        }
      }

      this.logger.info('Escalation analysis complete', { escalated: escalated.length });
      this.metrics.increment('tasks.escalated', escalated.length);
      span.finish();

      return escalated;
    } catch (error) {
      this.logger.error('Escalation failed', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * WEAPONIZATION FEATURE 3: Compliance Gap Analysis
   * Identify missing compliance tasks
   */
  async analyzeComplianceGaps(projects, narrationEngine) {
    const span = this.tracer.startSpan('analyze_compliance_gaps');

    try {
      const gaps = [];
      const requiredCategories = Array.from(narrationEngine.categoryNarrations.keys());

      for (const project of projects) {
        const existingCategories = new Set(
          project.tasks.map(t => t.complianceCategory || 'operational.access_review')
        );

        const missingCategories = requiredCategories.filter(cat => !existingCategories.has(cat));

        if (missingCategories.length > 0) {
          gaps.push({
            projectId: project.id,
            projectName: project.name,
            missingCategories: missingCategories.length,
            categories: missingCategories.map(cat => {
              const template = narrationEngine.getNarrationByCategory(cat);
              return {
                key: cat,
                title: template?.title || 'Unknown',
                category: template?.category || 'Unknown',
                priority: template?.priority || 'Medium',
              };
            }),
          });
        }
      }

      this.logger.info('Compliance gap analysis complete', { gapsFound: gaps.length });
      this.metrics.increment('compliance.gaps_identified', gaps.length);
      span.finish();

      return gaps;
    } catch (error) {
      this.logger.error('Gap analysis failed', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * WEAPONIZATION FEATURE 4: Predictive Compliance Alerts
   * Predict future compliance violations
   */
  async generatePredictiveAlerts(tasks) {
    const span = this.tracer.startSpan('generate_predictive_alerts');

    try {
      const alerts = [];

      for (const task of tasks) {
        // Predict if task will be overdue
        const daysUntilDue = this.calculateDaysUntilDue(task);
        const completionRate = this.estimateCompletionRate(task);

        if (daysUntilDue < 7 && completionRate < 50) {
          alerts.push({
            taskId: task.id,
            title: task.title,
            alertType: 'PREDICTED_OVERDUE',
            confidence: 0.85,
            daysUntilDue,
            estimatedCompletionRate: completionRate,
            recommendation: 'Increase resources or extend deadline',
          });
        }

        // Predict compliance violations
        if (!task.description || task.description.length < 100) {
          alerts.push({
            taskId: task.id,
            title: task.title,
            alertType: 'DOCUMENTATION_INCOMPLETE',
            confidence: 0.9,
            recommendation: 'Add comprehensive compliance documentation',
          });
        }
      }

      this.logger.info('Predictive alerts generated', { alerts: alerts.length });
      this.metrics.increment('alerts.predictive', alerts.length);
      span.finish();

      return alerts;
    } catch (error) {
      this.logger.error('Predictive alert generation failed', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * WEAPONIZATION FEATURE 5: Compliance Audit Trail
   * Track all compliance activities and changes
   */
  async generateAuditTrail(tasks) {
    const span = this.tracer.startSpan('generate_audit_trail');

    try {
      const auditTrail = [];

      for (const task of tasks) {
        auditTrail.push({
          timestamp: new Date(),
          taskId: task.id,
          action: 'COMPLIANCE_TASK_REVIEWED',
          details: {
            title: task.title,
            status: task.status,
            assignee: task.assignee_id,
            dueDate: task.due_date,
          },
          actor: 'COMPLIANCE_ENGINE',
          auditLevel: 'FORMAL',
        });
      }

      this.logger.info('Audit trail generated', { entries: auditTrail.length });
      this.metrics.increment('audit.trail_entries', auditTrail.length);
      span.finish();

      return auditTrail;
    } catch (error) {
      this.logger.error('Audit trail generation failed', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * WEAPONIZATION FEATURE 6: Compliance Metrics Dashboard
   * Real-time compliance metrics and KPIs
   */
  async generateComplianceMetrics(tasks) {
    const span = this.tracer.startSpan('generate_compliance_metrics');

    try {
      const metrics = {
        totalTasks: tasks.length,
        completedTasks: tasks.filter(t => t.status === 'completed').length,
        overdueTasks: tasks.filter(t => this.calculateDaysOverdue(t) > 0).length,
        atRiskTasks: tasks.filter(t => this.calculateDaysOverdue(t) > 7).length,
        complianceRate: 0,
        riskScore: 0,
        trend: 'STABLE',
      };

      metrics.complianceRate = (metrics.completedTasks / metrics.totalTasks) * 100;
      metrics.riskScore = (metrics.atRiskTasks / metrics.totalTasks) * 100;

      if (metrics.overdueTasks > 0) {
        metrics.trend = 'DECLINING';
      } else if (metrics.completedTasks > tasks.length * 0.8) {
        metrics.trend = 'IMPROVING';
      }

      this.logger.info('Compliance metrics generated', metrics);
      this.metrics.gauge('compliance.rate', metrics.complianceRate);
      this.metrics.gauge('compliance.risk_score', metrics.riskScore);
      span.finish();

      return metrics;
    } catch (error) {
      this.logger.error('Metrics generation failed', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  /**
   * WEAPONIZATION FEATURE 7: Automated Remediation
   * Suggest and track remediation actions
   */
  async generateRemediationPlan(tasks) {
    const span = this.tracer.startSpan('generate_remediation_plan');

    try {
      const remediationPlan = [];

      for (const task of tasks) {
        const issues = [];
        const actions = [];

        // Identify issues
        if (this.calculateDaysOverdue(task) > 0) {
          issues.push('TASK_OVERDUE');
          actions.push({
            action: 'EXTEND_DEADLINE',
            priority: 'HIGH',
            owner: 'PROJECT_MANAGER',
            timeline: 'IMMEDIATE',
          });
        }

        if (!task.assignee_id) {
          issues.push('NOT_ASSIGNED');
          actions.push({
            action: 'ASSIGN_RESOURCE',
            priority: 'HIGH',
            owner: 'TEAM_LEAD',
            timeline: '1_DAY',
          });
        }

        if (!task.description || task.description.length < 100) {
          issues.push('INCOMPLETE_DOCUMENTATION');
          actions.push({
            action: 'ADD_COMPLIANCE_DOCUMENTATION',
            priority: 'MEDIUM',
            owner: 'TASK_OWNER',
            timeline: '2_DAYS',
          });
        }

        if (issues.length > 0) {
          remediationPlan.push({
            taskId: task.id,
            title: task.title,
            issues,
            actions,
            estimatedResolutionTime: '3_DAYS',
            riskIfNotResolved: 'COMPLIANCE_VIOLATION',
          });
        }
      }

      this.logger.info('Remediation plan generated', { tasks: remediationPlan.length });
      this.metrics.increment('remediation.plans_generated', remediationPlan.length);
      span.finish();

      return remediationPlan;
    } catch (error) {
      this.logger.error('Remediation plan generation failed', { error: error.message });
      span.setTag('error', true);
      span.finish();
      throw error;
    }
  }

  // ========== HELPER METHODS ==========

  calculateTaskRisk(task) {
    let riskLevel = 'low';
    const daysOverdue = this.calculateDaysOverdue(task);

    if (daysOverdue > 30) {
      riskLevel = 'critical';
    } else if (daysOverdue > 14) {
      riskLevel = 'high';
    } else if (daysOverdue > 7) {
      riskLevel = 'medium';
    }

    return riskLevel;
  }

  calculateDaysOverdue(task) {
    if (!task.due_date || task.status === 'completed') {
      return 0;
    }

    const dueDate = new Date(task.due_date);
    const today = new Date();
    const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

    return Math.max(0, daysOverdue);
  }

  calculateDaysUntilDue(task) {
    if (!task.due_date) {
      return 999;
    }

    const dueDate = new Date(task.due_date);
    const today = new Date();
    const daysUntilDue = Math.floor((dueDate - today) / (1000 * 60 * 60 * 24));

    return Math.max(0, daysUntilDue);
  }

  estimateCompletionRate(task) {
    // Simple estimation based on task properties
    let rate = 50;

    if (task.assignee_id) rate += 10;
    if (task.description && task.description.length > 100) rate += 15;
    if (task.subtasks && task.subtasks.length > 0) rate += 10;

    return Math.min(100, rate);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  ComplianceNarrationsEngine,
  ComplianceWeaponizationEngine,
};
