import { describe, it, expect, beforeEach } from 'vitest';
import {
  TransactionMonitoringEngine,
  type CustomerProfile,
} from '../src/services/transactionMonitoringEngine';
import type { TransactionInput } from '../src/risk/transactionMonitoring';

function makeTx(overrides: Partial<TransactionInput> = {}): TransactionInput {
  return {
    amount: 10_000,
    currency: 'AED',
    customerName: 'Test Customer',
    customerRiskRating: 'low',
    payerMatchesCustomer: true,
    paymentMethod: 'bank_transfer',
    ...overrides,
  };
}

function makeProfile(overrides: Partial<CustomerProfile> = {}): CustomerProfile {
  return {
    customerId: 'CUST-001',
    customerName: 'Test Customer',
    riskRating: 'low',
    avgTransactionAmount: 15_000,
    avgTransactionsPerMonth: 5,
    typicalPaymentMethods: ['bank_transfer'],
    typicalCountries: ['AE', 'IN'],
    lastTransactionDate: new Date().toISOString(),
    profileUpdatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('TransactionMonitoringEngine', () => {
  let engine: TransactionMonitoringEngine;

  beforeEach(() => {
    engine = new TransactionMonitoringEngine();
  });

  describe('basic rule-based alerts', () => {
    it('detects cash threshold breach (AED 55,000)', () => {
      const tx = makeTx({ amount: 60_000, paymentMethod: 'cash' });
      const alerts = engine.processTransaction(tx, 'CUST-001');
      const threshold = alerts.find((a) => a.ruleId === 'cash-threshold');
      expect(threshold).toBeDefined();
      expect(threshold?.severity).toBe('critical');
    });

    it('returns no alerts for normal transaction', () => {
      const tx = makeTx({ amount: 5_000 });
      const alerts = engine.processTransaction(tx, 'CUST-001');
      expect(alerts.length).toBe(0);
    });

    it('detects third-party payment', () => {
      const tx = makeTx({ payerMatchesCustomer: false });
      const alerts = engine.processTransaction(tx, 'CUST-001');
      const thirdParty = alerts.find((a) => a.ruleId === 'third-party-payment');
      expect(thirdParty).toBeDefined();
    });
  });

  describe('behavioral deviation detection', () => {
    it('detects amount anomaly vs customer profile', () => {
      engine.loadProfile(makeProfile({ avgTransactionAmount: 10_000 }));

      // 5x the average should trigger
      const tx = makeTx({ amount: 50_000 });
      const alerts = engine.processTransaction(tx, 'CUST-001');
      const behavioral = alerts.find(
        (a) => a.isBehavioral && a.ruleName.includes('Amount Anomaly'),
      );
      expect(behavioral).toBeDefined();
      expect(behavioral?.anomalyScore).toBeGreaterThan(0);
    });

    it('does not flag amounts within normal range', () => {
      engine.loadProfile(makeProfile({ avgTransactionAmount: 10_000 }));

      const tx = makeTx({ amount: 15_000 }); // 1.5x — below 3x threshold
      const alerts = engine.processTransaction(tx, 'CUST-001');
      const behavioral = alerts.find(
        (a) => a.isBehavioral && a.ruleName.includes('Amount Anomaly'),
      );
      expect(behavioral).toBeUndefined();
    });

    it('detects unusual payment method', () => {
      engine.loadProfile(
        makeProfile({ typicalPaymentMethods: ['bank_transfer', 'cheque'] }),
      );

      const tx = makeTx({ paymentMethod: 'cryptocurrency' });
      const alerts = engine.processTransaction(tx, 'CUST-001');
      const unusual = alerts.find(
        (a) => a.isBehavioral && a.ruleName.includes('Payment Method'),
      );
      expect(unusual).toBeDefined();
      expect(unusual?.severity).toBe('medium');
    });
  });

  describe('velocity monitoring', () => {
    it('detects high transaction frequency', () => {
      engine = new TransactionMonitoringEngine({
        velocityMaxTransactions: 3,
        velocityWindowHours: 24,
      });

      const customerId = 'CUST-VEL';
      // Process enough transactions to trigger velocity alert
      for (let i = 0; i < 3; i++) {
        engine.processTransaction(makeTx({ amount: 5_000 }), customerId);
      }

      // This one should trigger the velocity alert
      const alerts = engine.processTransaction(makeTx({ amount: 5_000 }), customerId);
      const velocity = alerts.find((a) => a.ruleName === 'High Transaction Velocity');
      expect(velocity).toBeDefined();
    });
  });

  describe('cumulative exposure', () => {
    it('detects cumulative amount exceeding threshold', () => {
      const customerId = 'CUST-CUM';

      // Build up transactions that individually are below 55k but cumulate above it
      engine.processTransaction(makeTx({ amount: 20_000 }), customerId);
      engine.processTransaction(makeTx({ amount: 20_000 }), customerId);

      // This pushes cumulative over 55k (20k + 20k + 20k = 60k)
      const alerts = engine.processTransaction(makeTx({ amount: 20_000 }), customerId);
      const cumulative = alerts.find(
        (a) => a.ruleName === 'Cumulative Exposure — Threshold Breach',
      );
      expect(cumulative).toBeDefined();
      expect(cumulative?.severity).toBe('critical');
    });
  });

  describe('cross-border detection', () => {
    it('detects cross-border transactions above AED 60,000', () => {
      const tx = makeTx({
        amount: 65_000,
        originCountry: 'AE',
        destinationCountry: 'IN',
      });
      const alerts = engine.processTransaction(tx, 'CUST-001');
      const crossBorder = alerts.find(
        (a) => a.ruleName === 'Cross-Border Declaration Required',
      );
      expect(crossBorder).toBeDefined();
      expect(crossBorder?.severity).toBe('critical');
    });

    it('ignores domestic transactions', () => {
      const tx = makeTx({
        amount: 65_000,
        originCountry: 'AE',
        destinationCountry: 'AE',
      });
      const alerts = engine.processTransaction(tx, 'CUST-001');
      const crossBorder = alerts.find(
        (a) => a.ruleName === 'Cross-Border Declaration Required',
      );
      expect(crossBorder).toBeUndefined();
    });
  });

  describe('circuit breaker', () => {
    it('trips when alert volume exceeds threshold', () => {
      engine = new TransactionMonitoringEngine({
        circuitBreakerAlertThreshold: 5,
        circuitBreakerResetMinutes: 1,
      });

      // Generate many alerts quickly with third-party payments
      for (let i = 0; i < 10; i++) {
        engine.processTransaction(
          makeTx({ payerMatchesCustomer: false }),
          `CUST-${i}`,
        );
      }

      const session = engine.getSessionSummary();
      expect(session.circuitBreaker.tripped).toBe(true);
    });

    it('still passes critical alerts when tripped', () => {
      engine = new TransactionMonitoringEngine({
        circuitBreakerAlertThreshold: 3,
      });

      // Trip the breaker
      for (let i = 0; i < 5; i++) {
        engine.processTransaction(
          makeTx({ payerMatchesCustomer: false }),
          `CUST-${i}`,
        );
      }

      // Critical alert should still pass
      const alerts = engine.processTransaction(
        makeTx({ amount: 60_000, paymentMethod: 'cash' }),
        'CUST-CRITICAL',
      );
      const critical = alerts.filter((a) => a.severity === 'critical');
      expect(critical.length).toBeGreaterThan(0);
    });

    it('can be manually reset', () => {
      engine = new TransactionMonitoringEngine({ circuitBreakerAlertThreshold: 3 });

      for (let i = 0; i < 5; i++) {
        engine.processTransaction(makeTx({ payerMatchesCustomer: false }), `C-${i}`);
      }
      expect(engine.getSessionSummary().circuitBreaker.tripped).toBe(true);

      engine.resetCircuitBreaker();
      expect(engine.getSessionSummary().circuitBreaker.tripped).toBe(false);
    });
  });

  describe('alert metadata', () => {
    it('assigns unique alert IDs', () => {
      const alerts1 = engine.processTransaction(
        makeTx({ payerMatchesCustomer: false }),
        'CUST-001',
      );
      const alerts2 = engine.processTransaction(
        makeTx({ payerMatchesCustomer: false }),
        'CUST-002',
      );

      const ids = [...alerts1, ...alerts2].map((a) => a.alertId);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it('links related alerts from the same transaction', () => {
      // A transaction that triggers multiple rules
      const tx = makeTx({
        amount: 60_000,
        paymentMethod: 'cash',
        payerMatchesCustomer: false,
        originCountry: 'AE',
        destinationCountry: 'IR',
      });
      const alerts = engine.processTransaction(tx, 'CUST-001');

      expect(alerts.length).toBeGreaterThan(1);
      for (const alert of alerts) {
        expect(alert.relatedAlertIds.length).toBe(alerts.length - 1);
      }
    });
  });

  describe('reporting', () => {
    it('returns correct session summary', () => {
      engine.processTransaction(makeTx(), 'CUST-001');
      engine.processTransaction(makeTx({ payerMatchesCustomer: false }), 'CUST-002');

      const summary = engine.getSessionSummary();
      expect(summary.transactionsProcessed).toBe(2);
      expect(summary.sessionId).toMatch(/^TMS-/);
    });

    it('returns customer risk summary', () => {
      engine.loadProfile(makeProfile({ customerId: 'CUST-001' }));
      engine.processTransaction(
        makeTx({ payerMatchesCustomer: false }),
        'CUST-001',
      );

      const risk = engine.getCustomerRiskSummary('CUST-001');
      expect(risk.customerId).toBe('CUST-001');
      expect(risk.profile).not.toBeNull();
      expect(risk.alertCount).toBeGreaterThan(0);
    });

    it('filters recent alerts by severity', () => {
      engine.processTransaction(
        makeTx({ amount: 60_000, paymentMethod: 'cash' }),
        'CUST-001',
      );
      engine.processTransaction(
        makeTx({ payerMatchesCustomer: false }),
        'CUST-002',
      );

      const critical = engine.getRecentAlerts(100, 'critical');
      for (const alert of critical) {
        expect(alert.severity).toBe('critical');
      }
    });
  });
});
