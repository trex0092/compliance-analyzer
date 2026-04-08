import type { AppStore } from './store';
import type { ComplianceCase } from '../domain/cases';
import type { CustomerProfile } from '../domain/customers';
import type { EvidenceItem } from '../domain/evidence';
import type { ScreeningRun } from '../domain/screening';
import type { SuspicionReport } from '../domain/reports';
import type { ApprovalRequest } from '../domain/approvals';
import type { Alert } from '../domain/alerts';

// ---------------------------------------------------------------------------
// Database constants
// ---------------------------------------------------------------------------
const DB_NAME = 'fgl_compliance_db';
const DB_VERSION = 1;

const STORE_NAMES = [
  'cases',
  'customers',
  'evidence',
  'screeningRuns',
  'reports',
  'approvals',
  'alerts',
] as const;

type StoreName = (typeof STORE_NAMES)[number];

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------

/** Open (or create) the database. Cached after first successful open. */
let cachedDb: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (cachedDb) return Promise.resolve(cachedDb);

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };

    request.onsuccess = () => {
      cachedDb = request.result;
      // Clear the cache if the database is unexpectedly closed so the next
      // call reopens it.
      cachedDb.onclose = () => {
        cachedDb = null;
      };
      resolve(cachedDb);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/** Read all records from an object store. */
function getAll<T>(storeName: StoreName): Promise<T[]> {
  return openDb().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(req.error);
      })
  );
}

/** Insert or update a record (upsert by its `id` keyPath). */
function putItem<T extends { id: string }>(storeName: StoreName, item: T): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(item);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      })
  );
}

/** Delete a record by id. */
function deleteItem(storeName: StoreName, id: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      })
  );
}

/** Clear all records in a single object store. */
export function clearStore(storeName: StoreName): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      })
  );
}

// ---------------------------------------------------------------------------
// localStorage fallback helpers (used only when IndexedDB is unavailable)
// ---------------------------------------------------------------------------

function lsRead<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    console.error(`[LocalAppStore] Failed to read "${key}" from localStorage`);
    return [];
  }
}

function lsWrite<T>(key: string, value: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`[LocalAppStore] Failed to write "${key}" to localStorage:`, err);
  }
}

function lsUpsert<T extends { id: string }>(items: T[], item: T): T[] {
  const idx = items.findIndex((x) => x.id === item.id);
  if (idx >= 0) {
    const next = [...items];
    next[idx] = item;
    return next;
  }
  return [item, ...items];
}

function lsDelete<T extends { id: string }>(key: string, id: string): void {
  const items = lsRead<T>(key);
  lsWrite(
    key,
    items.filter((x) => x.id !== id)
  );
}

// ---------------------------------------------------------------------------
// Detect IndexedDB availability once at module load
// ---------------------------------------------------------------------------

let idbAvailable = true;
try {
  if (typeof indexedDB === 'undefined') {
    idbAvailable = false;
  }
} catch {
  idbAvailable = false;
}

if (!idbAvailable) {
  console.warn(
    '[LocalAppStore] IndexedDB is not available. Falling back to localStorage. ' +
      'Data storage is limited to ~5-10 MB and may be unreliable.'
  );
}

// ---------------------------------------------------------------------------
// Export / import payload shape
// ---------------------------------------------------------------------------

export interface AllData {
  cases: ComplianceCase[];
  customers: CustomerProfile[];
  evidence: EvidenceItem[];
  screeningRuns: ScreeningRun[];
  reports: SuspicionReport[];
  approvals: ApprovalRequest[];
  alerts: Alert[];
}

// ---------------------------------------------------------------------------
// LocalAppStore — IndexedDB backed, localStorage fallback
// ---------------------------------------------------------------------------

export class LocalAppStore implements AppStore {
  // ---- Cases ----
  async getCases(): Promise<ComplianceCase[]> {
    if (!idbAvailable) return lsRead<ComplianceCase>('cases');
    return getAll<ComplianceCase>('cases');
  }

  async saveCase(item: ComplianceCase): Promise<void> {
    if (!idbAvailable) {
      lsWrite('cases', lsUpsert(lsRead<ComplianceCase>('cases'), item));
      return;
    }
    return putItem('cases', item);
  }

  async deleteCase(id: string): Promise<void> {
    if (!idbAvailable) {
      lsDelete<ComplianceCase>('cases', id);
      return;
    }
    return deleteItem('cases', id);
  }

  // ---- Customers ----
  async getCustomers(): Promise<CustomerProfile[]> {
    if (!idbAvailable) return lsRead<CustomerProfile>('customers');
    return getAll<CustomerProfile>('customers');
  }

  async saveCustomer(item: CustomerProfile): Promise<void> {
    if (!idbAvailable) {
      lsWrite('customers', lsUpsert(lsRead<CustomerProfile>('customers'), item));
      return;
    }
    return putItem('customers', item);
  }

  async deleteCustomer(id: string): Promise<void> {
    if (!idbAvailable) {
      lsDelete<CustomerProfile>('customers', id);
      return;
    }
    return deleteItem('customers', id);
  }

  // ---- Evidence ----
  async getEvidence(): Promise<EvidenceItem[]> {
    if (!idbAvailable) return lsRead<EvidenceItem>('evidence');
    return getAll<EvidenceItem>('evidence');
  }

  async saveEvidence(item: EvidenceItem): Promise<void> {
    if (!idbAvailable) {
      lsWrite('evidence', lsUpsert(lsRead<EvidenceItem>('evidence'), item));
      return;
    }
    return putItem('evidence', item);
  }

  async deleteEvidence(id: string): Promise<void> {
    if (!idbAvailable) {
      lsDelete<EvidenceItem>('evidence', id);
      return;
    }
    return deleteItem('evidence', id);
  }

  // ---- Screening Runs ----
  async getScreeningRuns(): Promise<ScreeningRun[]> {
    if (!idbAvailable) return lsRead<ScreeningRun>('screeningRuns');
    return getAll<ScreeningRun>('screeningRuns');
  }

  async saveScreeningRun(item: ScreeningRun): Promise<void> {
    if (!idbAvailable) {
      lsWrite('screeningRuns', lsUpsert(lsRead<ScreeningRun>('screeningRuns'), item));
      return;
    }
    return putItem('screeningRuns', item);
  }

  async deleteScreeningRun(id: string): Promise<void> {
    if (!idbAvailable) {
      lsDelete<ScreeningRun>('screeningRuns', id);
      return;
    }
    return deleteItem('screeningRuns', id);
  }

  // ---- Reports ----
  async getReports(): Promise<SuspicionReport[]> {
    if (!idbAvailable) return lsRead<SuspicionReport>('reports');
    return getAll<SuspicionReport>('reports');
  }

  async saveReport(item: SuspicionReport): Promise<void> {
    if (!idbAvailable) {
      lsWrite('reports', lsUpsert(lsRead<SuspicionReport>('reports'), item));
      return;
    }
    return putItem('reports', item);
  }

  async deleteReport(id: string): Promise<void> {
    if (!idbAvailable) {
      lsDelete<SuspicionReport>('reports', id);
      return;
    }
    return deleteItem('reports', id);
  }

  // ---- Approvals ----
  async getApprovals(): Promise<ApprovalRequest[]> {
    if (!idbAvailable) return lsRead<ApprovalRequest>('approvals');
    return getAll<ApprovalRequest>('approvals');
  }

  async saveApproval(item: ApprovalRequest): Promise<void> {
    if (!idbAvailable) {
      lsWrite('approvals', lsUpsert(lsRead<ApprovalRequest>('approvals'), item));
      return;
    }
    return putItem('approvals', item);
  }

  async deleteApproval(id: string): Promise<void> {
    if (!idbAvailable) {
      lsDelete<ApprovalRequest>('approvals', id);
      return;
    }
    return deleteItem('approvals', id);
  }

  // ---- Alerts ----
  async getAlerts(): Promise<Alert[]> {
    if (!idbAvailable) return lsRead<Alert>('alerts');
    return getAll<Alert>('alerts');
  }

  async saveAlert(item: Alert): Promise<void> {
    if (!idbAvailable) {
      lsWrite('alerts', lsUpsert(lsRead<Alert>('alerts'), item));
      return;
    }
    return putItem('alerts', item);
  }

  async deleteAlert(id: string): Promise<void> {
    if (!idbAvailable) {
      lsDelete<Alert>('alerts', id);
      return;
    }
    return deleteItem('alerts', id);
  }

  // ---- Bulk export / import ----

  /** Export every object store as a single JSON-serialisable object. */
  async exportAll(): Promise<AllData> {
    const [cases, customers, evidence, screeningRuns, reports, approvals, alerts] =
      await Promise.all([
        this.getCases(),
        this.getCustomers(),
        this.getEvidence(),
        this.getScreeningRuns(),
        this.getReports(),
        this.getApprovals(),
        this.getAlerts(),
      ]);
    return { cases, customers, evidence, screeningRuns, reports, approvals, alerts };
  }

  /**
   * Import data from a previous `exportAll()` backup.
   * Replaces existing data in each store that is present in the payload.
   */
  async importAll(data: Partial<AllData>): Promise<void> {
    if (!idbAvailable) {
      // localStorage path — overwrite each key that exists in the payload
      if (data.cases) lsWrite('cases', data.cases);
      if (data.customers) lsWrite('customers', data.customers);
      if (data.evidence) lsWrite('evidence', data.evidence);
      if (data.screeningRuns) lsWrite('screeningRuns', data.screeningRuns);
      if (data.reports) lsWrite('reports', data.reports);
      if (data.approvals) lsWrite('approvals', data.approvals);
      if (data.alerts) lsWrite('alerts', data.alerts);
      return;
    }

    const db = await openDb();

    // Build a single read-write transaction across all stores that need updating
    const storeEntries: [StoreName, { id: string }[]][] = [];
    if (data.cases) storeEntries.push(['cases', data.cases]);
    if (data.customers) storeEntries.push(['customers', data.customers]);
    if (data.evidence) storeEntries.push(['evidence', data.evidence]);
    if (data.screeningRuns) storeEntries.push(['screeningRuns', data.screeningRuns]);
    if (data.reports) storeEntries.push(['reports', data.reports]);
    if (data.approvals) storeEntries.push(['approvals', data.approvals]);
    if (data.alerts) storeEntries.push(['alerts', data.alerts]);

    if (storeEntries.length === 0) return;

    const storeNamesToWrite = storeEntries.map(([name]) => name);
    const tx = db.transaction(storeNamesToWrite, 'readwrite');

    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);

      for (const [name, items] of storeEntries) {
        const store = tx.objectStore(name);
        // Clear existing records before importing
        store.clear();
        for (const item of items) {
          store.put(item);
        }
      }
    });
  }
}
