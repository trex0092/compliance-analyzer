import { useEffect, useState } from 'react';
import type { ComplianceCase } from '../../domain/cases';
import { LocalAppStore } from '../../services/indexedDbStore';
import CaseDetail from './CaseDetail';

const store = new LocalAppStore();

export default function CasesPage() {
  const [cases, setCases] = useState<ComplianceCase[]>([]);
  const [selected, setSelected] = useState<ComplianceCase | null>(null);

  useEffect(() => {
    void store.getCases().then((items) => {
      setCases(items);
      if (items.length > 0) setSelected(items[0]);
    });
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
      <div style={{ borderRight: '1px solid #ddd', padding: 16 }}>
        <h2>Cases</h2>
        {cases.length === 0 && <p>No cases found.</p>}
        {cases.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelected(c)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              marginBottom: 8,
              padding: 12,
              border: '1px solid #ddd',
              borderRadius: 8,
              background: selected?.id === c.id ? '#f5f5f5' : 'white',
            }}
          >
            <div>
              <strong>{c.id}</strong>
            </div>
            <div>{c.caseType}</div>
            <div>
              {c.riskLevel} , score {c.riskScore}
            </div>
          </button>
        ))}
      </div>

      <div>{selected ? <CaseDetail item={selected} /> : <p>Select a case.</p>}</div>
    </div>
  );
}
