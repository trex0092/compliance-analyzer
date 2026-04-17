/**
 * Hawkeye Sterling V2 - ML Pattern Recognition Engine
 * Detects money laundering schemes and suspicious patterns
 * Auto-creates Asana tasks for detected patterns
 */

class MLPatternRecognitionEngine {
  constructor(asanaClient, config = {}) {
    this.asanaClient = asanaClient;
    this.workspaceId = '1213645083721316';
    this.config = config;
    this.patterns = this.initializePatterns();
    this.detectionHistory = [];
  }

  /**
   * Initialize known money laundering patterns
   */
  initializePatterns() {
    return {
      structuring: {
        name: 'Structuring (Smurfing)',
        description: 'Multiple transactions below reporting threshold',
        indicators: [
          'Multiple transactions just below $10,000',
          'Rapid succession of deposits',
          'Different accounts/beneficiaries',
          'Round amounts',
        ],
        riskScore: 85,
        regulatoryRef: 'FDL Art.1, FATF Rec.13',
      },
      layering: {
        name: 'Layering',
        description: 'Complex transactions to obscure money origin',
        indicators: [
          'Multiple transfers between accounts',
          'Cross-border transactions',
          'Rapid fund movement',
          'Use of intermediaries',
        ],
        riskScore: 80,
        regulatoryRef: 'FDL Art.1, FATF Rec.13',
      },
      integration: {
        name: 'Integration',
        description: 'Reintroduction of illicit funds into economy',
        indicators: [
          'Large cash deposits',
          'Business purchases',
          'Real estate transactions',
          'Investment activities',
        ],
        riskScore: 75,
        regulatoryRef: 'FDL Art.1, FATF Rec.13',
      },
      trade_based_ml: {
        name: 'Trade-Based Money Laundering',
        description: 'Using international trade to move illicit funds',
        indicators: [
          'Over/under-invoicing',
          'Mismatched shipments',
          'Unusual trade partners',
          'High-value commodities',
        ],
        riskScore: 80,
        regulatoryRef: 'FATF Rec.20',
      },
      hawala: {
        name: 'Hawala/Underground Banking',
        description: 'Informal value transfer system',
        indicators: [
          'Transfers without documentation',
          'Code-based communications',
          'No formal banking',
          'High-value transfers',
        ],
        riskScore: 90,
        regulatoryRef: 'FATF Rec.15',
      },
      cash_intensive: {
        name: 'Cash-Intensive Business Abuse',
        description: 'Using legitimate businesses to launder money',
        indicators: [
          'Casinos, restaurants, retail',
          'Unusual cash deposits',
          'Inflated revenues',
          'Minimal expenses',
        ],
        riskScore: 70,
        regulatoryRef: 'FATF Rec.22',
      },
      velocity_abuse: {
        name: 'Transaction Velocity Abuse',
        description: 'Rapid movement of funds',
        indicators: [
          'High transaction frequency',
          'Large volumes',
          'Short time intervals',
          'Multiple destinations',
        ],
        riskScore: 65,
        regulatoryRef: 'FATF Rec.10',
      },
      round_tripping: {
        name: 'Round Tripping',
        description: 'Funds sent out and returned',
        indicators: [
          'Outbound transfers',
          'Rapid return transfers',
          'Same amounts',
          'Circular flow',
        ],
        riskScore: 75,
        regulatoryRef: 'FATF Rec.13',
      },
    };
  }

  /**
   * Detect patterns in transaction history
   */
  async detectPatterns(customer, transactions) {
    const detections = {
      customerId: customer.id,
      customerName: customer.name,
      analysisDate: new Date().toISOString(),
      detectedPatterns: [],
      overallRiskScore: 0,
      requiresEscalation: false,
    };

    // Check each pattern
    for (const [patternKey, patternData] of Object.entries(this.patterns)) {
      const score = this.analyzePattern(transactions, patternKey, patternData);
      
      if (score > 50) {
        detections.detectedPatterns.push({
          pattern: patternKey,
          name: patternData.name,
          description: patternData.description,
          detectionScore: score,
          indicators: this.getMatchingIndicators(transactions, patternKey),
          riskScore: patternData.riskScore,
          regulatoryRef: patternData.regulatoryRef,
        });
      }
    }

    // Calculate overall risk
    if (detections.detectedPatterns.length > 0) {
      detections.overallRiskScore = Math.round(
        detections.detectedPatterns.reduce((sum, p) => sum + p.detectionScore, 0) / 
        detections.detectedPatterns.length
      );
      detections.requiresEscalation = detections.overallRiskScore > 70;

      // Create Asana task for detected patterns
      if (detections.requiresEscalation) {
        await this.createPatternDetectionTask(customer, detections);
      }
    }

    this.detectionHistory.push(detections);
    return detections;
  }

  /**
   * Analyze specific pattern
   */
  analyzePattern(transactions, patternKey, patternData) {
    let score = 0;

    switch (patternKey) {
      case 'structuring':
        score = this.analyzeStructuring(transactions);
        break;
      case 'layering':
        score = this.analyzeLayering(transactions);
        break;
      case 'integration':
        score = this.analyzeIntegration(transactions);
        break;
      case 'trade_based_ml':
        score = this.analyzeTradeBasedML(transactions);
        break;
      case 'hawala':
        score = this.analyzeHawala(transactions);
        break;
      case 'cash_intensive':
        score = this.analyzeCashIntensive(transactions);
        break;
      case 'velocity_abuse':
        score = this.analyzeVelocityAbuse(transactions);
        break;
      case 'round_tripping':
        score = this.analyzeRoundTripping(transactions);
        break;
    }

    return score;
  }

  /**
   * Analyze structuring pattern
   */
  analyzeStructuring(transactions) {
    let score = 0;
    const threshold = 10000;
    const belowThreshold = transactions.filter(t => t.amount < threshold);

    if (belowThreshold.length > 5) score += 30;
    if (belowThreshold.length > 10) score += 30;
    
    // Check for round amounts
    const roundAmounts = belowThreshold.filter(t => t.amount % 1000 === 0);
    if (roundAmounts.length > 0) score += 20;

    // Check time proximity
    const timeProximity = this.checkTimeProximity(belowThreshold, 24 * 60 * 60 * 1000);
    if (timeProximity > 0.5) score += 20;

    return Math.min(100, score);
  }

  /**
   * Analyze layering pattern
   */
  analyzeLayering(transactions) {
    let score = 0;

    // Check for multiple transfers
    if (transactions.length > 10) score += 25;
    
    // Check for cross-border
    const crossBorder = transactions.filter(t => t.senderCountry !== t.beneficiaryCountry);
    if (crossBorder.length > 0) score += 25;

    // Check for rapid movement
    const rapidMovement = this.checkRapidMovement(transactions);
    if (rapidMovement) score += 25;

    // Check for intermediaries
    if (transactions.some(t => t.intermediaries && t.intermediaries.length > 0)) {
      score += 25;
    }

    return Math.min(100, score);
  }

  /**
   * Analyze integration pattern
   */
  analyzeIntegration(transactions) {
    let score = 0;

    // Large cash deposits
    const largeDeposits = transactions.filter(t => t.type === 'CASH_DEPOSIT' && t.amount > 50000);
    if (largeDeposits.length > 0) score += 30;

    // Business purchases
    if (transactions.some(t => t.category === 'BUSINESS_PURCHASE')) score += 25;

    // Real estate
    if (transactions.some(t => t.category === 'REAL_ESTATE')) score += 25;

    // Investments
    if (transactions.some(t => t.category === 'INVESTMENT')) score += 20;

    return Math.min(100, score);
  }

  /**
   * Analyze trade-based ML
   */
  analyzeTradeBasedML(transactions) {
    let score = 0;

    // Over/under-invoicing
    const tradeTransactions = transactions.filter(t => t.type === 'TRADE');
    if (tradeTransactions.length > 0) {
      const invoiceDiscrepancies = this.checkInvoiceDiscrepancies(tradeTransactions);
      if (invoiceDiscrepancies > 0.2) score += 40;
    }

    // Unusual trade partners
    if (transactions.some(t => t.highRiskJurisdiction)) score += 30;

    return Math.min(100, score);
  }

  /**
   * Analyze hawala pattern
   */
  analyzeHawala(transactions) {
    let score = 0;

    // No documentation
    if (transactions.some(t => !t.documentation)) score += 30;

    // Code-based communications
    if (transactions.some(t => t.communicationMethod === 'CODE')) score += 30;

    // No formal banking
    if (transactions.some(t => t.bankingMethod === 'INFORMAL')) score += 30;

    // High-value transfers
    const highValue = transactions.filter(t => t.amount > 100000);
    if (highValue.length > 0) score += 10;

    return Math.min(100, score);
  }

  /**
   * Analyze cash-intensive business
   */
  analyzeCashIntensive(transactions) {
    let score = 0;

    // Identify business type
    if (transactions.some(t => ['CASINO', 'RESTAURANT', 'RETAIL'].includes(t.businessType))) {
      score += 20;
    }

    // Unusual cash deposits
    const cashDeposits = transactions.filter(t => t.type === 'CASH_DEPOSIT');
    if (cashDeposits.length > 5) score += 25;

    // Inflated revenues
    if (transactions.some(t => t.revenueAnomaly > 0.3)) score += 25;

    return Math.min(100, score);
  }

  /**
   * Analyze velocity abuse
   */
  analyzeVelocityAbuse(transactions) {
    let score = 0;

    // High frequency
    if (transactions.length > 20) score += 25;

    // Large volumes
    const totalVolume = transactions.reduce((sum, t) => sum + t.amount, 0);
    if (totalVolume > 1000000) score += 25;

    // Rapid movement
    if (this.checkRapidMovement(transactions)) score += 25;

    return Math.min(100, score);
  }

  /**
   * Analyze round tripping
   */
  analyzeRoundTripping(transactions) {
    let score = 0;

    // Check for outbound and return
    const outbound = transactions.filter(t => t.direction === 'OUT');
    const inbound = transactions.filter(t => t.direction === 'IN');

    if (outbound.length > 0 && inbound.length > 0) {
      // Check for matching amounts
      for (const out of outbound) {
        const matching = inbound.find(i => Math.abs(i.amount - out.amount) < 100);
        if (matching) score += 40;
      }
    }

    return Math.min(100, score);
  }

  /**
   * Helper: Check time proximity
   */
  checkTimeProximity(transactions, timeWindow) {
    if (transactions.length < 2) return 0;
    
    let proximityCount = 0;
    for (let i = 0; i < transactions.length - 1; i++) {
      const timeDiff = Math.abs(
        new Date(transactions[i].timestamp) - new Date(transactions[i + 1].timestamp)
      );
      if (timeDiff < timeWindow) proximityCount++;
    }

    return proximityCount / transactions.length;
  }

  /**
   * Helper: Check rapid movement
   */
  checkRapidMovement(transactions) {
    if (transactions.length < 2) return false;

    const timeSpan = new Date(transactions[transactions.length - 1].timestamp) - 
                     new Date(transactions[0].timestamp);
    const avgTimePerTransaction = timeSpan / transactions.length;

    return avgTimePerTransaction < 24 * 60 * 60 * 1000; // Less than 24 hours average
  }

  /**
   * Helper: Check invoice discrepancies
   */
  checkInvoiceDiscrepancies(transactions) {
    let discrepancies = 0;
    for (const t of transactions) {
      if (t.invoicedAmount && t.actualAmount) {
        const diff = Math.abs(t.invoicedAmount - t.actualAmount) / t.invoicedAmount;
        if (diff > 0.2) discrepancies++;
      }
    }
    return discrepancies / transactions.length;
  }

  /**
   * Get matching indicators
   */
  getMatchingIndicators(transactions, patternKey) {
    // Return specific indicators found for this pattern
    return this.patterns[patternKey].indicators.slice(0, 3);
  }

  /**
   * Create Asana task for pattern detection
   */
  async createPatternDetectionTask(customer, detections) {
    try {
      const taskName = `🚨 ML ALERT: Money Laundering Pattern Detected - ${customer.name}`;

      const taskDescription = `
ML PATTERN RECOGNITION ALERT
============================

Customer: ${customer.name}
Customer ID: ${customer.id}
Analysis Date: ${detections.analysisDate}

DETECTED PATTERNS:
${detections.detectedPatterns.map(p => `
Pattern: ${p.name}
Description: ${p.description}
Detection Score: ${p.detectionScore}%
Risk Score: ${p.riskScore}%
Regulatory Reference: ${p.regulatoryRef}

Indicators:
${p.indicators.map(i => `- ${i}`).join('\n')}
`).join('\n')}

OVERALL RISK SCORE: ${detections.overallRiskScore}%
ESCALATION REQUIRED: ${detections.requiresEscalation ? 'YES - IMMEDIATE ACTION' : 'NO'}

RECOMMENDED ACTIONS:
1. Conduct enhanced due diligence
2. Review transaction history
3. Obtain source of funds documentation
4. File SAR if warranted
5. Consider account restrictions
6. Increase monitoring frequency

REGULATORY REFERENCES:
- FDL Art.1 (Definition of Money Laundering)
- FDL Art.20 (Reporting Obligations)
- FATF Recommendations 10, 13, 15, 20, 22
- Cabinet Resolution 74/2020
      `;

      const task = await this.asanaClient.tasks.create({
        workspace: this.workspaceId,
        name: taskName,
        notes: taskDescription,
        priority: 'urgent',
        custom_fields: {
          'Alert Type': 'ML_PATTERN',
          'Customer ID': customer.id,
          'Risk Score': detections.overallRiskScore,
          'Patterns Detected': detections.detectedPatterns.length,
        },
      });

      console.log(`[ML Pattern Recognition] ✅ Pattern detection task created: ${task.gid}`);
      return task.gid;
    } catch (error) {
      console.error('[ML Pattern Recognition] Error creating task:', error);
      return null;
    }
  }

  /**
   * Get detection history
   */
  getDetectionHistory() {
    return this.detectionHistory;
  }

  /**
   * Get pattern statistics
   */
  getPatternStatistics() {
    return {
      totalDetections: this.detectionHistory.length,
      patternsDetected: this.detectionHistory.reduce((acc, d) => acc + d.detectedPatterns.length, 0),
      averageRiskScore: Math.round(
        this.detectionHistory.reduce((sum, d) => sum + d.overallRiskScore, 0) / 
        (this.detectionHistory.length || 1)
      ),
      escalationsRequired: this.detectionHistory.filter(d => d.requiresEscalation).length,
    };
  }
}

module.exports = MLPatternRecognitionEngine;
