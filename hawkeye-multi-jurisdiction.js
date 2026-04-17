/**
 * Hawkeye Sterling V2 - Multi-Jurisdiction Compliance Engine
 * TIER 2: Support UAE, MENA, Global regulations
 * Auto-creates Asana tasks for jurisdiction-specific compliance
 */

class MultiJurisdictionComplianceEngine {
  constructor(asanaClient, config = {}) {
    this.asanaClient = asanaClient;
    this.workspaceId = '1213645083721316';
    this.config = config;
    this.jurisdictions = this.initializeJurisdictions();
  }

  /**
   * Initialize jurisdiction-specific regulations
   */
  initializeJurisdictions() {
    return {
      UAE: {
        name: 'United Arab Emirates',
        region: 'MENA',
        regulations: [
          'FDL No. 20/2018',
          'Cabinet Resolution 74/2020',
          'Cabinet Resolution 134/2025',
          'Cabinet Resolution 156/2025',
          'MoE Circular 08/AML/2021',
        ],
        requirements: {
          kyc: { mandatory: true, frequency: 'ongoing' },
          cdd: { mandatory: true, frequency: 'ongoing' },
          pep: { mandatory: true, frequency: 'annual' },
          sanctions: { mandatory: true, frequency: 'real-time' },
          str: { mandatory: true, deadline: '10 days' },
          aml_training: { mandatory: true, frequency: 'annual' },
        },
        riskProfile: 'MEDIUM',
      },
      SA: {
        name: 'Saudi Arabia',
        region: 'MENA',
        regulations: [
          'AML Law 2004',
          'SAMA Regulations',
          'Cabinet Decree 2020',
        ],
        requirements: {
          kyc: { mandatory: true, frequency: 'ongoing' },
          cdd: { mandatory: true, frequency: 'ongoing' },
          pep: { mandatory: true, frequency: 'annual' },
          sanctions: { mandatory: true, frequency: 'real-time' },
          str: { mandatory: true, deadline: '15 days' },
          aml_training: { mandatory: true, frequency: 'annual' },
        },
        riskProfile: 'MEDIUM',
      },
      KW: {
        name: 'Kuwait',
        region: 'MENA',
        regulations: [
          'AML Law 2002',
          'CBK Regulations',
        ],
        requirements: {
          kyc: { mandatory: true, frequency: 'ongoing' },
          cdd: { mandatory: true, frequency: 'ongoing' },
          pep: { mandatory: true, frequency: 'annual' },
          sanctions: { mandatory: true, frequency: 'real-time' },
          str: { mandatory: true, deadline: '20 days' },
          aml_training: { mandatory: true, frequency: 'annual' },
        },
        riskProfile: 'MEDIUM',
      },
      UK: {
        name: 'United Kingdom',
        region: 'Europe',
        regulations: [
          'Proceeds of Crime Act 2002',
          'Money Laundering Regulations 2017',
          'Terrorism Act 2000',
        ],
        requirements: {
          kyc: { mandatory: true, frequency: 'ongoing' },
          cdd: { mandatory: true, frequency: 'ongoing' },
          pep: { mandatory: true, frequency: 'annual' },
          sanctions: { mandatory: true, frequency: 'real-time' },
          str: { mandatory: true, deadline: 'immediately' },
          aml_training: { mandatory: true, frequency: 'annual' },
        },
        riskProfile: 'LOW',
      },
      US: {
        name: 'United States',
        region: 'Americas',
        regulations: [
          'Bank Secrecy Act',
          'Anti-Money Laundering Act',
          'OFAC Regulations',
        ],
        requirements: {
          kyc: { mandatory: true, frequency: 'ongoing' },
          cdd: { mandatory: true, frequency: 'ongoing' },
          pep: { mandatory: true, frequency: 'annual' },
          sanctions: { mandatory: true, frequency: 'real-time' },
          str: { mandatory: true, deadline: '30 days' },
          aml_training: { mandatory: true, frequency: 'annual' },
        },
        riskProfile: 'LOW',
      },
      SG: {
        name: 'Singapore',
        region: 'Asia-Pacific',
        regulations: [
          'Prevention of Money Laundering Act',
          'MAS Guidelines',
        ],
        requirements: {
          kyc: { mandatory: true, frequency: 'ongoing' },
          cdd: { mandatory: true, frequency: 'ongoing' },
          pep: { mandatory: true, frequency: 'annual' },
          sanctions: { mandatory: true, frequency: 'real-time' },
          str: { mandatory: true, deadline: '10 days' },
          aml_training: { mandatory: true, frequency: 'annual' },
        },
        riskProfile: 'LOW',
      },
    };
  }

  /**
   * Check compliance for specific jurisdiction
   */
  async checkJurisdictionCompliance(entity, jurisdictionCode) {
    const jurisdiction = this.jurisdictions[jurisdictionCode];
    
    if (!jurisdiction) {
      throw new Error(`Jurisdiction ${jurisdictionCode} not found`);
    }

    const complianceStatus = {
      entity: entity.id,
      jurisdiction: jurisdictionCode,
      jurisdictionName: jurisdiction.name,
      region: jurisdiction.region,
      checkDate: new Date().toISOString(),
      requirements: {},
      gaps: [],
      complianceScore: 100,
    };

    // Check each requirement
    for (const [requirement, details] of Object.entries(jurisdiction.requirements)) {
      const status = this.checkRequirement(entity, requirement, details);
      complianceStatus.requirements[requirement] = status;

      if (!status.compliant) {
        complianceStatus.gaps.push({
          requirement,
          details,
          status: status.status,
          action: this.getRequiredAction(requirement, jurisdictionCode),
        });
        complianceStatus.complianceScore -= 10;
      }
    }

    // Create Asana task if gaps exist
    if (complianceStatus.gaps.length > 0) {
      await this.createJurisdictionComplianceTask(entity, jurisdiction, complianceStatus);
    }

    return complianceStatus;
  }

  /**
   * Check individual requirement
   */
  checkRequirement(entity, requirement, details) {
    let compliant = true;
    let status = 'COMPLIANT';

    switch (requirement) {
      case 'kyc':
        compliant = entity.kycVerified && entity.kycDate;
        status = compliant ? 'VERIFIED' : 'PENDING';
        break;
      case 'cdd':
        compliant = entity.cddCompleted && entity.cddDate;
        status = compliant ? 'COMPLETED' : 'PENDING';
        break;
      case 'pep':
        compliant = entity.pepScreeningCompleted;
        status = compliant ? 'SCREENED' : 'PENDING';
        break;
      case 'sanctions':
        compliant = entity.sanctionsScreeningCompleted;
        status = compliant ? 'SCREENED' : 'PENDING';
        break;
      case 'str':
        compliant = !entity.suspiciousActivityDetected || entity.strFiled;
        status = compliant ? 'COMPLIANT' : 'PENDING';
        break;
      case 'aml_training':
        compliant = entity.amlTrainingCompleted && entity.amlTrainingDate;
        status = compliant ? 'COMPLETED' : 'PENDING';
        break;
    }

    return { compliant, status };
  }

  /**
   * Get required action for jurisdiction
   */
  getRequiredAction(requirement, jurisdictionCode) {
    const actions = {
      kyc: 'Conduct Know Your Customer verification',
      cdd: 'Complete Customer Due Diligence',
      pep: 'Screen against PEP databases',
      sanctions: 'Screen against sanctions lists',
      str: 'File Suspicious Transaction Report',
      aml_training: 'Complete AML training program',
    };

    return actions[requirement] || 'Review compliance requirement';
  }

  /**
   * Create Asana task for jurisdiction compliance
   */
  async createJurisdictionComplianceTask(entity, jurisdiction, status) {
    try {
      const taskName = `🌍 Jurisdiction Compliance: ${entity.name} - ${jurisdiction.name}`;

      const taskDescription = `
MULTI-JURISDICTION COMPLIANCE CHECK
====================================

Entity: ${entity.name}
Entity ID: ${entity.id}
Jurisdiction: ${jurisdiction.name} (${jurisdiction.region})

COMPLIANCE SCORE: ${status.complianceScore}%

APPLICABLE REGULATIONS:
${jurisdiction.regulations.map(r => `- ${r}`).join('\n')}

COMPLIANCE GAPS:
${status.gaps.map(g => `
- ${g.requirement.toUpperCase()}
  Status: ${g.status}
  Action: ${g.action}
  Frequency: ${g.details.frequency}
  Mandatory: ${g.details.mandatory ? 'Yes' : 'No'}
`).join('\n')}

REQUIREMENTS CHECKLIST:
${Object.entries(status.requirements).map(([req, stat]) => `
- [${stat.compliant ? 'x' : ' '}] ${req.toUpperCase()}: ${stat.status}
`).join('\n')}

RISK PROFILE: ${jurisdiction.riskProfile}

ACTION REQUIRED:
1. Review compliance gaps
2. Implement required actions
3. Document compliance evidence
4. Schedule follow-up review
      `;

      const task = await this.asanaClient.tasks.create({
        workspace: this.workspaceId,
        name: taskName,
        notes: taskDescription,
        custom_fields: {
          'Jurisdiction': jurisdiction.name,
          'Compliance Score': status.complianceScore,
          'Gaps Count': status.gaps.length,
          'Entity ID': entity.id,
        },
      });

      console.log(`[Multi-Jurisdiction] ✅ Jurisdiction compliance task created: ${task.gid}`);
      return task.gid;
    } catch (error) {
      console.error('[Multi-Jurisdiction] Error creating task:', error);
      return null;
    }
  }

  /**
   * Check compliance across multiple jurisdictions
   */
  async checkMultiJurisdictionCompliance(entity, jurisdictionCodes) {
    const results = {
      entity: entity.id,
      checkDate: new Date().toISOString(),
      jurisdictions: {},
      overallComplianceScore: 0,
      highestRiskJurisdiction: null,
    };

    let totalScore = 0;
    let maxRisk = 0;

    for (const code of jurisdictionCodes) {
      const compliance = await this.checkJurisdictionCompliance(entity, code);
      results.jurisdictions[code] = compliance;
      totalScore += compliance.complianceScore;

      if (compliance.gaps.length > maxRisk) {
        maxRisk = compliance.gaps.length;
        results.highestRiskJurisdiction = code;
      }
    }

    results.overallComplianceScore = Math.round(totalScore / jurisdictionCodes.length);

    return results;
  }

  /**
   * Generate multi-jurisdiction compliance report
   */
  async generateMultiJurisdictionReport(entities, jurisdictionCodes) {
    const report = {
      generatedAt: new Date().toISOString(),
      jurisdictions: jurisdictionCodes,
      entities: entities.length,
      complianceByJurisdiction: {},
      overallComplianceScore: 0,
      criticalGaps: 0,
      recommendations: [],
    };

    for (const code of jurisdictionCodes) {
      report.complianceByJurisdiction[code] = {
        jurisdiction: this.jurisdictions[code].name,
        entitiesChecked: 0,
        averageScore: 0,
        gaps: 0,
      };
    }

    // Analyze each entity
    for (const entity of entities) {
      const compliance = await this.checkMultiJurisdictionCompliance(entity, jurisdictionCodes);
      
      for (const [code, status] of Object.entries(compliance.jurisdictions)) {
        report.complianceByJurisdiction[code].entitiesChecked++;
        report.complianceByJurisdiction[code].averageScore += status.complianceScore;
        report.complianceByJurisdiction[code].gaps += status.gaps.length;
      }
    }

    // Calculate averages
    for (const code of jurisdictionCodes) {
      const data = report.complianceByJurisdiction[code];
      data.averageScore = Math.round(data.averageScore / data.entitiesChecked);
    }

    // Calculate overall score
    const allScores = Object.values(report.complianceByJurisdiction).map(j => j.averageScore);
    report.overallComplianceScore = Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length);

    return report;
  }

  /**
   * Get jurisdiction risk profile
   */
  getJurisdictionRiskProfile(jurisdictionCode) {
    const jurisdiction = this.jurisdictions[jurisdictionCode];
    return {
      jurisdiction: jurisdiction.name,
      riskProfile: jurisdiction.riskProfile,
      regulations: jurisdiction.regulations,
      requirements: jurisdiction.requirements,
    };
  }

  /**
   * List all supported jurisdictions
   */
  listSupportedJurisdictions() {
    return Object.entries(this.jurisdictions).map(([code, data]) => ({
      code,
      name: data.name,
      region: data.region,
      riskProfile: data.riskProfile,
    }));
  }
}

module.exports = MultiJurisdictionComplianceEngine;
