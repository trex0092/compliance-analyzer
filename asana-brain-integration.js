/**
 * ASANA Brain Integration Module
 * Integrates weaponized intelligence into existing compliance systems
 */

const ASANABrainIntelligence = require('./asana-brain-intelligence');

class ASANABrainIntegration {
  constructor(asanaClient, db, eventBus) {
    this.brain = new ASANABrainIntelligence(asanaClient, db);
    this.asanaClient = asanaClient;
    this.db = db;
    this.eventBus = eventBus;
    this.isRunning = false;
  }

  /**
   * Initialize ASANA Brain integration
   */
  async initialize() {
    console.log('[ASANA Brain] Initializing weaponized intelligence system...');

    // Run initial analysis
    await this.runFullAnalysis();

    // Set up continuous monitoring
    this.startContinuousMonitoring();

    console.log('[ASANA Brain] ✅ Weaponized intelligence system initialized');
  }

  /**
   * Run full compliance analysis
   */
  async runFullAnalysis() {
    try {
      console.log('[ASANA Brain] Running full compliance analysis...');

      // Run all intelligence engines in parallel
      const [predictions, threats, automation, analytics] = await Promise.all([
        this.brain.predictComplianceFailures(),
        this.brain.detectComplianceThreats(),
        this.brain.executeIntelligentAutomation(),
        this.brain.generateComplianceAnalytics(),
      ]);

      // Emit events for integration with other systems
      this.eventBus?.emit('asana-brain:predictions', predictions);
      this.eventBus?.emit('asana-brain:threats', threats);
      this.eventBus?.emit('asana-brain:automation', automation);
      this.eventBus?.emit('asana-brain:analytics', analytics);

      // Log summary
      console.log('[ASANA Brain] Analysis Complete:');
      console.log(`  - Predictions: ${predictions.delayRisks.length} delay risks, ${predictions.escalationNeeds.length} escalations`);
      console.log(`  - Threats: ${threats.criticalCount} critical, ${threats.highCount} high`);
      console.log(`  - Automation: ${automation.workflowsExecuted} workflows executed`);
      console.log(`  - Compliance Score: ${analytics.complianceScore}%`);

      return { predictions, threats, automation, analytics };
    } catch (error) {
      console.error('[ASANA Brain] Analysis error:', error);
      return null;
    }
  }

  /**
   * Start continuous monitoring
   */
  startContinuousMonitoring() {
    if (this.isRunning) return;

    this.isRunning = true;
    console.log('[ASANA Brain] Starting continuous monitoring...');

    // Run analysis every 5 minutes
    this.monitoringInterval = setInterval(async () => {
      await this.runFullAnalysis();
    }, 5 * 60 * 1000);

    // Also run on-demand threat detection every minute
    this.threatDetectionInterval = setInterval(async () => {
      const threats = await this.brain.detectComplianceThreats();
      if (threats.criticalCount > 0) {
        console.log(`[ASANA Brain] 🚨 CRITICAL THREATS DETECTED: ${threats.criticalCount}`);
        this.eventBus?.emit('asana-brain:critical-threat', threats);
      }
    }, 60 * 1000);
  }

  /**
   * Stop continuous monitoring
   */
  stopContinuousMonitoring() {
    if (!this.isRunning) return;

    this.isRunning = false;
    clearInterval(this.monitoringInterval);
    clearInterval(this.threatDetectionInterval);
    console.log('[ASANA Brain] Continuous monitoring stopped');
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      latestThreats: this.brain.getLatestThreats(),
      latestPredictions: this.brain.getLatestPredictions(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Integrate with compliance pipeline
   */
  async integrateWithPipeline(compliancePipeline) {
    console.log('[ASANA Brain] Integrating with compliance pipeline...');

    // Hook into pipeline events
    compliancePipeline.on('task-created', async (task) => {
      console.log(`[ASANA Brain] New task detected: ${task.name}`);
      const riskScore = this.brain.calculateRiskScore(task);
      if (riskScore > 70) {
        console.log(`[ASANA Brain] ⚠️ High-risk task detected: ${task.name} (Risk: ${riskScore}%)`);
      }
    });

    compliancePipeline.on('task-updated', async (task) => {
      const riskScore = this.brain.calculateRiskScore(task);
      if (this.brain.needsEscalation(task)) {
        console.log(`[ASANA Brain] 📢 Escalation needed: ${task.name}`);
      }
    });

    console.log('[ASANA Brain] ✅ Integrated with compliance pipeline');
  }

  /**
   * Integrate with brain console
   */
  async integrateWithBrainConsole(brainConsole) {
    console.log('[ASANA Brain] Integrating with brain console...');

    // Register commands
    brainConsole.registerCommand('asana-brain:status', () => this.getStatus());
    brainConsole.registerCommand('asana-brain:analyze', () => this.runFullAnalysis());
    brainConsole.registerCommand('asana-brain:threats', () => this.brain.detectComplianceThreats());
    brainConsole.registerCommand('asana-brain:predictions', () => this.brain.predictComplianceFailures());
    brainConsole.registerCommand('asana-brain:automation', () => this.brain.executeIntelligentAutomation());
    brainConsole.registerCommand('asana-brain:analytics', () => this.brain.generateComplianceAnalytics());

    console.log('[ASANA Brain] ✅ Integrated with brain console');
  }

  /**
   * Export intelligence data
   */
  async exportIntelligenceData() {
    const threats = this.brain.getLatestThreats();
    const predictions = this.brain.getLatestPredictions();

    return {
      threats,
      predictions,
      exportedAt: new Date().toISOString(),
    };
  }
}

module.exports = ASANABrainIntegration;
