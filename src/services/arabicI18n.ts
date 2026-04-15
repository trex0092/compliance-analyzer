/**
 * Arabic i18n — translation map + RTL helpers for the tool's Arabic
 * operator surface.
 *
 * Why this exists:
 *   The tool targets UAE DPMS operators. Arabic is the primary
 *   local language. Until this module landed, the self-audit flag
 *   `hasArabicSupport` was FALSE and the tool was English-only —
 *   a gap for UAE-AIG-05 (UAE AI Charter Principle 4 on inclusive
 *   design) and a practical blocker for customer-facing MLRO rooms.
 *
 *   This module is the pure translation layer. It provides:
 *     - A typed translation key set
 *     - The Arabic values + English fallback
 *     - A `t()` helper that returns the translated string for a
 *       given locale (`'ar'` or `'en'`) with interpolation of
 *       `{{ variable }}` placeholders
 *     - An `isRtl()` helper that tells the UI layer when to flip
 *       direction
 *     - A `formatAed()` helper that localises AED amounts with
 *       Arabic-Indic digits when the locale is Arabic
 *
 *   The module is PURE: no DOM, no browser APIs. The UI layer
 *   calls `t()` to render strings and sets `dir="rtl"` on the
 *   root when `isRtl(locale)` is true.
 *
 * Regulatory basis:
 *   UAE AI Charter Principle 4 (inclusive design + Arabic support)
 *   EU Accessibility Act      (localisation as an accessibility requirement)
 *   FDL No.10/2025 Art.20-22  (operator comprehension)
 *   ISO/IEC 42001 A.7.1       (human factors)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Locale = 'en' | 'ar';

/**
 * Core translation key set. Add to this union as new UI strings
 * land. Every key MUST have both an English and an Arabic value.
 */
export type TranslationKey =
  | 'app.title'
  | 'app.tagline'
  | 'nav.dashboard'
  | 'nav.screening'
  | 'nav.incidents'
  | 'nav.brainConsole'
  | 'nav.audit'
  | 'nav.settings'
  | 'verdict.pass'
  | 'verdict.flag'
  | 'verdict.escalate'
  | 'verdict.freeze'
  | 'action.submit'
  | 'action.cancel'
  | 'action.approve'
  | 'action.reject'
  | 'action.escalate'
  | 'action.export'
  | 'label.customer'
  | 'label.amount'
  | 'label.date'
  | 'label.reason'
  | 'label.regulatory'
  | 'label.verdict'
  | 'label.confidence'
  | 'label.humanReview'
  | 'label.fourEyes'
  | 'empty.noDecisions'
  | 'empty.noCases'
  | 'empty.noAlerts'
  | 'tooltip.sanctionsMatch'
  | 'tooltip.freezeRequired'
  | 'tooltip.strRequired'
  | 'tier.sdd'
  | 'tier.cdd'
  | 'tier.edd'
  | 'tier.pep';

// ---------------------------------------------------------------------------
// Translations
// ---------------------------------------------------------------------------

const EN: Readonly<Record<TranslationKey, string>> = {
  'app.title': 'HAWKEYE STERLING',
  'app.tagline': 'UAE AML / CFT / CPF compliance brain',
  'nav.dashboard': 'Dashboard',
  'nav.screening': 'Screening',
  'nav.incidents': 'Incidents',
  'nav.brainConsole': 'Brain Console',
  'nav.audit': 'Audit',
  'nav.settings': 'Settings',
  'verdict.pass': 'Pass',
  'verdict.flag': 'Flag',
  'verdict.escalate': 'Escalate',
  'verdict.freeze': 'Freeze',
  'action.submit': 'Submit',
  'action.cancel': 'Cancel',
  'action.approve': 'Approve',
  'action.reject': 'Reject',
  'action.escalate': 'Escalate',
  'action.export': 'Export',
  'label.customer': 'Customer',
  'label.amount': 'Amount',
  'label.date': 'Date',
  'label.reason': 'Reason',
  'label.regulatory': 'Regulatory basis',
  'label.verdict': 'Verdict',
  'label.confidence': 'Confidence',
  'label.humanReview': 'Human review required',
  'label.fourEyes': 'Four-eyes gate',
  'empty.noDecisions': 'No decisions yet',
  'empty.noCases': 'No cases to review',
  'empty.noAlerts': 'No open alerts',
  'tooltip.sanctionsMatch': 'Sanctions list match confirmed',
  'tooltip.freezeRequired': 'Asset freeze required within 24 hours',
  'tooltip.strRequired': 'Suspicious transaction report required without delay',
  'tier.sdd': 'Simplified',
  'tier.cdd': 'Standard',
  'tier.edd': 'Enhanced',
  'tier.pep': 'Politically exposed',
};

const AR: Readonly<Record<TranslationKey, string>> = {
  'app.title': 'هوكاي سترلنج',
  'app.tagline': 'دماغ الامتثال الإماراتي لمكافحة غسل الأموال وتمويل الإرهاب',
  'nav.dashboard': 'لوحة التحكم',
  'nav.screening': 'الفحص',
  'nav.incidents': 'الحوادث',
  'nav.brainConsole': 'وحدة الدماغ',
  'nav.audit': 'التدقيق',
  'nav.settings': 'الإعدادات',
  'verdict.pass': 'مقبول',
  'verdict.flag': 'تحت المراقبة',
  'verdict.escalate': 'تصعيد',
  'verdict.freeze': 'تجميد',
  'action.submit': 'إرسال',
  'action.cancel': 'إلغاء',
  'action.approve': 'موافقة',
  'action.reject': 'رفض',
  'action.escalate': 'تصعيد',
  'action.export': 'تصدير',
  'label.customer': 'العميل',
  'label.amount': 'المبلغ',
  'label.date': 'التاريخ',
  'label.reason': 'السبب',
  'label.regulatory': 'الأساس التنظيمي',
  'label.verdict': 'القرار',
  'label.confidence': 'مستوى الثقة',
  'label.humanReview': 'يتطلب مراجعة بشرية',
  'label.fourEyes': 'بوابة الأربع أعين',
  'empty.noDecisions': 'لا توجد قرارات بعد',
  'empty.noCases': 'لا توجد حالات للمراجعة',
  'empty.noAlerts': 'لا توجد تنبيهات مفتوحة',
  'tooltip.sanctionsMatch': 'تم تأكيد مطابقة قائمة العقوبات',
  'tooltip.freezeRequired': 'تجميد الأصول مطلوب خلال ٢٤ ساعة',
  'tooltip.strRequired': 'تقرير المعاملات المشبوهة مطلوب دون تأخير',
  'tier.sdd': 'مبسّط',
  'tier.cdd': 'قياسي',
  'tier.edd': 'معزز',
  'tier.pep': 'شخصية سياسية',
};

const TABLES: Readonly<Record<Locale, Readonly<Record<TranslationKey, string>>>> = {
  en: EN,
  ar: AR,
};

// ---------------------------------------------------------------------------
// Placeholder interpolation
// ---------------------------------------------------------------------------

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Translate a key to the target locale with optional variable
 * interpolation. Falls back to English if the locale is missing
 * the key.
 */
export function t(
  key: TranslationKey,
  locale: Locale = 'en',
  vars: Readonly<Record<string, string | number>> = {}
): string {
  const table = TABLES[locale] ?? EN;
  const raw = table[key] ?? EN[key];
  if (!raw) return key;
  return raw.replace(PLACEHOLDER, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined || v === null) return `{{${name}}}`;
    return String(v);
  });
}

/** Is this locale right-to-left? */
export function isRtl(locale: Locale): boolean {
  return locale === 'ar';
}

/** Get the HTML `dir` attribute value for a locale. */
export function directionFor(locale: Locale): 'rtl' | 'ltr' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

/**
 * Arabic-Indic digit conversion — used when the locale is 'ar' so
 * numbers render with the expected local digits.
 */
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function toArabicDigits(input: string): string {
  return input.replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)] ?? d);
}

/**
 * Format an AED amount with the locale's conventions.
 *   en: "AED 55,000.00"
 *   ar: "د.إ ٥٥٬٠٠٠٫٠٠"  (with Arabic digits + Arabic separators)
 */
export function formatAed(amount: number, locale: Locale = 'en'): string {
  if (!Number.isFinite(amount)) return locale === 'ar' ? 'غير محدد' : 'unspecified';
  const fixed = amount.toLocaleString('en-AE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (locale === 'ar') {
    const arabic = toArabicDigits(fixed).replace(/,/g, '٬').replace(/\./g, '٫');
    return `د.إ ${arabic}`;
  }
  return `AED ${fixed}`;
}

/** Expose the full translation key list — useful for UI tests. */
export function listTranslationKeys(): readonly TranslationKey[] {
  return Object.keys(EN) as TranslationKey[];
}

/** Return every supported locale. */
export function supportedLocales(): readonly Locale[] {
  return ['en', 'ar'];
}

// Exports for tests.
export const __test__ = { EN, AR, ARABIC_DIGITS };
