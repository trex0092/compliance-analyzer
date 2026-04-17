/**
 * Hawkeye Sterling V2 - Banking System Integration
 * Direct transaction feeds from banking systems
 * Real-time compliance monitoring of all transactions
 */

class BankingIntegrationEngine {
  constructor(asanaClient, config = {}) {
    this.asanaClient = asanaClient;
    this.workspaceId = '1213645083721316';
    this.config = config;
    this.connectedBanks = [];
    this.transactionFeed = [];
    this.feedActive = false;
  }

  /**
   * Connect to banking system
   */
  async connectToBank(bankConfig) {
    const connection = {
      id: `BANK-${Date.now()}`,
      bankName: bankConfig.bankName,
      apiEndpoint: bankConfig.apiEndpoint,
      apiKey: bankConfig.apiKey,
      connectedAt: new Date().toISOString(),
      status: 'CONNECTED',
      transactionCount: 0,
      lastSync: null,
    };

    this.connectedBanks.push(connection);
    console.log(`[Banking Integration] ✅ Connected to ${bankConfig.bankName}`);

    // Start transaction feed
    await this.startTransactionFeed(connection);

    return connection;
  }

  /**
   * Start real-time transaction feed
   */
  async startTransactionFeed(bankConnection) {
    console.log(`[Banking Integration] 🔄 Starting transaction feed for ${bankConnection.bankName}`);

    // Simulate transaction feed (in production: real API integration)
    this.feedActive = true;
    
    // Poll for transactions every 5 minutes
    this.feedInterval = setInterval(async () => {
      await this.fetchTransactions(bankConnection);
    }, 5 * 60 * 1000);

    // Initial fetch
    await this.fetchTransactions(bankConnection);
  }

  /**
   * Fetch transactions from bank
   */
  async fetchTransactions(bankConnection) {
    try {
      // In production: Call actual banking API
      const transactions = await this.simulateTransactionFetch(bankConnection);

      for (const transaction of transactions) {
        // Add to feed
        this.transactionFeed.push(transaction);
        bankConnection.transactionCount++;

        // Trigger compliance checks
        await this.performComplianceChecks(transaction);
      }

      bankConnection.lastSync = new Date().toISOString();
      console.log(`[Banking Integration] ✅ Fetched ${transactions.length} transactions from ${bankConnection.bankName}`);

      return transactions;
    } catch (error) {
      console.error(`[Banking Integration] Error fetching transactions:`, error);
      return [];
    }
  }

  /**
   * Simulate transaction fetch (replace with real API)
   */
  async simulateTransactionFetch(bankConnection) {
    return [
      {
        id: `TXN-${Date.now()}-1`,
        bankId: bankConnection.id,
        timestamp: new Date().toISOString(),
        type: 'TRANSFER',
        amount: 150000,
        currency: 'AED',
        sender: {
          name: 'Ahmed Al-Mansouri',
          account: 'AE12345678901234567890',
          jurisdiction: 'UAE',
        },
        beneficiary: {
          name: 'International Trading Co',
          account: 'SG98765432109876543210',
          jurisdiction: 'Singapore',
        },
        description: 'Payment for goods',
        status: 'COMPLETED',
      },
      {
        id: `TXN-${Date.now()}-2`,
        bankId: bankConnection.id,
        timestamp: new Date().toISOString(),
        type: 'DEPOSIT',
        amount: 500000,
        currency: 'AED',
        sender: {
          name: 'Cash Deposit',
          account: 'CASH',
          jurisdiction: 'UAE',
        },
        beneficiary: {
          name: 'Business Account',
          account: 'AE11111111111111111111',
          jurisdiction: 'UAE',
        },
        description: 'Cash deposit',
        status: 'COMPLETED',
      },
    ];
  }

  /**
   * Perform compliance checks on transaction
   */
  async performComplianceChecks(transaction) {
    const checks = {
      transactionId: transaction.id,
      timestamp: new Date().toISOString(),
      checks: [],
      overallStatus: 'PASS',
    };

    // Amount threshold check
    if (transaction.amount > 100000) {
      checks.checks.push({
        type: 'AMOUNT_THRESHOLD',
        status: 'ALERT',
        message: `Large transaction: ${transaction.amount} ${transaction.currency}`,
      });
      checks.overallStatus = 'ALERT';
    }

    // Sanctions check
    if (this.isHighRiskJurisdiction(transaction.beneficiary.jurisdiction)) {
      checks.checks.push({
        type: 'JURISDICTION_RISK',
        status: 'ALERT',
        message: `High-risk jurisdiction: ${transaction.beneficiary.jurisdiction}`,
      });
      checks.overallStatus = 'ALERT';
    }

    // Velocity check
    const recentTransactions = this.getRecentTransactions(transaction.sender.account, 24);
    if (recentTransactions.length > 5) {
      checks.checks.push({
        type: 'VELOCITY',
        status: 'ALERT',
        message: `High transaction velocity: ${recentTransactions.length} transactions in 24 hours`,
      });
      checks.overallStatus = 'ALERT';
    }

    // Pattern check
    if (this.isStructuringPattern(transaction.sender.account)) {
      checks.checks.push({
        type: 'STRUCTURING',
        status: 'ALERT',
        message: 'Potential structuring pattern detected',
      });
      checks.overallStatus = 'ALERT';
    }

    // Create Asana task if alert
    if (checks.overallStatus === 'ALERT') {
      await this.createTransactionAlertTask(transaction, checks);
    }

    return checks;
  }

  /**
   * Check if jurisdiction is high-risk
   */
  isHighRiskJurisdiction(jurisdiction) {
    const highRiskJurisdictions = ['Iran', 'North Korea', 'Syria', 'Sudan', 'Somalia'];
    return highRiskJurisdictions.includes(jurisdiction);
  }

  /**
   * Get recent transactions for account
   */
  getRecentTransactions(account, hoursBack) {
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    return this.transactionFeed.filter(t => 
      (t.sender.account === account || t.beneficiary.account === account) &&
      new Date(t.timestamp) > cutoffTime
    );
  }

  /**
   * Check for structuring pattern
   */
  isStructuringPattern(account) {
    const threshold = 10000;
    const recentTransactions = this.getRecentTransactions(account, 24);
    const belowThreshold = recentTransactions.filter(t => t.amount < threshold);
    
    return belowThreshold.length > 5;
  }

  /**
   * Create Asana task for transaction alert
   */
  async createTransactionAlertTask(transaction, checks) {
    try {
      const taskName = `⚠️ TRANSACTION ALERT: ${transaction.sender.name} → ${transaction.beneficiary.name}`;

      const taskDescription = `
TRANSACTION COMPLIANCE ALERT
============================

Transaction ID: ${transaction.id}
Timestamp: ${transaction.timestamp}
Bank: ${transaction.bankId}

TRANSACTION DETAILS:
Type: ${transaction.type}
Amount: ${transaction.amount} ${transaction.currency}
Status: ${transaction.status}

SENDER:
Name: ${transaction.sender.name}
Account: ${transaction.sender.account}
Jurisdiction: ${transaction.sender.jurisdiction}

BENEFICIARY:
Name: ${transaction.beneficiary.name}
Account: ${transaction.beneficiary.account}
Jurisdiction: ${transaction.beneficiary.jurisdiction}

Description: ${transaction.description}

COMPLIANCE CHECKS:
${checks.checks.map(c => `
- ${c.type}: ${c.status}
  ${c.message}
`).join('\n')}

OVERALL STATUS: ${checks.overallStatus}

REQUIRED ACTIONS:
1. Review transaction details
2. Verify sender and beneficiary
3. Assess compliance risk
4. Document findings
5. Take appropriate action

REGULATORY REFERENCE:
- FDL Art.1 (Money Laundering Definition)
- FDL Art.20 (Reporting Obligations)
- FATF Recommendation 10 (Customer Due Diligence)
      `;

      const task = await this.asanaClient.tasks.create({
        workspace: this.workspaceId,
        name: taskName,
        notes: taskDescription,
        priority: 'high',
        custom_fields: {
          'Alert Type': 'TRANSACTION',
          'Transaction ID': transaction.id,
          'Amount': transaction.amount,
          'Status': checks.overallStatus,
        },
      });

      console.log(`[Banking Integration] ✅ Transaction alert task created: ${task.gid}`);
      return task.gid;
    } catch (error) {
      console.error('[Banking Integration] Error creating alert task:', error);
      return null;
    }
  }

  /**
   * Get transaction statistics
   */
  getTransactionStatistics() {
    return {
      totalTransactions: this.transactionFeed.length,
      connectedBanks: this.connectedBanks.length,
      transactionsByType: this.groupByType(),
      transactionsByJurisdiction: this.groupByJurisdiction(),
      alertsGenerated: this.transactionFeed.filter(t => t.alert).length,
      totalVolume: this.transactionFeed.reduce((sum, t) => sum + t.amount, 0),
    };
  }

  /**
   * Group transactions by type
   */
  groupByType() {
    return this.transactionFeed.reduce((acc, t) => {
      acc[t.type] = (acc[t.type] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Group transactions by jurisdiction
   */
  groupByJurisdiction() {
    return this.transactionFeed.reduce((acc, t) => {
      const jurisdiction = t.beneficiary.jurisdiction;
      acc[jurisdiction] = (acc[jurisdiction] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Disconnect from bank
   */
  async disconnectFromBank(bankId) {
    const bank = this.connectedBanks.find(b => b.id === bankId);
    if (bank) {
      bank.status = 'DISCONNECTED';
      if (this.feedInterval) {
        clearInterval(this.feedInterval);
      }
      console.log(`[Banking Integration] ✅ Disconnected from ${bank.bankName}`);
    }
  }

  /**
   * Stop all feeds
   */
  stopAllFeeds() {
    if (this.feedInterval) {
      clearInterval(this.feedInterval);
    }
    this.feedActive = false;
    console.log('[Banking Integration] ✅ All feeds stopped');
  }
}

module.exports = BankingIntegrationEngine;
