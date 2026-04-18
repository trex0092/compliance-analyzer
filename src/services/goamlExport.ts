/**
 * goAML XML export — UAE FIU schema for STR / SAR / CTR / DPMSR / CNMR.
 *
 * This is a lightweight, schema-compliant builder — NOT a full goAML
 * XSD validator. A deployment that actually files with the FIU should
 * run the output through `src/utils/goamlValidator.ts` before
 * submission.
 *
 * Schema reference: UAE FIU goAML 4.x / 5.x.
 */

export type GoamlReportType = 'STR' | 'SAR' | 'CTR' | 'DPMSR' | 'CNMR';

export interface GoamlReporter {
  orgName: string;
  licenceNumber: string;
  reporterName: string;
  reporterEmail: string;
  reporterPhone?: string;
}

export interface GoamlSubject {
  subjectId: string;
  firstName?: string;
  lastName?: string;
  entityName?: string;
  dob?: string;
  nationality?: string;
  passportNumber?: string;
  idNumber?: string;
  address?: string;
}

export interface GoamlTransaction {
  transactionId: string;
  date: string;
  amount: number;
  currency: string;
  description?: string;
  counterpartyName?: string;
  counterpartyAccount?: string;
}

export interface GoamlReport {
  reportType: GoamlReportType;
  reportRef: string;
  submittedAt: string;
  reporter: GoamlReporter;
  subject: GoamlSubject;
  transactions?: GoamlTransaction[];
  reasonForSuspicion: string;
  /** Regulatory citations supporting the filing. */
  citations: string[];
}

export function toGoamlXml(report: GoamlReport): string {
  const esc = (s: string | number | undefined): string => {
    if (s === undefined || s === null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  const txs = (report.transactions ?? [])
    .map(
      (t) => `    <transaction>
      <transactionnumber>${esc(t.transactionId)}</transactionnumber>
      <date_transaction>${esc(t.date)}</date_transaction>
      <amount_local>${esc(t.amount)}</amount_local>
      <transmode_code>${esc(t.currency)}</transmode_code>
      ${t.description ? `<transaction_description>${esc(t.description)}</transaction_description>` : ''}
      ${t.counterpartyName ? `<t_from_my_client><from_funds_code>${esc(t.counterpartyName)}</from_funds_code></t_from_my_client>` : ''}
    </transaction>`
    )
    .join('\n');

  const isIndividual = !!report.subject.firstName || !!report.subject.lastName;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<report>
  <rentity_id>${esc(report.reporter.licenceNumber)}</rentity_id>
  <rentity_branch>${esc(report.reporter.orgName)}</rentity_branch>
  <submission_code>E</submission_code>
  <report_code>${esc(report.reportType)}</report_code>
  <entity_reference>${esc(report.reportRef)}</entity_reference>
  <submission_date>${esc(report.submittedAt)}</submission_date>
  <currency_code_local>AED</currency_code_local>
  <reporting_person>
    <first_name>${esc(report.reporter.reporterName)}</first_name>
    <email>${esc(report.reporter.reporterEmail)}</email>
    ${report.reporter.reporterPhone ? `<phone_number>${esc(report.reporter.reporterPhone)}</phone_number>` : ''}
  </reporting_person>
  ${
    isIndividual
      ? `<report_indiv_person>
    <first_name>${esc(report.subject.firstName)}</first_name>
    <last_name>${esc(report.subject.lastName)}</last_name>
    ${report.subject.dob ? `<birthdate>${esc(report.subject.dob)}</birthdate>` : ''}
    ${report.subject.nationality ? `<nationality1>${esc(report.subject.nationality)}</nationality1>` : ''}
    ${report.subject.passportNumber ? `<passport_number>${esc(report.subject.passportNumber)}</passport_number>` : ''}
    ${report.subject.idNumber ? `<id_number>${esc(report.subject.idNumber)}</id_number>` : ''}
    ${report.subject.address ? `<addresses><address><address>${esc(report.subject.address)}</address></address></addresses>` : ''}
  </report_indiv_person>`
      : `<report_entity>
    <name>${esc(report.subject.entityName)}</name>
    ${report.subject.idNumber ? `<incorporation_number>${esc(report.subject.idNumber)}</incorporation_number>` : ''}
  </report_entity>`
  }
  <reason>${esc(report.reasonForSuspicion)}</reason>
  <action>FILED</action>
  <citations>
${report.citations.map((c) => `    <citation>${esc(c)}</citation>`).join('\n')}
  </citations>
  ${txs ? `<transactions>\n${txs}\n  </transactions>` : ''}
</report>`;
  return xml;
}
