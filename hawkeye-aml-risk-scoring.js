/**
 * Hawkeye Sterling V2 - Predictive AML Risk Scoring Engine
 * Forecasts compliance violations before they happen
 * Integrates with Asana for task management
 */

class AMLRiskScoringEngine {
  constructor(asanaClient, config = {}) {
    this.asanaClient = asanaClient;
    this.workspaceId = '1213645083721316';
    this.config = config;
    this.riskFactors = this.initializeRiskFactors();
  }

  /**
   * Initialize AML risk factors
   */
  initializeRiskFactors() {
    return {
      customerProfile: {
        weight: 0.25,
        factors: {
          highNetWorth: 15,
          politicallyExposed: 40,
          sanctionedCountry: 50,
          highRiskBusiness: 30,
          newCustomer: 20,
        },
      },
      transactionBehavior: {
        weight: 0.30,
        factors: {
          unusualAmount: 20,
          frequencyChange: 25,
          velocityAnomaly: 30,
          structuring: 45,
          rapidMovement: 35,
        },
      },
      geographicRisk: {
        weight: 0.20,
        factors: {
          highRiskJurisdiction: 35,
          sanctionedCountry: 50,
          noFatfCompliance: 30,
          corruptionIndex: 25,
        },
      },
      complianceHistory: {
        weight: 0.15,
        factors: {
          previousAlerts: 20,
          failedKYC: 35,
          regulatoryViolations: 40,
          suspiciousActivity: 30,
        },
      },
      networkRisk: {
        weight: 0.10,
        factors: {
          highRiskBeneficiary: 25,
          layering: 40,
          complexStructure: 30,
          thirdPartyRisk: 20,
        },
      },
    };
  }

  /**
   * Calculate comprehensive AML risk score
   */
  async calculateAMLRiskScore(customer, transactions = []) {
    const scores = {
      customerProfile: this.scoreCustomerProfile(customer),
      transactionBehavior: this.scoreTransactionBehavior(customer, transactions),
      geographicRisk: this.scoreGeographicRisk(customer),
      complianceHistory: this.scoreComplianceHistory(customer),
      networkRisk: this.scoreNetworkRisk(customer, transactions),
    };

    // Calculate weighted overall score
    const overallScore = 
      (scores.customerProfile * this.riskFactors.customerProfile.weight) +
      (scores.transactionBehavior * this.riskFactors.transactionBehavior.weight) +
      (scores.geographicRisk * this.riskFactors.geographicRisk.weight) +
      (scores.complianceHistory * this.riskFactors.complianceHistory.weight) +
      (scores.networkRisk * this.riskFactors.networkRisk.weight);

    const riskLevel = this.getRiskLevel(overallScore);
    const violationForecast = this.forecastViolations(scores, customer);

    // Create Asana task if high risk
    if (overallScore >= 70) {
      await this.createRiskAssessmentTask(customer, scores, overallScore, violationForecast);
    }

    return {
      customerId: customer.id,
      overallScore: Math.round(overallScore),
      riskLevel,
      scores,
      violationForecast,
      requiresEscalation: overallScore >= 80,
      requiresEnhancedDueDiligence: overallScore >= 60,
      asanaTaskCreated: overallScore >= 70,
    };
  }

  /**
   * Score customer profile risk
   */
  scoreCustomerProfile(customer) {
    let score = 0;

    if (customer.netWorth > 10000000) score += 15;
    if (customer.isPoliticallyExposed) score += 40;
    if (customer.sanctionedCountry) score += 50;
    if (customer.highRiskBusiness) score += 30;
    if (customer.onboardingDate && this.isDaysOld(customer.onboardingDate, 90)) score += 20;

    return Math.min(100, score);
  }

  /**
   * Score transaction behavior risk
   */
  scoreTransactionBehavior(customer, transactions) {
    let score = 0;

    if (!transactions || transactions.length === 0) return score;

    // Analyze transaction patterns
    const amounts = transactions.map(t => t.amount);
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const maxAmount = Math.max(...amounts);

    if (maxAmount > avgAmount * 5) score += 20; // Unusual amount
    if (transactions.length > 50 && this.isDaysOld(transactions[0].date, 30)) score += 25; // Frequency change
    if (this.detectVelocityAnomaly(transactions)) score += 30;
    if (this.detectStructuring(transactions)) score += 45;
    if (this.detectRapidMovement(transactions)) score += 35;

    return Math.min(100, score);
  }

  /**
   * Score geographic risk
   */
  scoreGeographicRisk(customer) {
    let score = 0;

    const highRiskCountries = ['North Korea', 'Iran', 'Syria', 'Sudan', 'Somalia'];
    const noFatfCountries = ['Afghanistan', 'Pakistan', 'Yemen'];

    if (highRiskCountries.includes(customer.jurisdiction)) score += 50;
    if (noFatfCountries.includes(customer.jurisdiction)) score += 30;
    if (customer.corruptionIndex < 40) score += 25; // High corruption

    return Math.min(100, score);
  }

  /**
   * Score compliance history risk
   */
  scoreComplianceHistory(customer) {
    let score = 0;

    if (customer.previousAlerts && customer.previousAlerts > 0) score += 20 * Math.min(customer.previousAlerts, 3);
    if (customer.failedKYC) score += 35;
    if (customer.regulatoryViolations) score += 40;
    if (customer.suspiciousActivityReports && customer.suspiciousActivityReports > 0) score += 30;

    return Math.min(100, score);
  }

  /**
   * Score network risk
   */
  scoreNetworkRisk(customer, transactions) {
    let score = 0;

    if (customer.beneficiaries && customer.beneficiaries.some(b => b.highRisk)) score += 25;
    if (this.detectLayering(transactions)) score += 40;
    if (customer.complexStructure) score += 30;
    if (customer.thirdPartyRisk) score += 20;

    return Math.min(100, score);
  }

  /**
   * Forecast potential violations
   */
  forecastViolations(scores, customer) {
    const violations = [];

    if (scores.customerProfile > 70) {
      violations.push({
        type: 'KYC_VIOLATION',
        probability: 'HIGH',
        regulatoryRef: 'FDL Art.5, FATF Rec.10',
        recommendation: 'Conduct enhanced due diligence immediately',
      });
    }

    if (scores.transactionBehavior > 75) {
      violations.push({
        type: 'STRUCTURING',
        probability: 'HIGH',
        regulatoryRef: 'FDL Art.1, FATF Rec.10',
        recommendation: 'File STR and investigate transaction patterns',
      });
    }

    if (scores.geographicRisk > 70) {
      violations.push({
        type: 'SANCTIONS_VIOLATION',
        probability: 'MEDIUM',
        regulatoryRef: 'Cabinet Res 74/2020',
        recommendation: 'Conduct sanctions screening and block if necessary',
      });
    }

    if (scores.complianceHistory > 60) {
      violations.push({
        type: 'REPEAT_VIOLATION',
        probability: 'HIGH',
        regulatoryRef: 'FDL Art.20',
        recommendation: 'Escalate to compliance officer and consider customer termination',
      });
    }

    return violations;
  }

  /**
   * Create Asana task for risk assessment
   */
  async createRiskAssessmentTask(customer, scores, overallScore, violations) {
    try {
      const taskName = `🎯 AML Risk Assessment: ${customer.name} - Score ${overallScore}`;

      const taskDescription = `
PREDICTIVE AML RISK ASSESSMENT
==============================

Customer: ${customer.name}
Customer ID: ${customer.id}
Overall Risk Score: ${overallScore}%
Risk Level: ${this.getRiskLevel(overallScore)}

RISK COMPONENT SCORES:
- Customer Profile: ${scores.customerProfile}%
- Transaction Behavior: ${scores.transactionBehavior}%
- Geographic Risk: ${scores.geographicRisk}%
- Compliance History: ${scores.complianceHistory}%
- Network Risk: ${scores.networkRisk}%

FORECASTED VIOLATIONS:
${violations.map(v => `
- ${v.type}
  Probability: ${v.probability}
  Regulatory Ref: ${v.regulatoryRef}
  Action: ${v.recommendation}
`).join('\n')}

REQUIRED ACTIONS:
1. Review risk assessment
2. Conduct enhanced due diligence if score > 70
3. File STR if violations detected
4. Update customer risk profile
5. Document compliance review
      `;

      const task = await this.asanaClient.tasks.create({
        workspace: this.workspaceId,
        name: taskName,
        notes: taskDescription,
        custom_fields: {
          'Risk Score': overallScore,
          'Risk Level': this.getRiskLevel(overallScore),
          'Customer ID': customer.id,
          'Forecast Violations': violations.length,
        },
      });

      console.log(`[AML Risk Scoring] ✅ Asana task created: ${task.gid}`);
      return task.gid;
    } catch (error) {
      console.error('[AML Risk Scoring] Error creating task:', error);
      return null;
    }
  }

  /**
   * Helper: Detect velocity anomaly
   */
  detectVelocityAnomaly(transactions) {
    if (transactions.length < 2) return false;
    const recent = transactions.slice(0, 5);
    const older = transactions.slice(5, 10);
    const recentVelocity = recent.length;
    const olderVelocity = older.length || 1;
    return recentVelocity > olderVelocity * 2;
  }

  /**
   * Helper: Detect structuring
   */
  detectStructuring(transactions) {
    const threshold = 10000;
    const suspiciousCount = transactions.filter(t => 
      t.amount > threshold * 0.8 && t.amount < threshold
    ).length;
    return suspiciousCount > 2;
  }

  /**
   * Helper: Detect rapid movement
   */
  detectRapidMovement(transactions) {
    if (transactions.length < 5) return false;
    const recentTransactions = transactions.slice(0, 5);
    const timeSpan = (new Date(recentTransactions[0].date) - new Date(recentTransactions[4].date)) / (1000 * 60 * 60);
    return timeSpan < 24; // 5 transactions in 24 hours
  }

  /**
   * Helper: Detect layering
   */
  detectLayering(transactions) {
    if (!transactions) return false;
    const uniqueBeneficiaries = new Set(transactions.map(t => t.beneficiary)).size;
    return uniqueBeneficiaries > transactions.length * 0.7;
  }

  /**
   * Helper: Check if date is old
   */
  isDaysOld(date, days) {
    const now = new Date();
    const dateObj = new Date(date);
    const diffTime = Math.abs(now - dateObj);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= days;
  }

  /**
   * Get risk level
   */
  getRiskLevel(score) {
    if (score >= 80) return 'CRITICAL';
    if (score >= 70) return 'HIGH';
    if (score >= 50) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Batch score multiple customers
   */
  async scoreCustomerBatch(customers, transactions = {}) {
    const results = [];
    const asanaTasksCreated = [];

    for (const customer of customers) {
      const score = await this.calculateAMLRiskScore(
        customer,
        transactions[customer.id] || []
      );
      results.push(score);
      
      if (score.asanaTaskCreated) {
        asanaTasksCreated.push(score);
      }
    }

    return {
      totalCustomers: customers.length,
      criticalRiskCount: results.filter(r => r.riskLevel === 'CRITICAL').length,
      highRiskCount: results.filter(r => r.riskLevel === 'HIGH').length,
      asanaTasksCreated: asanaTasksCreated.length,
      results,
    };
  }
}

module.exports = AMLRiskScoringEngine;
