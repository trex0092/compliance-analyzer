/**
 * Hawkeye Sterling V2 - API Server
 * Exposes all modules as REST endpoints for integration with Hawkeye Sterling V2 tool
 */

const express = require('express');
const HawkeyeBootstrap = require('./hawkeye-bootstrap');

class HawkeyeAPIServer {
  constructor(asanaClient, port = 3001) {
    this.app = express();
    this.port = port;
    this.asanaClient = asanaClient;
    this.hawkeye = null;
  }

  /**
   * Initialize and start API server
   */
  async start() {
    // Middleware
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // CORS
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    });

    // Initialize Hawkeye
    console.log('\n🚀 Initializing Hawkeye API Server...\n');
    this.hawkeye = new HawkeyeBootstrap(this.asanaClient);
    await this.hawkeye.initialize();

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        systemStatus: this.hawkeye.getSystemStatus(),
      });
    });

    // System status
    this.app.get('/api/system/status', (req, res) => {
      res.json(this.hawkeye.getSystemStatus());
    });

    // System report
    this.app.get('/api/system/report', async (req, res) => {
      try {
        const report = await this.hawkeye.generateSystemReport();
        res.json(report);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // ===== TIER 1 - CRITICAL ENHANCEMENTS =====

    // STR Analysis
    this.app.post('/api/str/analyze', async (req, res) => {
      try {
        const result = await this.hawkeye.analyzeTransaction(req.body);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // AML Risk Scoring
    this.app.post('/api/aml/score', async (req, res) => {
      try {
        const result = await this.hawkeye.scoreAMLRisk(req.body.customer, req.body.transactions);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Regulatory Compliance
    this.app.post('/api/compliance/check', async (req, res) => {
      try {
        const result = await this.hawkeye.checkRegulatorCompliance(req.body);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // ===== TIER 2 - ADVANCED FEATURES =====

    // Multi-Jurisdiction Compliance
    this.app.post('/api/jurisdiction/check', async (req, res) => {
      try {
        const result = await this.hawkeye.checkMultiJurisdictionCompliance(
          req.body.entity,
          req.body.jurisdictions
        );
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Sanctions Screening
    this.app.post('/api/sanctions/screen', async (req, res) => {
      try {
        const result = await this.hawkeye.screenSanctions(req.body);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // KYC Process
    this.app.post('/api/kyc/initiate', async (req, res) => {
      try {
        const result = await this.hawkeye.initiateKYC(req.body);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // ===== TIER 3 - OPERATIONAL EXCELLENCE =====

    // Audit Event
    this.app.post('/api/audit/log', async (req, res) => {
      try {
        const result = await this.hawkeye.logAuditEvent(req.body);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Case Management
    this.app.post('/api/cases/create', async (req, res) => {
      try {
        const result = await this.hawkeye.createCase(req.body);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Start server
    this.server = this.app.listen(this.port, () => {
      console.log(`\n✅ Hawkeye API Server running on http://localhost:${this.port}\n`);
      console.log('Available Endpoints:');
      console.log('- GET  /health');
      console.log('- GET  /api/system/status');
      console.log('- GET  /api/system/report');
      console.log('- POST /api/str/analyze');
      console.log('- POST /api/aml/score');
      console.log('- POST /api/compliance/check');
      console.log('- POST /api/jurisdiction/check');
      console.log('- POST /api/sanctions/screen');
      console.log('- POST /api/kyc/initiate');
      console.log('- POST /api/audit/log');
      console.log('- POST /api/cases/create');
      console.log('\n');
    });

    return this;
  }

  /**
   * Stop API server
   */
  async stop() {
    if (this.server) {
      this.server.close();
    }
    if (this.hawkeye) {
      await this.hawkeye.shutdown();
    }
  }
}

module.exports = HawkeyeAPIServer;
