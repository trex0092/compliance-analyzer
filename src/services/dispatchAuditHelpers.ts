/**
 * Dispatch Audit Helpers — thin re-exports over dispatchAuditLog.ts
 * so the batch dispatcher and the listener can share an
 * "already dispatched?" check without a cyclic import.
 *
 * Split into a helper module because the listener imports the
 * super-brain dispatcher, and the super-brain dispatcher's batch
 * layer needs the audit log, and putting them all in the same
 * file would create a cycle at module-load time.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (audit trail for every dispatch)
 */

import { recordDispatch as recordDispatchImpl, readAuditLog } from './dispatchAuditLog';

export { recordDispatchImpl as recordDispatch };

/** Non-recursive alias so the batch dispatcher can check idempotency. */
export function hasCaseInAuditLogCheck(caseId: string): boolean {
  return readAuditLog({ caseId, limit: 1 }).length > 0;
}
