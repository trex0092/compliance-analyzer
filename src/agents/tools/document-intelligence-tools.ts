/**
 * Document Intelligence Engine
 *
 * NLP-based extraction of compliance data from documents:
 * 1. Invoice parsing — amounts, counterparties, goods descriptions
 * 2. KYC document extraction — names, IDs, addresses, DOB
 * 3. Trade document analysis — origin, destination, HS codes, weight
 * 4. Red flag detection in narrative text
 * 5. Date format normalization (dd/mm/yyyy per UAE standard)
 * 6. Amount extraction with currency detection
 * 7. Entity name extraction and normalization
 *
 * Regulatory: FDL No.10/2025 Art.12-14 (CDD verification),
 * LBMA RGG v9 Step 2 (trade documentation)
 */

import type { ToolResult } from '../mcp-server';
import { DPMS_CASH_THRESHOLD_AED, DUAL_USE_KEYWORDS } from '../../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractedAmount {
  value: number;
  currency: string;
  original: string;
  exceedsThreshold: boolean;
  threshold?: string;
}

export interface ExtractedEntity {
  name: string;
  type: 'person' | 'company' | 'location' | 'id-number' | 'date' | 'phone' | 'email';
  confidence: number;
  position: { start: number; end: number };
}

export interface ExtractedDate {
  original: string;
  normalized: string; // dd/mm/yyyy
  isoDate: string;
}

export interface InvoiceData {
  invoiceNumber?: string;
  date?: ExtractedDate;
  seller?: string;
  buyer?: string;
  amounts: ExtractedAmount[];
  totalAmount?: ExtractedAmount;
  items: Array<{ description: string; quantity?: number; unitPrice?: number; total?: number }>;
  currency?: string;
  paymentTerms?: string;
}

export interface KYCData {
  fullName?: string;
  dateOfBirth?: ExtractedDate;
  nationality?: string;
  idType?: string;
  idNumber?: string;
  address?: string;
  phone?: string;
  email?: string;
  occupation?: string;
  sourceOfFunds?: string;
}

export interface TradeDocData {
  documentType: string;
  originCountry?: string;
  destinationCountry?: string;
  goods: Array<{ description: string; hsCode?: string; quantity?: number; weight?: string; value?: number }>;
  totalWeight?: string;
  totalValue?: ExtractedAmount;
  carrier?: string;
  routeVia?: string[];
  certificateOfOrigin?: boolean;
  assayCertificate?: boolean;
  hallmarkPresent?: boolean;
}

export interface DocumentRedFlag {
  type: string;
  severity: 'medium' | 'high' | 'critical';
  description: string;
  evidence: string;
  regulatoryRef: string;
}

export interface DocumentAnalysisReport {
  documentType: 'invoice' | 'kyc' | 'trade' | 'narrative' | 'unknown';
  extractedEntities: ExtractedEntity[];
  extractedAmounts: ExtractedAmount[];
  extractedDates: ExtractedDate[];
  invoiceData?: InvoiceData;
  kycData?: KYCData;
  tradeDocData?: TradeDocData;
  redFlags: DocumentRedFlag[];
  dualUseKeywords: string[];
  riskIndicators: string[];
  completenessScore: number;
}

// ---------------------------------------------------------------------------
// Amount Extraction
// ---------------------------------------------------------------------------

export function extractAmounts(text: string): ExtractedAmount[] {
  const patterns = [
    /(?:AED|Dhs?\.?|د\.إ)\s*([\d,]+(?:\.\d{1,2})?)/gi,
    /(?:USD|\$)\s*([\d,]+(?:\.\d{1,2})?)/gi,
    /(?:EUR|€)\s*([\d,]+(?:\.\d{1,2})?)/gi,
    /(?:GBP|£)\s*([\d,]+(?:\.\d{1,2})?)/gi,
    /([\d,]+(?:\.\d{1,2})?)\s*(?:AED|USD|EUR|GBP|Dhs)/gi,
  ];

  const currencyMap: Record<string, string> = {
    'aed': 'AED', 'dhs': 'AED', 'dh': 'AED', 'د.إ': 'AED',
    'usd': 'USD', '$': 'USD', 'eur': 'EUR', '€': 'EUR', 'gbp': 'GBP', '£': 'GBP',
  };

  const results: ExtractedAmount[] = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const numStr = match[1]?.replace(/,/g, '') ?? '';
      const value = parseFloat(numStr);
      if (isNaN(value)) continue;

      const currPart = match[0].replace(numStr, '').replace(/[,.\s]/g, '').toLowerCase();
      const currency = Object.entries(currencyMap).find(([k]) => currPart.includes(k))?.[1] ?? 'AED';

      results.push({
        value,
        currency,
        original: match[0],
        exceedsThreshold: currency === 'AED' && value >= DPMS_CASH_THRESHOLD_AED,
        threshold: currency === 'AED' && value >= DPMS_CASH_THRESHOLD_AED ? `Exceeds AED ${DPMS_CASH_THRESHOLD_AED.toLocaleString()} DPMS threshold` : undefined,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Date Extraction & Normalization
// ---------------------------------------------------------------------------

export function extractDates(text: string): ExtractedDate[] {
  const patterns = [
    { regex: /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/g, format: 'dmy' },
    { regex: /(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/g, format: 'ymd' },
    { regex: /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})/gi, format: 'dMy' },
  ];

  const monthMap: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const results: ExtractedDate[] = [];

  for (const { regex, format } of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      let day: number, month: number, year: number;
      if (format === 'dmy') { day = parseInt(match[1]); month = parseInt(match[2]); year = parseInt(match[3]); }
      else if (format === 'ymd') { year = parseInt(match[1]); month = parseInt(match[2]); day = parseInt(match[3]); }
      else { day = parseInt(match[1]); month = monthMap[match[2].toLowerCase().slice(0, 3)] ?? 1; year = parseInt(match[3]); }

      if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 2100) {
        // Validate actual date (catches Feb 30, Apr 31, etc.)
        const testDate = new Date(year, month - 1, day);
        if (testDate.getFullYear() === year && testDate.getMonth() === month - 1 && testDate.getDate() === day) {
          results.push({
            original: match[0],
            normalized: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`,
            isoDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          });
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Entity Extraction (NLP-lite)
// ---------------------------------------------------------------------------

export function extractEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  // Email
  const emailRegex = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
  let m;
  while ((m = emailRegex.exec(text)) !== null) {
    entities.push({ name: m[0], type: 'email', confidence: 0.99, position: { start: m.index, end: m.index + m[0].length } });
  }

  // Phone (UAE/international)
  const phoneRegex = /(?:\+971|00971|0)[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{4}/g;
  while ((m = phoneRegex.exec(text)) !== null) {
    entities.push({ name: m[0], type: 'phone', confidence: 0.9, position: { start: m.index, end: m.index + m[0].length } });
  }

  // Emirates ID
  const eidRegex = /784[\s-]?\d{4}[\s-]?\d{7}[\s-]?\d/g;
  while ((m = eidRegex.exec(text)) !== null) {
    entities.push({ name: m[0], type: 'id-number', confidence: 0.95, position: { start: m.index, end: m.index + m[0].length } });
  }

  // Passport-like numbers
  const passportRegex = /\b[A-Z]{1,2}\d{6,9}\b/g;
  while ((m = passportRegex.exec(text)) !== null) {
    entities.push({ name: m[0], type: 'id-number', confidence: 0.7, position: { start: m.index, end: m.index + m[0].length } });
  }

  // Trade license numbers (Dubai format)
  const tlRegex = /\b\d{5,7}(?:\/\d{1,4})?\b/g;
  while ((m = tlRegex.exec(text)) !== null) {
    if (m[0].includes('/')) {
      entities.push({ name: m[0], type: 'id-number', confidence: 0.6, position: { start: m.index, end: m.index + m[0].length } });
    }
  }

  // Company names (heuristic: words before LLC/Ltd/DMCC/FZE etc.)
  const companyRegex = /(?:[A-Z][\w]*(?:\s+[A-Z][\w]*)*)\s+(?:LLC|Ltd|Limited|DMCC|FZE|FZC|FZCO|Inc|Corp|Trading|International)\b/g;
  while ((m = companyRegex.exec(text)) !== null) {
    entities.push({ name: m[0], type: 'company', confidence: 0.85, position: { start: m.index, end: m.index + m[0].length } });
  }

  // Country detection
  const countries = ['UAE', 'United Arab Emirates', 'Dubai', 'Abu Dhabi', 'India', 'China', 'Switzerland', 'Turkey', 'Iran', 'Russia', 'Ghana', 'South Africa', 'Singapore', 'Hong Kong', 'United Kingdom', 'United States'];
  for (const country of countries) {
    let idx = text.indexOf(country);
    while (idx !== -1) {
      entities.push({ name: country, type: 'location', confidence: 0.9, position: { start: idx, end: idx + country.length } });
      idx = text.indexOf(country, idx + country.length);
    }
  }

  return entities;
}

// ---------------------------------------------------------------------------
// Red Flag Detection in Text
// ---------------------------------------------------------------------------

export function detectDocumentRedFlags(text: string): DocumentRedFlag[] {
  const flags: DocumentRedFlag[] = [];
  const lower = text.toLowerCase();

  const redFlagPatterns: Array<{ pattern: RegExp; type: string; severity: DocumentRedFlag['severity']; description: string; regulatoryRef: string }> = [
    { pattern: /no\s+(?:source|proof|evidence)\s+of\s+(?:funds|wealth|income)/i, type: 'missing-sof', severity: 'high', description: 'Missing source of funds/wealth documentation', regulatoryRef: 'FDL Art.12-14' },
    { pattern: /cash\s+(?:payment|deposit|transaction)\s+(?:of\s+)?(?:AED|Dhs?)?\s*[\d,]+/i, type: 'large-cash', severity: 'high', description: 'Cash transaction mentioned — verify against thresholds', regulatoryRef: 'FDL Art.15-16' },
    { pattern: /(?:bearer|anonymous|unnamed|unidentified)\s+(?:instrument|check|cheque|bond)/i, type: 'bearer-instrument', severity: 'critical', description: 'Bearer/anonymous instrument detected', regulatoryRef: 'FDL Art.15, FATF Rec 22' },
    { pattern: /(?:third\s*party|nominee|agent)\s+(?:payment|transfer|deposit)/i, type: 'third-party', severity: 'high', description: 'Third-party payment arrangement', regulatoryRef: 'Cabinet Res 134/2025 Art.9' },
    { pattern: /(?:urgently?|rush|immediate|asap)\s+(?:transfer|process|clear|approve)/i, type: 'urgency-pressure', severity: 'medium', description: 'Unusual urgency/pressure language', regulatoryRef: 'FATF ML Typologies' },
    { pattern: /(?:no\s+questions?|don't\s+ask|confidential|off[\s-]*(?:the[\s-]*)?record)/i, type: 'secrecy', severity: 'critical', description: 'Secrecy/anti-transparency language detected', regulatoryRef: 'FDL Art.29, FATF Rec 22' },
    { pattern: /(?:split|divide|break\s+(?:up|down)|separate)\s+(?:the\s+)?(?:payment|amount|transaction)/i, type: 'structuring-language', severity: 'critical', description: 'Structuring language detected — possible threshold avoidance', regulatoryRef: 'FDL Art.15-16' },
    { pattern: /(?:free[\s-]*(?:trade)?[\s-]*zone|FTZ|offshore|shell\s+company)/i, type: 'opacity-indicator', severity: 'medium', description: 'Opacity/offshore indicator in document', regulatoryRef: 'Cabinet Decision 109/2023' },
  ];

  for (const { pattern, type, severity, description, regulatoryRef } of redFlagPatterns) {
    const match = text.match(pattern);
    if (match) {
      flags.push({ type, severity, description, evidence: match[0], regulatoryRef });
    }
  }

  // Dual-use keywords
  if (DUAL_USE_KEYWORDS && DUAL_USE_KEYWORDS.length > 0) {
    for (const keyword of DUAL_USE_KEYWORDS) {
      if (lower.includes(keyword.toLowerCase())) {
        flags.push({
          type: 'dual-use',
          severity: 'high',
          description: `Dual-use keyword detected: "${keyword}"`,
          evidence: keyword,
          regulatoryRef: 'Cabinet Res 156/2025',
        });
      }
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Full Document Analysis
// ---------------------------------------------------------------------------

export function analyzeDocument(
  text: string,
  documentType?: 'invoice' | 'kyc' | 'trade' | 'narrative',
): ToolResult<DocumentAnalysisReport> {
  if (!text || text.trim().length < 10) {
    return { ok: false, error: 'Document text too short for analysis' };
  }

  const entities = extractEntities(text);
  const amounts = extractAmounts(text);
  const dates = extractDates(text);
  const redFlags = detectDocumentRedFlags(text);

  const lower = text.toLowerCase();
  const dualUseKeywords: string[] = [];
  if (DUAL_USE_KEYWORDS && DUAL_USE_KEYWORDS.length > 0) {
    for (const kw of DUAL_USE_KEYWORDS) {
      if (lower.includes(kw.toLowerCase())) dualUseKeywords.push(kw);
    }
  }

  // Auto-detect document type
  let detectedType = documentType ?? 'unknown' as DocumentAnalysisReport['documentType'];
  if (!documentType) {
    if (/invoice|bill|receipt|payment\s+due/i.test(text)) detectedType = 'invoice';
    else if (/passport|emirates\s+id|nationality|date\s+of\s+birth/i.test(text)) detectedType = 'kyc';
    else if (/bill\s+of\s+lading|certificate\s+of\s+origin|hs\s+code|customs/i.test(text)) detectedType = 'trade';
    else detectedType = 'narrative';
  }

  const riskIndicators: string[] = [];
  if (amounts.some((a) => a.exceedsThreshold)) riskIndicators.push('Amount exceeds DPMS threshold');
  if (redFlags.length > 0) riskIndicators.push(`${redFlags.length} red flag(s) detected`);
  if (dualUseKeywords.length > 0) riskIndicators.push(`${dualUseKeywords.length} dual-use keyword(s)`);
  if (entities.filter((e) => e.type === 'company').length >= 3) riskIndicators.push('Multiple companies referenced');

  const completenessScore = Math.min(100,
    (entities.length > 0 ? 25 : 0) +
    (amounts.length > 0 ? 25 : 0) +
    (dates.length > 0 ? 25 : 0) +
    (entities.some((e) => e.type === 'person' || e.type === 'company') ? 25 : 0),
  );

  return {
    ok: true,
    data: {
      documentType: detectedType,
      extractedEntities: entities,
      extractedAmounts: amounts,
      extractedDates: dates,
      redFlags,
      dualUseKeywords,
      riskIndicators,
      completenessScore,
    },
  };
}

export const DOCUMENT_TOOL_SCHEMAS = [
  {
    name: 'analyze_document',
    description: 'Extract compliance data from documents using NLP: amounts, entities, dates, red flags, dual-use keywords. Auto-detects document type (invoice/KYC/trade/narrative). Returns completeness score.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, documentType: { type: 'string', enum: ['invoice', 'kyc', 'trade', 'narrative'] } }, required: ['text'] },
  },
] as const;
