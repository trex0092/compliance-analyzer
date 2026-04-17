/**
 * Hawkeye Sterling V2 - Automated Regulatory Compliance Checker
 * Auto-checks against FATF, FDL, Cabinet Resolutions
 * Creates Asana tasks for compliance gaps
 */

class RegulatoryComplianceChecker {
  constructor(asanaClient, config = {}) {
    this.asanaClient = asanaClient;
    this.workspaceId = '1213645083721316';
    this.config = config;
    this.regulations = this.initializeRegulations();
  }

  /**
   * Initialize regulatory frameworks
   */
  initializeRegulations() {
    return {
      FDL: {
        name: 'Federal Decree-Law No. 20/2018',
        articles: {
          'Art.1': {
            title: 'Definition of Money Laundering',
            requirements: [
              'Identify suspicious transactions',
              'Report within 10 days',
              'Maintain confidentiality',
            ],
          },
          'Art.5': {
            title: 'Know Your Customer (KYC)',
            requirements: [
              'Verify customer identity',
              'Obtain beneficial ownership information',
              'Conduct ongoing due diligence',
            ],
          },
          'Art.20': {
            title: 'Suspicious Transaction Reporting',
            requirements: [
              'File STR within 10 days',
              'Include all relevant information',
              'Maintain confidentiality',
            ],
          },
          'Art.29': {
            title: 'Tipping-Off Prohibition',
            requirements: [
              'Do not inform customer of STR filing',
              'Do not disclose investigation',
              'Maintain secrecy',
            ],
          },
        },
      },
      FATF: {
        name: 'Financial Action Task Force Recommendations',
        recommendations: {
          'Rec.10': {
            title: 'Customer Due Diligence',
            requirements: [
              'Verify customer identity',
              'Understand nature of business',
              'Conduct ongoing monitoring',
            ],
          },
          'Rec.12': {
            title: 'Politically Exposed Persons',
            requirements: [
              'Identify PEPs',
              'Obtain senior management approval',
              'Conduct enhanced due diligence',
            ],
          },
          'Rec.19': {
            title: 'Suspicious Activity Reporting',
            requirements: [
              'Report suspicious transactions',
              'Maintain confidentiality',
              'Cooperate with authorities',
            ],
          },
        },
      },
      CabinetResolutions: {
        name: 'UAE Cabinet Resolutions',
        resolutions: {
          'Res.74/2020': {
            title: 'Sanctions Compliance',
            requirements: [
              'Screen against OFAC list',
              'Screen against UN list',
              'Screen against EU list',
            ],
          },
          'Res.134/2025': {
            title: 'Enhanced AML Measures',
            requirements: [
              'Implement transaction monitoring',
              'Establish compliance program',
              'Train staff on AML',
            ],
          },
        },
      },
    };
  }

  /**
   * Check compliance against all regulations
   */
  async checkFullCompliance(entity) {
    const results = {
      entityId: entity.id,
      entityName: entity.name,
      checkDate: new Date().toISOString(),
      complianceGaps: [],
      complianceScore: 100,
      overallStatus: 'COMPLIANT',
    };

    // Check each regulatory framework
    const fdlGaps = this.checkFDLCompliance(entity);
    const fatfGaps = this.checkFATFCompliance(entity);
    const cabinetGaps = this.checkCabinetCompliance(entity);

    results.complianceGaps.push(...fdlGaps, ...fatfGaps, ...cabinetGaps);

    // Calculate compliance score
    const totalRequirements = Object.values(this.regulations).reduce((acc, reg) => {
      return acc + Object.keys(reg.articles || reg.recommendations || reg.resolutions).length;
    }, 0);

    results.complianceScore = Math.round(
      ((totalRequirements - results.complianceGaps.length) / totalRequirements) * 100
    );

    // Determine overall status
    if (results.complianceGaps.length > 0) {
      results.overallStatus = results.complianceScore >= 80 ? 'MINOR_GAPS' : 'MAJOR_GAPS';
    }

    // Create Asana tasks for gaps
    if (results.complianceGaps.length > 0) {
      await this.createComplianceGapTasks(entity, results.complianceGaps);
    }

    return results;
  }

  /**
   * Check FDL compliance
   */
  checkFDLCompliance(entity) {
    const gaps = [];

    // Check Art.5 - KYC
    if (!entity.kycVerified) {
      gaps.push({
        regulation: 'FDL',
        article: 'Art.5',
        requirement: 'Know Your Customer (KYC)',
        gap: 'KYC verification not completed',
        severity: 'CRITICAL',
        action: 'Conduct full KYC verification',
      });
    }

    // Check Art.20 - STR Reporting
    if (entity.suspiciousActivityDetected && !entity.strFiled) {
      gaps.push({
        regulation: 'FDL',
        article: 'Art.20',
        requirement: 'Suspicious Transaction Reporting',
        gap: 'STR not filed within 10 days',
        severity: 'CRITICAL',
        action: 'File STR immediately',
      });
    }

    // Check Art.29 - Tipping-Off
    if (entity.customerNotifiedOfInvestigation) {
      gaps.push({
        regulation: 'FDL',
        article: 'Art.29',
        requirement: 'Tipping-Off Prohibition',
        gap: 'Customer was informed of investigation',
        severity: 'CRITICAL',
        action: 'Review tipping-off procedures',
      });
    }

    return gaps;
  }

  /**
   * Check FATF compliance
   */
  checkFATFCompliance(entity) {
    const gaps = [];

    // Check Rec.10 - CDD
    if (!entity.cddCompleted) {
      gaps.push({
        regulation: 'FATF',
        recommendation: 'Rec.10',
        requirement: 'Customer Due Diligence',
        gap: 'CDD not completed',
        severity: 'HIGH',
        action: 'Complete customer due diligence',
      });
    }

    // Check Rec.12 - PEPs
    if (entity.isPEP && !entity.pepVerified) {
      gaps.push({
        regulation: 'FATF',
        recommendation: 'Rec.12',
        requirement: 'Politically Exposed Persons',
        gap: 'PEP not properly verified',
        severity: 'HIGH',
        action: 'Conduct PEP verification and obtain senior management approval',
      });
    }

    // Check Rec.19 - SAR
    if (entity.suspiciousActivityDetected && !entity.sarFiled) {
      gaps.push({
        regulation: 'FATF',
        recommendation: 'Rec.19',
        requirement: 'Suspicious Activity Reporting',
        gap: 'SAR not filed',
        severity: 'CRITICAL',
        action: 'File SAR with competent authorities',
      });
    }

    return gaps;
  }

  /**
   * Check Cabinet Resolution compliance
   */
  checkCabinetCompliance(entity) {
    const gaps = [];

    // Check Res.74/2020 - Sanctions
    if (!entity.sanctionsScreeningCompleted) {
      gaps.push({
        regulation: 'Cabinet Resolution',
        resolution: 'Res.74/2020',
        requirement: 'Sanctions Compliance',
        gap: 'Sanctions screening not completed',
        severity: 'CRITICAL',
        action: 'Screen against OFAC, UN, and EU sanctions lists',
      });
    }

    // Check Res.134/2025 - AML Measures
    if (!entity.amlProgramImplemented) {
      gaps.push({
        regulation: 'Cabinet Resolution',
        resolution: 'Res.134/2025',
        requirement: 'Enhanced AML Measures',
        gap: 'AML program not implemented',
        severity: 'HIGH',
        action: 'Implement comprehensive AML program',
      });
    }

    return gaps;
  }

  /**
   * Create Asana tasks for compliance gaps
   */
  async createComplianceGapTasks(entity, gaps) {
    try {
      for (const gap of gaps) {
        const taskName = `📋 Compliance Gap: ${gap.regulation} ${gap.article || gap.recommendation || gap.resolution}`;

        const taskDescription = `
REGULATORY COMPLIANCE GAP
=========================

Entity: ${entity.name}
Entity ID: ${entity.id}

Regulation: ${gap.regulation}
${gap.article ? `Article: ${gap.article}` : ''}
${gap.recommendation ? `Recommendation: ${gap.recommendation}` : ''}
${gap.resolution ? `Resolution: ${gap.resolution}` : ''}

Requirement: ${gap.requirement}
Gap: ${gap.gap}
Severity: ${gap.severity}

ACTION REQUIRED:
${gap.action}

DEADLINE: Immediate (Critical) or 30 days (High/Medium)

REGULATORY REFERENCE:
- ${gap.regulation} ${gap.article || gap.recommendation || gap.resolution}
        `;

        const task = await this.asanaClient.tasks.create({
          workspace: this.workspaceId,
          name: taskName,
          notes: taskDescription,
          priority: gap.severity === 'CRITICAL' ? 'urgent' : 'high',
          custom_fields: {
            'Regulation': gap.regulation,
            'Gap Type': gap.requirement,
            'Severity': gap.severity,
            'Entity ID': entity.id,
          },
        });

        console.log(`[Regulatory Compliance] ✅ Compliance gap task created: ${task.gid}`);
      }
    } catch (error) {
      console.error('[Regulatory Compliance] Error creating gap tasks:', error);
    }
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(entities) {
    const report = {
      generatedAt: new Date().toISOString(),
      totalEntities: entities.length,
      complianceByEntity: [],
      overallComplianceScore: 0,
      criticalGaps: 0,
      highGaps: 0,
      mediumGaps: 0,
    };

    for (const entity of entities) {
      const compliance = await this.checkFullCompliance(entity);
      report.complianceByEntity.push(compliance);

      // Count gaps by severity
      compliance.complianceGaps.forEach(gap => {
        if (gap.severity === 'CRITICAL') report.criticalGaps++;
        else if (gap.severity === 'HIGH') report.highGaps++;
        else if (gap.severity === 'MEDIUM') report.mediumGaps++;
      });
    }

    // Calculate overall score
    const totalScores = report.complianceByEntity.reduce((acc, c) => acc + c.complianceScore, 0);
    report.overallComplianceScore = Math.round(totalScores / entities.length);

    return report;
  }

  /**
   * Get regulatory updates
   */
  async getRegulatoryUpdates() {
    return {
      updates: [
        {
          date: '2026-04-17',
          regulation: 'FDL',
          update: 'New guidance on beneficial ownership verification',
          impact: 'HIGH',
        },
        {
          date: '2026-04-10',
          regulation: 'FATF',
          update: 'Updated PEP definition to include family members',
          impact: 'MEDIUM',
        },
      ],
      lastUpdated: new Date().toISOString(),
    };
  }
}

module.exports = RegulatoryComplianceChecker;
