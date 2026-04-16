import { describe, it, expect } from 'vitest';
import {
  parseOfacSdnCsv,
  parseOfacConsCsv,
  parseUnConsolidatedXml,
  parseEuSanctionsXml,
  parseUkOfsiCsv,
  computeDelta,
  screenCustomer,
  screenDeltaAgainstPortfolio,
  hashSanction,
  withHash,
  type NormalisedSanction,
} from '@/services/sanctionsIngest';

// ---------------------------------------------------------------------------
// Fixtures — minimal representative samples, not the real files
// ---------------------------------------------------------------------------

const OFAC_SDN_FIXTURE = `"36","AEROCARIBBEAN AIRLINES","entity","CUBA","-0-","-0-","-0-","-0-","-0-","-0-","-0-","Linked to Havana"
"4069","KIM, Jong Un","individual","DPRK","Leader","-0-","-0-","-0-","-0-","-0-","-0-","Supreme Leader of DPRK"
"2100","HEZBOLLAH","entity","SDGT","-0-","-0-","-0-","-0-","-0-","-0-","-0-","Designated 2001"`;

const UN_XML_FIXTURE = `<?xml version="1.0"?>
<CONSOLIDATED_LIST>
  <INDIVIDUALS>
    <INDIVIDUAL>
      <DATAID>6908507</DATAID>
      <FIRST_NAME>Osama</FIRST_NAME>
      <SECOND_NAME>Mohammed</SECOND_NAME>
      <THIRD_NAME>Awad</THIRD_NAME>
      <FOURTH_NAME>Bin Laden</FOURTH_NAME>
      <UN_LIST_TYPE>Al-Qaida</UN_LIST_TYPE>
      <NATIONALITY>SA</NATIONALITY>
      <INDIVIDUAL_ALIAS>
        <ALIAS_NAME>Usama bin Ladin</ALIAS_NAME>
      </INDIVIDUAL_ALIAS>
    </INDIVIDUAL>
  </INDIVIDUALS>
  <ENTITIES>
    <ENTITY>
      <DATAID>6908600</DATAID>
      <FIRST_NAME>Al-Qaida</FIRST_NAME>
      <UN_LIST_TYPE>Al-Qaida</UN_LIST_TYPE>
    </ENTITY>
  </ENTITIES>
</CONSOLIDATED_LIST>`;

// ---------------------------------------------------------------------------
// hashSanction — stability
// ---------------------------------------------------------------------------

describe('hashSanction', () => {
  const base = {
    source: 'UN' as const,
    sourceId: '123',
    primaryName: 'Test Person',
    aliases: ['Alias One', 'Alias Two'],
    type: 'individual' as const,
    programmes: ['TERRORISM'],
  };

  it('is stable for identical input', () => {
    expect(hashSanction(base)).toBe(hashSanction(base));
  });

  it('is order-insensitive for aliases and programmes', () => {
    const a = hashSanction({ ...base, aliases: ['Alias One', 'Alias Two'] });
    const b = hashSanction({ ...base, aliases: ['Alias Two', 'Alias One'] });
    expect(a).toBe(b);
  });

  it('changes when primary name changes', () => {
    const a = hashSanction(base);
    const b = hashSanction({ ...base, primaryName: 'Different Person' });
    expect(a).not.toBe(b);
  });

  it('produces a 64-char hex string', () => {
    expect(hashSanction(base)).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// OFAC SDN parser
// ---------------------------------------------------------------------------

describe('parseOfacSdnCsv', () => {
  const parsed = parseOfacSdnCsv(OFAC_SDN_FIXTURE);

  it('parses all three fixture rows', () => {
    expect(parsed).toHaveLength(3);
  });

  it('extracts the entity number as sourceId', () => {
    expect(parsed[0].sourceId).toBe('36');
    expect(parsed[1].sourceId).toBe('4069');
  });

  it('strips surrounding quotes from names', () => {
    expect(parsed[0].primaryName).toBe('AEROCARIBBEAN AIRLINES');
    expect(parsed[1].primaryName).toBe('KIM, Jong Un');
  });

  it('classifies entities and individuals correctly', () => {
    expect(parsed[0].type).toBe('entity');
    expect(parsed[1].type).toBe('individual');
  });

  it('extracts programmes', () => {
    expect(parsed[0].programmes).toContain('CUBA');
    expect(parsed[2].programmes).toContain('SDGT');
  });

  it('preserves non-null remarks', () => {
    expect(parsed[2].remarks).toBe('Designated 2001');
  });

  it('keeps -0- sentinel for programmes parsed to non-empty only', () => {
    // Aerocaribbean has a real programme (CUBA); its remarks are a
    // short free-text string, not the -0- sentinel.
    expect(parsed[0].remarks).toBe('Linked to Havana');
  });

  it('every parsed record has a hash', () => {
    for (const s of parsed) {
      expect(s.hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('sets source to OFAC_SDN', () => {
    for (const s of parsed) expect(s.source).toBe('OFAC_SDN');
  });
});

// ---------------------------------------------------------------------------
// UN Consolidated XML parser
// ---------------------------------------------------------------------------

describe('parseUnConsolidatedXml', () => {
  const parsed = parseUnConsolidatedXml(UN_XML_FIXTURE);

  it('parses individuals and entities', () => {
    expect(parsed.length).toBeGreaterThanOrEqual(2);
    expect(parsed.some((p) => p.type === 'individual')).toBe(true);
    expect(parsed.some((p) => p.type === 'entity')).toBe(true);
  });

  it('concatenates first..fourth name for individuals', () => {
    const bl = parsed.find((p) => p.primaryName.includes('Osama'));
    expect(bl).toBeDefined();
    expect(bl?.primaryName).toContain('Bin Laden');
  });

  it('extracts UN list type as a programme', () => {
    const bl = parsed.find((p) => p.primaryName.includes('Osama'));
    expect(bl?.programmes).toContain('Al-Qaida');
  });

  it('extracts nationality', () => {
    const bl = parsed.find((p) => p.primaryName.includes('Osama'));
    expect(bl?.nationality).toBe('SA');
  });

  it('extracts aliases', () => {
    const bl = parsed.find((p) => p.primaryName.includes('Osama'));
    expect(bl?.aliases).toContain('Usama bin Ladin');
  });
});

// ---------------------------------------------------------------------------
// OFAC Consolidated parser
// ---------------------------------------------------------------------------

const OFAC_CONS_FIXTURE = `"10001","EVIL SHIPPING CO","entity","IRAN","-0-","-0-","Cargo","-0-","-0-","-0-","-0-","Front for IRGC"
"10002","SMITH, John","individual","SDGT; IRAN","-0-","-0-","-0-","-0-","-0-","-0-","-0-","-0-"`;

describe('parseOfacConsCsv', () => {
  const parsed = parseOfacConsCsv(OFAC_CONS_FIXTURE);

  it('parses both fixture rows', () => {
    expect(parsed).toHaveLength(2);
  });

  it('sets source to OFAC_CONS', () => {
    for (const s of parsed) expect(s.source).toBe('OFAC_CONS');
  });

  it('extracts entity number as sourceId', () => {
    expect(parsed[0]!.sourceId).toBe('10001');
  });

  it('classifies entity and individual correctly', () => {
    expect(parsed[0]!.type).toBe('entity');
    expect(parsed[1]!.type).toBe('individual');
  });

  it('splits semicolon-separated programmes', () => {
    expect(parsed[1]!.programmes).toContain('SDGT');
    expect(parsed[1]!.programmes).toContain('IRAN');
  });

  it('strips -0- sentinels from remarks', () => {
    expect(parsed[0]!.remarks).toBe('Front for IRGC');
    expect(parsed[1]!.remarks).toBeUndefined();
  });

  it('every record has a hash', () => {
    for (const s of parsed) expect(s.hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// UK OFSI ConList.csv parser
// ---------------------------------------------------------------------------

const UK_OFSI_FIXTURE = `Group ID,Group Type,Regime,Listed On,Last Updated,Group Status,Name 1,Name 2,Name 3,Name 4,Name 5,Name 6,Title,Name Type,DOB,Town of Birth,Country of Birth,Nationality,Passport Details,National Identification Details,Position,Address 1,Address 2,Address 3,Address 4,Address 5,Address 6,Post/Zip Code,Country,Other Information,Entity Type,Subsidiary of
12345,Individual,The Russia (Sanctions) (EU Exit) Regulations 2019,01/01/2022,15/03/2023,Current,IVANOV,Ivan,Petrovich,,,,Mr,Primary Name,1975-06-15,Moscow,Russia,RU,,,,Moscow,,,,,,,Russia,Oligarch linked to regime,,
12345,Individual,The Russia (Sanctions) (EU Exit) Regulations 2019,01/01/2022,15/03/2023,Current,IVAN,P,,,,,Mr,AKA,,,,,,,,,,,,,,,,,,
67890,Entity,The ISIL (Da'esh) and Al-Qaida (Asset-Freezing) Regulations 2011,01/07/2020,01/07/2020,Current,BAD CORP LTD,,,,,,,Primary Name,,,,,,,,London,,,,,,UK,Terror finance front,,`;

describe('parseUkOfsiCsv', () => {
  const parsed = parseUkOfsiCsv(UK_OFSI_FIXTURE);

  it('groups rows by Group ID', () => {
    expect(parsed).toHaveLength(2);
  });

  it('sets source to UK_OFSI', () => {
    for (const s of parsed) expect(s.source).toBe('UK_OFSI');
  });

  it('extracts Group ID as sourceId', () => {
    expect(parsed.find((s) => s.sourceId === '12345')).toBeDefined();
    expect(parsed.find((s) => s.sourceId === '67890')).toBeDefined();
  });

  it('builds primary name from Name 1-6 columns', () => {
    const ind = parsed.find((s) => s.sourceId === '12345');
    expect(ind!.primaryName).toBe('IVANOV Ivan Petrovich');
  });

  it('classifies individual and entity correctly', () => {
    const ind = parsed.find((s) => s.sourceId === '12345');
    const ent = parsed.find((s) => s.sourceId === '67890');
    expect(ind!.type).toBe('individual');
    expect(ent!.type).toBe('entity');
  });

  it('collects AKA rows as aliases', () => {
    const ind = parsed.find((s) => s.sourceId === '12345');
    expect(ind!.aliases).toContain('IVAN P');
  });

  it('extracts regime as programme', () => {
    const ent = parsed.find((s) => s.sourceId === '67890');
    expect(ent!.programmes).toContain(
      "The ISIL (Da'esh) and Al-Qaida (Asset-Freezing) Regulations 2011"
    );
  });

  it('extracts nationality', () => {
    const ind = parsed.find((s) => s.sourceId === '12345');
    expect(ind!.nationality).toBe('RU');
  });

  it('extracts other information as remarks', () => {
    const ind = parsed.find((s) => s.sourceId === '12345');
    expect(ind!.remarks).toBe('Oligarch linked to regime');
  });

  it('returns empty for header-only input', () => {
    expect(parseUkOfsiCsv('Group ID,Name 1\n')).toHaveLength(0);
  });

  it('every record has a hash', () => {
    for (const s of parsed) expect(s.hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// EU Consolidated Sanctions XML parser
// ---------------------------------------------------------------------------

const EU_XML_FIXTURE = `<?xml version="1.0"?>
<export>
  <sanctionEntity logicalId="EU-1001" subjectType="person">
    <nameAlias wholeName="Mahmoud AHMADINEJAD" />
    <nameAlias wholeName="Mahmood Ahmadi-Nezhad" />
    <regulation programme="IRAN" regulationType="Council Regulation" />
    <birthdate><dateOfBirth>1956-10-28</dateOfBirth></birthdate>
    <citizenship countryIso2Code="IR" />
    <remark>Former president of Iran</remark>
  </sanctionEntity>
  <sanctionEntity logicalId="EU-2002" subjectType="enterprise">
    <nameAlias wholeName="BANK MELLI IRAN" />
    <nameAlias wholeName="BMI" />
    <regulation programme="IRAN" />
    <regulation programme="WMD" />
    <remark>State-owned bank</remark>
  </sanctionEntity>
</export>`;

describe('parseEuSanctionsXml', () => {
  const parsed = parseEuSanctionsXml(EU_XML_FIXTURE);

  it('parses both fixture entities', () => {
    expect(parsed).toHaveLength(2);
  });

  it('sets source to EU', () => {
    for (const s of parsed) expect(s.source).toBe('EU');
  });

  it('extracts logicalId as sourceId', () => {
    expect(parsed[0]!.sourceId).toBe('EU-1001');
    expect(parsed[1]!.sourceId).toBe('EU-2002');
  });

  it('uses first nameAlias as primaryName', () => {
    expect(parsed[0]!.primaryName).toBe('Mahmoud AHMADINEJAD');
  });

  it('collects additional nameAlias entries as aliases', () => {
    expect(parsed[0]!.aliases).toContain('Mahmood Ahmadi-Nezhad');
    expect(parsed[1]!.aliases).toContain('BMI');
  });

  it('classifies person and enterprise correctly', () => {
    expect(parsed[0]!.type).toBe('individual');
    expect(parsed[1]!.type).toBe('entity');
  });

  it('extracts programmes from regulation elements', () => {
    expect(parsed[0]!.programmes).toContain('IRAN');
    expect(parsed[1]!.programmes).toContain('IRAN');
    expect(parsed[1]!.programmes).toContain('WMD');
  });

  it('extracts date of birth', () => {
    expect(parsed[0]!.dateOfBirth).toBe('1956-10-28');
  });

  it('extracts nationality from citizenship', () => {
    expect(parsed[0]!.nationality).toBe('IR');
  });

  it('extracts remarks', () => {
    expect(parsed[0]!.remarks).toBe('Former president of Iran');
    expect(parsed[1]!.remarks).toBe('State-owned bank');
  });

  it('returns empty for malformed XML', () => {
    expect(parseEuSanctionsXml('<not-valid></not-valid>')).toHaveLength(0);
  });

  it('every record has a hash', () => {
    for (const s of parsed) expect(s.hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Delta engine
// ---------------------------------------------------------------------------

describe('computeDelta', () => {
  const a = withHash({
    source: 'UN',
    sourceId: '1',
    primaryName: 'Alpha',
    aliases: [],
    type: 'individual',
    programmes: [],
  });
  const b = withHash({
    source: 'UN',
    sourceId: '2',
    primaryName: 'Beta',
    aliases: [],
    type: 'individual',
    programmes: [],
  });
  const c = withHash({
    source: 'UN',
    sourceId: '3',
    primaryName: 'Gamma',
    aliases: [],
    type: 'individual',
    programmes: [],
  });

  it('empty previous + empty current → all zero', () => {
    const d = computeDelta([], []);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.modified).toHaveLength(0);
    expect(d.unchanged).toBe(0);
  });

  it('detects additions', () => {
    const d = computeDelta([a], [a, b]);
    expect(d.added).toHaveLength(1);
    expect(d.added[0].sourceId).toBe('2');
    expect(d.unchanged).toBe(1);
  });

  it('detects removals', () => {
    const d = computeDelta([a, b], [a]);
    expect(d.removed).toHaveLength(1);
    expect(d.removed[0].sourceId).toBe('2');
  });

  it('detects modifications via hash change', () => {
    const aRenamed = withHash({ ...a, primaryName: 'Alpha Prime' });
    const d = computeDelta([a], [aRenamed]);
    expect(d.modified).toHaveLength(1);
    expect(d.modified[0].before.primaryName).toBe('Alpha');
    expect(d.modified[0].after.primaryName).toBe('Alpha Prime');
  });

  it('handles full turnover', () => {
    const d = computeDelta([a, b], [c]);
    expect(d.added).toHaveLength(1);
    expect(d.removed).toHaveLength(2);
    expect(d.modified).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// screenCustomer
// ---------------------------------------------------------------------------

describe('screenCustomer', () => {
  const list: NormalisedSanction[] = [
    withHash({
      source: 'UN',
      sourceId: '1',
      primaryName: 'Osama Mohammed Awad Bin Laden',
      aliases: ['Usama bin Ladin'],
      type: 'individual',
      programmes: ['Al-Qaida'],
    }),
    withHash({
      source: 'OFAC_SDN',
      sourceId: '2100',
      primaryName: 'HEZBOLLAH',
      aliases: ['Hizballah'],
      type: 'entity',
      programmes: ['SDGT'],
    }),
    withHash({
      source: 'UN',
      sourceId: '2',
      primaryName: 'Kim Jong Un',
      aliases: [],
      type: 'individual',
      programmes: ['DPRK'],
    }),
  ];

  it('finds a confirmed match on the primary name', () => {
    const hits = screenCustomer('Osama Bin Laden', list);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].match.sourceId).toBe('1');
  });

  it('finds a match on an alias when primary name does not match', () => {
    const hits = screenCustomer('Hizballah', list);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].match.primaryName).toBe('HEZBOLLAH');
  });

  it('returns empty for a clean customer', () => {
    const hits = screenCustomer('Alice Wonderland', list);
    expect(hits).toHaveLength(0);
  });

  it('classifies exact matches as confirmed', () => {
    const hits = screenCustomer('Kim Jong Un', list);
    expect(hits[0].classification).toBe('confirmed');
  });

  it('sorts hits by score descending', () => {
    const extendedList: NormalisedSanction[] = [
      ...list,
      withHash({
        source: 'UN',
        sourceId: '3',
        primaryName: 'Kim Jung Un',
        aliases: [],
        type: 'individual',
        programmes: ['DPRK'],
      }),
    ];
    const hits = screenCustomer('Kim Jong Un', extendedList);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].breakdown.score).toBeGreaterThanOrEqual(hits[i].breakdown.score);
    }
  });
});

// ---------------------------------------------------------------------------
// screenDeltaAgainstPortfolio
// ---------------------------------------------------------------------------

describe('screenDeltaAgainstPortfolio', () => {
  const newDesignation = withHash({
    source: 'OFAC_SDN' as const,
    sourceId: '9999',
    primaryName: 'Evil Corp LLC',
    aliases: [],
    type: 'entity' as const,
    programmes: ['SDGT'],
  });

  const delta = {
    added: [newDesignation],
    removed: [],
    modified: [],
    unchanged: 0,
  };

  it('finds hits against new designations for matching customers', () => {
    const portfolio = ['Evil Corp', 'Good Corp', 'Neutral Holdings'];
    const hits = screenDeltaAgainstPortfolio(portfolio, delta);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].customer).toBe('Evil Corp');
  });

  it('returns empty when nothing matches', () => {
    const portfolio = ['Good Corp', 'Neutral Holdings'];
    const hits = screenDeltaAgainstPortfolio(portfolio, delta);
    expect(hits).toHaveLength(0);
  });

  it('ignores removed entries (only screens against added)', () => {
    const removedOnlyDelta = {
      added: [],
      removed: [newDesignation],
      modified: [],
      unchanged: 0,
    };
    const portfolio = ['Evil Corp LLC'];
    const hits = screenDeltaAgainstPortfolio(portfolio, removedOnlyDelta);
    expect(hits).toHaveLength(0);
  });
});
