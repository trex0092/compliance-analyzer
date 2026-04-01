export type RedFlagCategory =
  | "customer"
  | "transaction"
  | "sanctions"
  | "pf"
  | "sourcing"
  | "sof-sow"
  | "kyc";

export interface RedFlagDefinition {
  code: string;
  title: string;
  description: string;
  category: RedFlagCategory;
  likelihood: 1 | 2 | 3 | 4 | 5;
  impact: 1 | 2 | 3 | 4 | 5;
  autoTriggersEDD: boolean;
  autoTriggersSTRReview: boolean;
  autoBlocksProcessing: boolean;
}

export const RED_FLAGS: RedFlagDefinition[] = [
  {
    code: "RF001",
    title: "Unjustified increase in precious metals supply",
    description: "Prominent increase in supply or purchase without support",
    category: "transaction",
    likelihood: 3,
    impact: 4,
    autoTriggersEDD: true,
    autoTriggersSTRReview: false,
    autoBlocksProcessing: false,
  },
  {
    code: "RF011",
    title: "Sanctions list match",
    description: "Customer or company appears on sanctions lists",
    category: "sanctions",
    likelihood: 5,
    impact: 5,
    autoTriggersEDD: true,
    autoTriggersSTRReview: true,
    autoBlocksProcessing: true,
  },
  {
    code: "RF018",
    title: "Complex ownership structure",
    description: "Ownership structure is unnecessarily complex",
    category: "customer",
    likelihood: 4,
    impact: 4,
    autoTriggersEDD: true,
    autoTriggersSTRReview: false,
    autoBlocksProcessing: false,
  },
  {
    code: "RF024",
    title: "Complex payment methods",
    description: "Virtual assets, prepaid cards, e-wallets, PayPal",
    category: "transaction",
    likelihood: 4,
    impact: 4,
    autoTriggersEDD: true,
    autoTriggersSTRReview: true,
    autoBlocksProcessing: false,
  },
  {
    code: "RF041",
    title: "False certificates of origin",
    description: "Origin certificates appear false or manipulated",
    category: "sourcing",
    likelihood: 5,
    impact: 5,
    autoTriggersEDD: true,
    autoTriggersSTRReview: true,
    autoBlocksProcessing: true,
  },
  {
    code: "RF067",
    title: "Unverified source of funds",
    description: "Source of funds is unverified or unexplained",
    category: "sof-sow",
    likelihood: 5,
    impact: 5,
    autoTriggersEDD: true,
    autoTriggersSTRReview: true,
    autoBlocksProcessing: true,
  },
];
