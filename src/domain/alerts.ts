export interface Alert {
  id: string;
  type:
    | 'review-overdue'
    | 'review-upcoming'
    | 'evidence-expiring'
    | 'screening-expired'
    | 'high-risk-case-open'
    | 'task-overdue'
    | 'gap-overdue';
  subjectId: string;
  subjectType: 'customer' | 'case' | 'evidence' | 'task' | 'gap';
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  createdAt: string;
  dismissedAt?: string;
  actionUrl?: string;
}
