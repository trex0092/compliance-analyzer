/**
 * goAML XML Builder for TypeScript
 * Generates UAE FIU goAML-compliant XML directly from SuspicionReport data.
 * No manual form filling — all data comes from the report + case + customer.
 */
import type { SuspicionReport } from '../domain/reports';
import type { ComplianceCase } from '../domain/cases';
import type { CustomerProfile } from '../domain/customers';

function esc(str: string | undefined | null): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function getReporterInfo(): {
  entityName: string;
  entityId: string;
  country: string;
  city: string;
  contactPerson: string;
  phone: string;
  email: string;
} {
  let companies: Array<{
    name?: string;
    licenseNo?: string;
    city?: string;
    complianceOfficer?: string;
    phone?: string;
    email?: string;
  }> = [];
  try {
    companies = JSON.parse(localStorage.getItem('fgl_companies') || '[]');
  } catch {
    companies = [];
  }
  const activeIdx = Number(localStorage.getItem('fgl_active_company') || '0');
  const company = companies[activeIdx] || {};
  return {
    entityName: company.name || 'Reporting Entity',
    entityId: company.licenseNo || '',
    country: 'AE',
    city: company.city || 'Dubai',
    contactPerson: company.complianceOfficer || '',
    phone: company.phone || '',
    email: company.email || '',
  };
}

/** Map severity to goAML priority */
function severityToPriority(severity?: string): string {
  if (severity === 'critical' || severity === 'high') return 'HIGH';
  if (severity === 'medium') return 'MEDIUM';
  return 'LOW';
}

/**
 * Build goAML XML from a SuspicionReport, optionally enriched with
 * linked case and customer data.
 */
export function buildGoAMLXml(
  report: SuspicionReport,
  linkedCase?: ComplianceCase,
  linkedCustomer?: CustomerProfile
): string {
  const reporter = getReporterInfo();
  const now = new Date().toISOString();
  const dateOnly = today();

  // Determine subject info from multiple sources
  const subjectName =
    report.entityName || linkedCustomer?.legalName || linkedCase?.entityId || report.caseId;
  const subjectType =
    linkedCustomer?.type === 'supplier' || linkedCustomer?.type === 'agent'
      ? 'LEGAL_ENTITY'
      : 'LEGAL_ENTITY';
  const subjectCountry =
    linkedCustomer?.countryOfRegistration || report.parties?.[0]?.country || 'AE';
  const subjectIdType = linkedCustomer?.tradeLicenseNo ? 'TRADE_LICENSE' : 'OTHER';
  const subjectIdNumber = linkedCustomer?.tradeLicenseNo || '';

  // Transaction info
  const firstTx = report.transactions?.[0];
  const txAmount = firstTx?.amount ?? report.amount ?? 0;
  const txCurrency = firstTx?.currency ?? report.currency ?? 'AED';
  const txDate = firstTx?.date ? firstTx.date.slice(0, 10) : dateOnly;

  // Report type specific fields
  const isCTR = report.reportType === 'CTR';
  const isFFR = report.reportType === 'FFR';

  // Build transactions XML
  const transactionsXml = (report.transactions || [])
    .map(
      (tx, i) => `
    <transaction seq="${i + 1}">
      <transactionDate>${esc(tx.date?.slice(0, 10) || dateOnly)}</transactionDate>
      <transactionType>${esc(tx.paymentMethod || 'PURCHASE')}</transactionType>
      <amount>${esc(String(tx.amount || txAmount))}</amount>
      <currency>${esc(tx.currency || txCurrency)}</currency>
      <description>${esc(tx.summary)}</description>
      <originCountry>${esc(tx.originCountry || '')}</originCountry>
      <destinationCountry>${esc(tx.destinationCountry || 'AE')}</destinationCountry>
    </transaction>`
    )
    .join('\n');

  // Build red flags XML
  const redFlagsXml = (report.redFlags || []).map((f) => `      <flag>${esc(f)}</flag>`).join('\n');

  // Build parties XML
  const partiesXml = (report.parties || [])
    .map(
      (p) => `
    <party>
      <role>${esc(p.role)}</role>
      <name>${esc(p.role === 'subject' ? subjectName : p.name)}</name>
      <country>${esc(p.country || subjectCountry)}</country>
      <idType>${esc(p.idType || subjectIdType)}</idType>
      <idNumber>${esc(p.idNumber || subjectIdNumber)}</idNumber>
    </party>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<goAMLReport>
  <reportHeader>
    <reportId>${esc(report.id)}</reportId>
    <reportType>${esc(report.reportType)}</reportType>
    <reportDate>${dateOnly}</reportDate>
    <reportStatus>NEW</reportStatus>
    <priority>${severityToPriority(report.severity)}</priority>
    <currency>${esc(txCurrency)}</currency>
    <reportingCountry>AE</reportingCountry>
    <regulatoryBasis>${esc(report.regulatoryBasis || '')}</regulatoryBasis>
  </reportHeader>

  <reportingEntity>
    <entityName>${esc(reporter.entityName)}</entityName>
    <entityIdentification>${esc(reporter.entityId)}</entityIdentification>
    <entityType>DPMS</entityType>
    <country>${esc(reporter.country)}</country>
    <city>${esc(reporter.city)}</city>
    <contactPerson>
      <name>${esc(reporter.contactPerson)}</name>
      <phone>${esc(reporter.phone)}</phone>
      <email>${esc(reporter.email)}</email>
    </contactPerson>
  </reportingEntity>

  <suspiciousSubject>
    <subjectType>${esc(subjectType)}</subjectType>
    <fullName>${esc(subjectName)}</fullName>
    <nationality>${esc(subjectCountry)}</nationality>
    <idType>${esc(subjectIdType)}</idType>
    <idNumber>${esc(subjectIdNumber)}</idNumber>
    <address>
      <city>${esc(linkedCustomer?.location || '')}</city>
      <country>${esc(subjectCountry)}</country>
    </address>
  </suspiciousSubject>

  <parties>
${partiesXml}
  </parties>

  <transactionDetails>
    <primaryTransaction>
      <transactionDate>${esc(txDate)}</transactionDate>
      <transactionType>PURCHASE</transactionType>
      <amount>${esc(String(txAmount))}</amount>
      <currency>${esc(txCurrency)}</currency>
      <currencyLocal>AED</currencyLocal>${
        isCTR
          ? `
      <thresholdBasis>UAE FDL No.10/2025 Art.16 — AED 55,000 DPMS threshold</thresholdBasis>`
          : ''
      }${
        report.commodityType
          ? `
      <commodityType>${esc(report.commodityType)}</commodityType>`
          : ''
      }${
        report.weightGrams
          ? `
      <weightGrams>${report.weightGrams}</weightGrams>`
          : ''
      }${
        report.purity
          ? `
      <purity>${report.purity}</purity>`
          : ''
      }
      <paymentMethod>${esc(firstTx?.paymentMethod || 'CASH')}</paymentMethod>
    </primaryTransaction>
${transactionsXml}
  </transactionDetails>

  <groundsForSuspicion>
    <indicators>${esc(report.reasonForSuspicion)}</indicators>
    <narrativeDescription>${esc(report.reasonForSuspicion)}</narrativeDescription>
    <redFlagCategories>
${redFlagsXml}
    </redFlagCategories>
    <facts>
${(report.facts || []).map((f) => `      <fact>${esc(f)}</fact>`).join('\n')}
    </facts>
    <actionsTaken>Filed ${report.reportType} with UAE FIU via goAML</actionsTaken>
    <internalCaseRef>${esc(report.caseId)}</internalCaseRef>${
      isFFR
        ? `
    <freezeOrderBasis>Cabinet Resolution 74/2020 Art.4-7</freezeOrderBasis>`
        : ''
    }
  </groundsForSuspicion>

  <riskAssessment>
    <severity>${esc(report.severity || 'medium')}</severity>${
      report.riskAssessmentSummary
        ? `
    <summary>${esc(report.riskAssessmentSummary)}</summary>`
        : ''
    }${
      report.sourceOfProceeds
        ? `
    <sourceOfProceeds>${esc(report.sourceOfProceeds)}</sourceOfProceeds>`
        : ''
    }${
      report.useOfProceeds
        ? `
    <useOfProceeds>${esc(report.useOfProceeds)}</useOfProceeds>`
        : ''
    }
  </riskAssessment>

  <reportFooter>
    <generatedBy>Hawkeye Sterling V2</generatedBy>
    <generatedAt>${now}</generatedAt>
    <disclaimer>This report was generated by an automated compliance tool. All information should be verified by the designated Compliance Officer before submission to the UAE FIU via goAML.</disclaimer>
  </reportFooter>
</goAMLReport>`;
}

/**
 * Generate goAML XML and trigger browser download.
 * Returns the XML string and filename.
 */
export function downloadGoAMLXml(
  report: SuspicionReport,
  linkedCase?: ComplianceCase,
  linkedCustomer?: CustomerProfile
): { xml: string; filename: string } {
  const xml = buildGoAMLXml(report, linkedCase, linkedCustomer);
  const filename = `goAML_${report.reportType}_${report.id}_${today()}.xml`;

  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return { xml, filename };
}
