/**
 * Trade-Based Money Laundering (TBML) signals.
 *
 * Detects the classic red flags in goods movement + invoice data that
 * the FATF names in its TBML typology reports (2006, 2018, 2020):
 *   - Over-/under-invoicing vs. market reference prices
 *   - Multiple-invoicing (same shipment, different invoices)
 *   - Phantom shipment (invoice without goods movement)
 *   - Mis-description of goods (dual-use / Cabinet Res 156/2025)
 *   - Unusual routing / high-risk jurisdiction loop
 *
 * Pluggable price-reference loader so a real deployment can hit
 * Eikon / S&P Platts / Bloomberg / LBMA AM/PM gold fix.
 */

export type Currency = 'USD' | 'AED' | 'EUR' | 'GBP' | 'CHF';

export interface Shipment {
  id: string;
  goodsCode: string;
  goodsDescription: string;
  quantity: number;
  unit: 'kg' | 'g' | 't' | 'oz' | 'pcs' | 'l';
  invoicedAmount: number;
  invoicedCurrency: Currency;
  originCountry: string;
  destinationCountry: string;
  routingCountries?: string[];
  consignor: string;
  consignee: string;
  shipmentDate: string;
  dualUseFlag?: boolean;
}

export interface PriceReference {
  goodsCode: string;
  unit: Shipment['unit'];
  price: number;
  currency: Currency;
  source: string;
  fetchedAt: string;
}

export type PriceLoader = (goodsCode: string) => PriceReference | undefined;

export interface TbmlSignal {
  id: string;
  label: string;
  severity: 'low' | 'medium' | 'high';
  ref: string;
  evidence: string;
}

export interface TbmlResult {
  shipmentId: string;
  signals: TbmlSignal[];
  riskScore: number;
}

const HIGH_RISK_JURISDICTIONS = new Set(['IR', 'KP', 'SY', 'MM', 'AF', 'YE', 'CU', 'VE']);

export function analyzeTbml(
  shipment: Shipment,
  priceLoader: PriceLoader,
  peerShipments: Shipment[] = []
): TbmlResult {
  const signals: TbmlSignal[] = [];

  // 1. Over-/under-invoicing vs. price reference.
  const ref = priceLoader(shipment.goodsCode);
  if (ref && ref.unit === shipment.unit && ref.currency === shipment.invoicedCurrency) {
    const expected = ref.price * shipment.quantity;
    const ratio = shipment.invoicedAmount / expected;
    if (ratio > 1.5) {
      signals.push({
        id: 'over_invoicing',
        label: 'Over-invoicing (>150% of market reference)',
        severity: 'high',
        ref: 'FATF TBML 2006/2020',
        evidence: `Invoiced ${shipment.invoicedAmount} ${shipment.invoicedCurrency}, market reference ${expected.toFixed(2)} (${ratio.toFixed(2)}x).`,
      });
    } else if (ratio < 0.66) {
      signals.push({
        id: 'under_invoicing',
        label: 'Under-invoicing (<66% of market reference)',
        severity: 'high',
        ref: 'FATF TBML 2006/2020',
        evidence: `Invoiced ${shipment.invoicedAmount} ${shipment.invoicedCurrency}, market reference ${expected.toFixed(2)} (${ratio.toFixed(2)}x).`,
      });
    }
  }

  // 2. Multiple-invoicing — same consignor/consignee/date/goods, different amounts.
  const peers = peerShipments.filter(
    (p) =>
      p.id !== shipment.id &&
      p.consignor === shipment.consignor &&
      p.consignee === shipment.consignee &&
      p.goodsCode === shipment.goodsCode &&
      p.shipmentDate === shipment.shipmentDate
  );
  if (peers.length > 0) {
    signals.push({
      id: 'multi_invoicing',
      label: 'Multiple invoices for identical shipment',
      severity: 'high',
      ref: 'FATF TBML 2006',
      evidence: `${peers.length} duplicate shipment record(s) detected (ids: ${peers.map((p) => p.id).join(', ')}).`,
    });
  }

  // 3. High-risk routing.
  const routing = shipment.routingCountries ?? [];
  const highRiskHop = routing.find((c) => HIGH_RISK_JURISDICTIONS.has(c));
  if (highRiskHop) {
    signals.push({
      id: 'high_risk_routing',
      label: 'Shipment routed through high-risk jurisdiction',
      severity: 'medium',
      ref: 'FATF grey/black list; Cabinet Res 134/2025 Art.14',
      evidence: `Routing country ${highRiskHop} is on the high-risk list.`,
    });
  }

  // 4. Dual-use goods.
  if (shipment.dualUseFlag) {
    signals.push({
      id: 'dual_use',
      label: 'Dual-use goods — strategic export control',
      severity: 'high',
      ref: 'Cabinet Res 156/2025 (dual-use / PF)',
      evidence: `Goods code ${shipment.goodsCode} (${shipment.goodsDescription}) is flagged dual-use.`,
    });
  }

  // 5. Origin/destination high-risk.
  if (
    HIGH_RISK_JURISDICTIONS.has(shipment.originCountry) ||
    HIGH_RISK_JURISDICTIONS.has(shipment.destinationCountry)
  ) {
    signals.push({
      id: 'high_risk_endpoint',
      label: 'Origin or destination on high-risk jurisdiction list',
      severity: 'medium',
      ref: 'FATF grey/black list',
      evidence: `Origin ${shipment.originCountry}, destination ${shipment.destinationCountry}.`,
    });
  }

  const weights: Record<TbmlSignal['severity'], number> = {
    low: 0.15,
    medium: 0.4,
    high: 0.8,
  };
  const raw = signals.reduce((sum, s) => sum + weights[s.severity], 0);
  const riskScore = Math.min(1, raw / 2);

  return { shipmentId: shipment.id, signals, riskScore };
}
