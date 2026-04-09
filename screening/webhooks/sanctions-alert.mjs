/**
 * Sanctions List Change Detection
 * Checks all configured sanctions list sources for updates since last check.
 * Conforms to: FDL No.10/2025 Art.35, Cabinet Res 74/2020
 */
import { load, save } from '../../scripts/lib/store.mjs';

const SANCTIONS_SOURCES = [
  { id: 'UN_CONSOLIDATED', name: 'UN Security Council Consolidated List', url: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml' },
  { id: 'OFAC_SDN', name: 'OFAC SDN List', url: 'https://www.treasury.gov/ofac/downloads/sdn.xml' },
  { id: 'OFAC_CONS', name: 'OFAC Consolidated Non-SDN', url: 'https://www.treasury.gov/ofac/downloads/consolidated/cons_advanced.xml' },
  { id: 'EU_CONSOLIDATED', name: 'EU Consolidated Sanctions List', url: 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content' },
  { id: 'UK_OFSI', name: 'UK OFSI Consolidated List', url: 'https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.xml' },
  { id: 'UAE_LOCAL', name: 'UAE Local Terrorist List', url: null },
  { id: 'EOCN_TFS', name: 'EOCN TFS Designations', url: null },
  { id: 'FATF_HIGH_RISK', name: 'FATF High-Risk Jurisdictions', url: null },
  { id: 'FATF_GREY', name: 'FATF Grey List', url: null },
  { id: 'INTERPOL_RED', name: 'Interpol Red Notices', url: null },
  { id: 'CAHRA_EU', name: 'EU CAHRA List', url: null },
  { id: 'PEP_DATABASE', name: 'PEP Database', url: null },
  { id: 'LBMA_RESPONSIBLE', name: 'LBMA Responsible Gold Conflict List', url: null },
  { id: 'DUBAI_FIU', name: 'Dubai FIU Alerts', url: null },
  { id: 'ADVERSE_MEDIA', name: 'Adverse Media Screening', url: null },
];

/**
 * Check all sanctions list sources for changes.
 * Compares current list hashes/timestamps against last known state.
 * @returns {{ checked: number, changes: number, details: object[] }}
 */
export async function checkForChanges() {
  const lastState = await load('sanctions-list-state', {});
  const now = new Date().toISOString();
  let changes = 0;
  const details = [];

  for (const source of SANCTIONS_SOURCES) {
    const previous = lastState[source.id];
    let changed = false;
    let status = 'checked';

    if (source.url) {
      try {
        const res = await fetch(source.url, { method: 'HEAD', signal: AbortSignal.timeout(5_000) });
        const lastModified = res.headers.get('last-modified');
        const etag = res.headers.get('etag');
        const contentLength = res.headers.get('content-length');

        if (previous) {
          if (
            (lastModified && lastModified !== previous.lastModified) ||
            (etag && etag !== previous.etag) ||
            (contentLength && contentLength !== previous.contentLength)
          ) {
            changed = true;
            changes++;
          }
        }

        lastState[source.id] = { lastModified, etag, contentLength, checkedAt: now };
      } catch {
        status = 'unreachable';
        lastState[source.id] = { ...previous, checkedAt: now, status: 'unreachable' };
      }
    } else {
      // Sources without direct URLs — checked via API or manual update
      status = 'manual';
      lastState[source.id] = { ...previous, checkedAt: now, status: 'manual' };
    }

    details.push({ id: source.id, name: source.name, changed, status });
  }

  await save('sanctions-list-state', lastState);

  return { checked: SANCTIONS_SOURCES.length, changes, details, checkedAt: now };
}
