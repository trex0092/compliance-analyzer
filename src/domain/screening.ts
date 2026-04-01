export interface ScreeningRun {
  id: string;
  subjectType: "entity" | "ubo" | "manager" | "shipment";
  subjectId: string;
  executedAt: string;
  systemUsed: string;
  listsChecked: string[];
  result: "clear" | "potential-match" | "confirmed-match";
  falsePositiveResolution?: string;
  analyst: string;
  attachedCaseId?: string;
}
