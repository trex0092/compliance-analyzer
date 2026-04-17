/**
 * Hawkeye Sterling V2 - Tool Integration Module
 * Direct integration with https://hawkeye-sterling-v2.netlify.app/
 * Connects frontend to all backend intelligence modules
 */

class HawkeyeToolIntegration {
  constructor(baseURL = 'https://hawkeye-sterling-v2.netlify.app') {
    this.baseURL = baseURL;
    this.apiEndpoint = 'http://localhost:3001';
    this.modules = {};
    this.isConnected = false;
  }

  /**
   * Initialize tool integration
   */
  async initialize() {
    console.log('\n🔗 HAWKEYE STERLING V2 - TOOL INTEGRATION INITIALIZING\n');

    try {
      // Check API server connection
      const health = await this.checkAPIHealth();
      if (!health) {
        throw new Error('API Server not responding');
      }

      this.isConnected = true;
      console.log('✅ Connected to API Server\n');

      return this;
    } catch (error) {
      console.error('❌ Integration failed:', error);
      throw error;
    }
  }

  /**
   * Check API server health
   */
  async checkAPIHealth() {
    try {
      const response = await fetch(`${this.apiEndpoint}/health`);
      return response.ok;
    } catch (error) {
      console.error('API Server health check failed:', error);
      return false;
    }
  }

  /**
   * Get system status for dashboard
   */
  async getSystemStatus() {
    if (!this.isConnected) throw new Error('Not connected to API');

    const response = await fetch(`${this.apiEndpoint}/api/system/status`);
    return response.json();
  }

  /**
   * Get system report
   */
  async getSystemReport() {
    if (!this.isConnected) throw new Error('Not connected to API');

    const response = await fetch(`${this.apiEndpoint}/api/system/report`);
    return response.json();
  }

  /**
   * Analyze STR
   */
  async analyzeSTR(transaction) {
    if (!this.isConnected) throw new Error('Not connected to API');

    const response = await fetch(`${this.apiEndpoint}/api/str/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transaction),
    });
    return response.json();
  }

  /**
   * Score AML risk
   */
  async scoreAMLRisk(customer, transactions) {
    if (!this.isConnected) throw new Error('Not connected to API');

    const response = await fetch(`${this.apiEndpoint}/api/aml/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer, transactions }),
    });
    return response.json();
  }

  /**
   * Check regulatory compliance
   */
  async checkCompliance(entity) {
    if (!this.isConnected) throw new Error('Not connected to API');

    const response = await fetch(`${this.apiEndpoint}/api/compliance/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entity),
    });
    return response.json();
  }

  /**
   * Check multi-jurisdiction compliance
   */
  async checkJurisdictionCompliance(entity, jurisdictions) {
    if (!this.isConnected) throw new Error('Not connected to API');

    const response = await fetch(`${this.apiEndpoint}/api/jurisdiction/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity, jurisdictions }),
    });
    return response.json();
  }

  /**
   * Screen sanctions
   */
  async screenSanctions(individual) {
    if (!this.isConnected) throw new Error('Not connected to API');

    const response = await fetch(`${this.apiEndpoint}/api/sanctions/screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(individual),
    });
    return response.json();
  }

  /**
   * Initiate KYC
   */
  async initiateKYC(customer) {
    if (!this.isConnected) throw new Error('Not connected to API');

    const response = await fetch(`${this.apiEndpoint}/api/kyc/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customer),
    });
    return response.json();
  }

  /**
   * Log audit event
   */
  async logAuditEvent(event) {
    if (!this.isConnected) throw new Error('Not connected to API');

    const response = await fetch(`${this.apiEndpoint}/api/audit/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    return response.json();
  }

  /**
   * Create case
   */
  async createCase(caseData) {
    if (!this.isConnected) throw new Error('Not connected to API');

    const response = await fetch(`${this.apiEndpoint}/api/cases/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(caseData),
    });
    return response.json();
  }

  /**
   * Get dashboard data
   */
  async getDashboardData() {
    if (!this.isConnected) throw new Error('Not connected to API');

    const status = await this.getSystemStatus();
    const report = await this.getSystemReport();

    return {
      status,
      report,
      dashboardReady: true,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get compliance metrics
   */
  async getComplianceMetrics() {
    const report = await this.getSystemReport();

    return {
      totalCases: report.caseStatistics?.totalCases || 0,
      openCases: report.caseStatistics?.openCases || 0,
      closedCases: report.caseStatistics?.closedCases || 0,
      averagePriority: report.caseStatistics?.averagePriority || 0,
      auditEvents: report.auditReport?.totalEvents || 0,
      criticalEvents: report.auditReport?.criticalEvents?.length || 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get real-time alerts
   */
  async getRealTimeAlerts() {
    const status = await this.getSystemStatus();

    return {
      systemStatus: status.systemStatus,
      realTimeMonitoring: status.realTimeMonitoring,
      alerts: [],
      timestamp: new Date().toISOString(),
    };
  }
}

// Export for browser usage
if (typeof window !== 'undefined') {
  window.HawkeyeToolIntegration = HawkeyeToolIntegration;
}

module.exports = HawkeyeToolIntegration;
