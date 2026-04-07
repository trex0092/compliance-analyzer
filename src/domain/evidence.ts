export interface EvidenceItem {
  id: string;
  entityId: string;
  linkedCaseId?: string;
  linkedTaskId?: string;
  category:
    | 'kyc'
    | 'sow-sof'
    | 'screening'
    | 'shipment'
    | 'invoice'
    | 'approval'
    | 'training'
    | 'audit'
    | 'report';
  title: string;
  storageType: 'drive' | 'local' | 'url';
  storageRef: string;
  status: 'linked' | 'partial' | 'missing';
  uploadedAt?: string;
  expiryDate?: string;
  owner?: string;
}
